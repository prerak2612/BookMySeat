/** Unit tests of the locking strategies and SeatLockService with an in-memory fake UnitOfWork. */
import { describe, expect, it, vi } from 'vitest';
import { HoldExpiredError, NotFoundError, SeatUnavailableError } from '../../src/common/errors.js';
import { OptimisticSeatLockingStrategy, PessimisticSeatLockingStrategy, createSeatLockingStrategy } from '../../src/concurrency/SeatLockingStrategy.js';
import { Booking } from '../../src/domain/Booking.js';
import { BookingStatus, SeatCategory, ShowSeatStatus } from '../../src/domain/enums.js';
import { ShowSeat } from '../../src/domain/ShowSeat.js';
import type { UnitOfWork } from '../../src/repositories/interfaces.js';
import { SeatLockService } from '../../src/services/SeatLockService.js';

const NOW = new Date('2026-12-02T10:00:00Z');

const seat = (id: number, over: Partial<ConstructorParameters<typeof ShowSeat>[0]> = {}) =>
  new ShowSeat({ id, showId: 1, seatId: id + 100, rowLabel: 'A', seatNumber: id, category: SeatCategory.REGULAR, status: ShowSeatStatus.AVAILABLE, bookingId: null, lockExpiresAt: null, version: 3, ...over });

function fakeUow(seats: ShowSeat[]) {
  const showSeats = {
    findByShowAndSeatIds: vi.fn(async (_show: number, ids: number[]) => seats.filter((s) => ids.includes(s.seatId))),
    lockSeats: vi.fn(async () => undefined),
    lockSeatsIfUnchanged: vi.fn(async (list: { id: number }[]) => list.map((s) => s.id)),
    markBooked: vi.fn(async (ids: number[]) => ids.length),
    releaseForBooking: vi.fn(async () => 1),
    findByIds: vi.fn(async () => seats),
  };
  const bookings = {
    createHeader: vi.fn(async () => 42),
    addLines: vi.fn(async () => undefined),
    findById: vi.fn(async () => ({ id: 42 }) as unknown as Booking),
    findByIds: vi.fn(async () => [] as Booking[]),
    deactivateLinesForShowSeats: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  };
  return { uow: { showSeats, bookings } as unknown as UnitOfWork, showSeats, bookings };
}

describe('PessimisticSeatLockingStrategy', () => {
  it('loads candidates WITH row locks and claims unconditionally', async () => {
    const { uow, showSeats } = fakeUow([seat(1), seat(2)]);
    const s = new PessimisticSeatLockingStrategy();
    const candidates = await s.reserveCandidates(uow, 1, [101, 102], NOW);
    expect(showSeats.findByShowAndSeatIds).toHaveBeenCalledWith(1, [101, 102], { forUpdate: true });
    await s.claim(uow, candidates, 42, NOW);
    expect(showSeats.lockSeats).toHaveBeenCalledWith([1, 2], 42, NOW);
  });

  it('rejects unavailable and nonexistent seats', async () => {
    const booked = seat(1, { status: ShowSeatStatus.BOOKED, bookingId: 9 });
    const { uow } = fakeUow([booked]);
    const s = new PessimisticSeatLockingStrategy();
    await expect(s.reserveCandidates(uow, 1, [101], NOW)).rejects.toBeInstanceOf(SeatUnavailableError);
    await expect(s.reserveCandidates(uow, 1, [101, 555], NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('OptimisticSeatLockingStrategy', () => {
  it('reads WITHOUT locks and claims with a version compare-and-set', async () => {
    const { uow, showSeats } = fakeUow([seat(2), seat(1)]);
    const s = new OptimisticSeatLockingStrategy();
    const candidates = await s.reserveCandidates(uow, 1, [101, 102], NOW);
    expect(showSeats.findByShowAndSeatIds).toHaveBeenCalledWith(1, [101, 102]);
    await s.claim(uow, candidates, 42, NOW);
    expect(showSeats.lockSeatsIfUnchanged).toHaveBeenCalledWith(
      [
        { id: 1, version: 3 },
        { id: 2, version: 3 },
      ],
      42,
      NOW,
    );
  });

  it('throws SeatUnavailableError when the CAS updates fewer rows (lost race)', async () => {
    const { uow, showSeats } = fakeUow([seat(1), seat(2)]);
    showSeats.lockSeatsIfUnchanged.mockResolvedValueOnce([1]);
    const s = new OptimisticSeatLockingStrategy();
    await expect(s.claim(uow, [seat(1), seat(2)], 42, NOW)).rejects.toMatchObject({ details: { seatIds: [102] } });
  });

  it('factory selects by name', () => {
    expect(createSeatLockingStrategy('OPTIMISTIC')).toBeInstanceOf(OptimisticSeatLockingStrategy);
    expect(createSeatLockingStrategy('PESSIMISTIC')).toBeInstanceOf(PessimisticSeatLockingStrategy);
  });
});

describe('SeatLockService', () => {
  const draft = () => ({
    reference: 'BMS-1',
    userId: 1,
    showId: 1,
    subtotal: 1,
    totalAmount: 1,
    priceBreakdown: [],
    idempotencyKey: null,
    expiresAt: new Date(NOW.getTime() + 300_000),
    seats: [{ showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 1 }],
  });

  it('hold(): validates, creates header, claims seats, then inserts lines - in that order', async () => {
    const { uow, showSeats, bookings } = fakeUow([seat(1)]);
    const order: string[] = [];
    bookings.createHeader.mockImplementation(async () => (order.push('header'), 42));
    showSeats.lockSeats.mockImplementation(async () => void order.push('claim'));
    bookings.addLines.mockImplementation(async () => void order.push('lines'));
    await new SeatLockService(new PessimisticSeatLockingStrategy()).hold(uow, { showId: 1, seatIds: [101], now: NOW, buildDraft: draft });
    expect(order).toEqual(['header', 'claim', 'lines']);
  });

  it('hold(): re-claims an expired lock and expires the stale booking', async () => {
    const stale = seat(1, { status: ShowSeatStatus.LOCKED, bookingId: 9, lockExpiresAt: new Date(NOW.getTime() - 1000) });
    const { uow, bookings } = fakeUow([stale]);
    const staleBooking = new Booking({
      id: 9, reference: 'BMS-OLD', userId: 2, showId: 1, status: BookingStatus.PENDING, subtotal: 1, totalAmount: 1, priceBreakdown: [],
      idempotencyKey: null, expiresAt: new Date(NOW.getTime() - 1000), confirmedAt: null, cancelledAt: null, createdAt: NOW,
      seats: [{ showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 1, isActive: true }],
    });
    bookings.findByIds.mockResolvedValueOnce([staleBooking]);
    await new SeatLockService(new PessimisticSeatLockingStrategy()).hold(uow, { showId: 1, seatIds: [101], now: NOW, buildDraft: draft });
    expect(bookings.deactivateLinesForShowSeats).toHaveBeenCalledWith([1]);
    expect(bookings.findByIds).toHaveBeenCalledWith([9], { forUpdate: true });
    expect(staleBooking.status).toBe(BookingStatus.EXPIRED);
    expect(bookings.save).toHaveBeenCalledWith(staleBooking);
  });

  it('assertStillHeld() detects stolen or expired holds', () => {
    const service = new SeatLockService(new PessimisticSeatLockingStrategy());
    const b = new Booking({
      id: 42, reference: 'R', userId: 1, showId: 1, status: BookingStatus.PENDING, subtotal: 1, totalAmount: 1, priceBreakdown: [],
      idempotencyKey: null, expiresAt: new Date(NOW.getTime() + 60_000), confirmedAt: null, cancelledAt: null, createdAt: NOW,
      seats: [{ showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 1, isActive: true }],
    });
    const held = seat(1, { status: ShowSeatStatus.LOCKED, bookingId: 42, lockExpiresAt: new Date(NOW.getTime() + 60_000) });
    expect(() => service.assertStillHeld(b, [held], NOW)).not.toThrow();
    const stolen = seat(1, { status: ShowSeatStatus.LOCKED, bookingId: 77, lockExpiresAt: new Date(NOW.getTime() + 60_000) });
    expect(() => service.assertStillHeld(b, [stolen], NOW)).toThrow(HoldExpiredError);
    expect(() => service.assertStillHeld(b, [], NOW)).toThrow(HoldExpiredError);
  });
});
