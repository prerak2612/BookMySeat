import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, describeError, HttpClient } from '../../src/api/httpClient';
import { Observable } from '../../src/patterns/Observable';
import { PaymentFormFactory } from '../../src/patterns/paymentForms';
import { SeatAvailabilityPoller } from '../../src/patterns/SeatAvailabilityPoller';
import { ContiguousBlockStrategy, ManualSelectionStrategy, pruneUnavailable } from '../../src/patterns/seatSelectionStrategies';
import { makeSeatMap } from './fixtures';

// ------------------------------------------------------------------ Strategy: seat selection

describe('seat selection strategies', () => {
  const map = makeSeatMap([
    { row: 'A', statuses: ['AVAILABLE', 'AVAILABLE', 'BOOKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE'] },
  ]);
  const seat = (n: number) => map.rows[0]!.seats[n - 1]!;
  const ctx = (selected: number[] = [], quantity = 2) => ({ seatMap: map, selected, quantity, maxSeats: 3 });

  it('manual: toggles seats and respects the maximum', () => {
    const s = new ManualSelectionStrategy();
    let sel = s.onSeatClick(seat(1), ctx());
    expect(sel).toEqual([seat(1).seatId]);
    sel = s.onSeatClick(seat(1), ctx(sel));
    expect(sel).toEqual([]);
    const full = [seat(1).seatId, seat(2).seatId, seat(4).seatId];
    expect(s.onSeatClick(seat(5), ctx(full))).toEqual(full);
    expect(s.onSeatClick(seat(3), ctx())).toEqual([]); // booked seat ignored
  });

  it('block: selects N contiguous free seats, sliding left when needed', () => {
    const s = new ContiguousBlockStrategy();
    expect(s.onSeatClick(seat(4), ctx([], 3))).toEqual([seat(4).seatId, seat(5).seatId, seat(6).seatId]);
    // Clicking the last seat slides the block left.
    expect(s.onSeatClick(seat(6), ctx([], 2))).toEqual([seat(5).seatId, seat(6).seatId]);
  });

  it('block: never spans a booked seat', () => {
    const s = new ContiguousBlockStrategy();
    // From seat 2 a block of 2 can only be [1,2] (seat 3 is booked).
    expect(s.onSeatClick(seat(2), ctx([], 2))).toEqual([seat(1).seatId, seat(2).seatId]);
    expect(s.onSeatClick(seat(1), ctx([], 3))).toEqual([]); // no room -> unchanged
  });

  it('pruneUnavailable drops seats taken by others after a refresh', () => {
    const fresh = makeSeatMap([{ row: 'A', statuses: ['LOCKED', 'AVAILABLE'] }]);
    const a1 = fresh.rows[0]!.seats[0]!.seatId;
    const a2 = fresh.rows[0]!.seats[1]!.seatId;
    expect(pruneUnavailable([a1, a2], fresh)).toEqual([a2]);
  });
});

// ------------------------------------------------------------------ Observer

describe('Observable / SeatAvailabilityPoller', () => {
  afterEach(() => vi.useRealTimers());

  it('replays the current value to new subscribers and supports unsubscribe', () => {
    class Counter extends Observable<number> {
      inc() {
        this.emit(this.value + 1);
      }
    }
    const c = new Counter(0);
    const seen: number[] = [];
    const off = c.subscribe((v) => seen.push(v));
    c.inc();
    off();
    c.inc();
    expect(seen).toEqual([0, 1]);
    expect(c.subscriberCount).toBe(0);
  });

  it('polls on an interval and notifies all observers with the new seat map', async () => {
    vi.useFakeTimers();
    const map = makeSeatMap([{ row: 'A', statuses: ['AVAILABLE'] }]);
    const fetcher = vi.fn().mockResolvedValue(map);
    const poller = new SeatAvailabilityPoller(1, fetcher, 1000);
    const a = vi.fn();
    const b = vi.fn();
    poller.subscribe(a);
    poller.subscribe(b);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenLastCalledWith(expect.objectContaining({ seatMap: map, loading: false }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(a.mock.calls.length);
    poller.stop();
  });

  it('shares one request between concurrent refreshes and keeps the last map on errors', async () => {
    const map = makeSeatMap([{ row: 'A', statuses: ['AVAILABLE'] }]);
    let resolve!: (m: typeof map) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise((r) => (resolve = r))).mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    const poller = new SeatAvailabilityPoller(1, fetcher);
    const p1 = poller.refresh();
    const p2 = poller.refresh();
    resolve(map);
    await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await poller.refresh();
    expect(poller.current).toMatchObject({ seatMap: map, error: 'offline' });
  });
});

// ------------------------------------------------------------------ Factory + Strategy: payment forms

describe('PaymentFormFactory', () => {
  it('provides a strategy per payment method', () => {
    expect(PaymentFormFactory.all().map((s) => s.method)).toEqual(['CARD', 'UPI', 'WALLET']);
  });

  it('card strategy validates and normalises details', () => {
    const card = PaymentFormFactory.get('CARD');
    expect(Object.keys(card.validate({}))).toEqual(['cardNumber', 'cardHolder', 'expiry', 'cvv']);
    const values = { cardNumber: '4111 1111 1111 1111', cardHolder: ' Ana ', expiry: '12/30', cvv: '123' };
    expect(card.validate(values)).toEqual({});
    expect(card.toDetails(values)).toEqual({ cardNumber: '4111111111111111', cardHolder: 'Ana', expiry: '12/30', cvv: '123' });
  });

  it('UPI and wallet strategies validate their own formats', () => {
    expect(PaymentFormFactory.get('UPI').validate({ upiId: 'bad' })).toHaveProperty('upiId');
    expect(PaymentFormFactory.get('UPI').validate({ upiId: 'ana@okbank' })).toEqual({});
    expect(PaymentFormFactory.get('WALLET').validate({ walletId: 'w!' })).toHaveProperty('walletId');
  });
});

// ------------------------------------------------------------------ HTTP client

describe('HttpClient', () => {
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('unwraps data and sends the bearer token and extra headers', async () => {
    const fetchImpl = vi.fn().mockReturnValue(json(200, { success: true, data: { ok: 1 } }));
    const client = new HttpClient('/api', () => 'tkn', fetchImpl);
    expect(await client.post('/x', { a: 1 }, { 'Idempotency-Key': 'k-12345678' })).toEqual({ ok: 1 });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: 'Bearer tkn', 'Idempotency-Key': 'k-12345678' });
  });

  it('maps API errors to ApiError and calls the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn();
    const client = new HttpClient('/api', () => 'tkn', () => json(409, { success: false, error: { code: 'SEAT_UNAVAILABLE', message: 'taken' } }));
    client.setUnauthorizedHandler(onUnauthorized);
    await expect(client.get('/x')).rejects.toMatchObject({ status: 409, code: 'SEAT_UNAVAILABLE', isConflict: true });
    const expired = new HttpClient('/api', () => 'tkn', () => json(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }));
    expired.setUnauthorizedHandler(onUnauthorized);
    await expect(expired.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('turns network failures into a NETWORK_ERROR ApiError', async () => {
    const client = new HttpClient('/api', () => null, () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(client.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR', isNetwork: true });
  });

  it('describeError flattens validation details', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path: 'email', message: 'Invalid email' }]);
    expect(describeError(err)).toBe('Request validation failed: email: Invalid email');
  });
});
