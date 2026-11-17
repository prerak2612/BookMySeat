import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/Clock.js';
import { Database } from '../../src/db/Database.js';
import { UserRole } from '../../src/domain/enums.js';
import type { UnitOfWorkFactory } from '../../src/repositories/interfaces.js';
import { api, createShowFixture, createUsers, DECLINED_CARD, GATEWAY_DOWN_CARD, resetDatabase, startTestApp, VALID_CARD, type TestContext } from '../helpers/testApp.js';

const pool = () => Database.getInstance().pool;
const clock = new FixedClock(new Date('2026-12-02T09:00:00Z')); // a Wednesday (no weekend surcharge)
let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp({ clock, config: { SEAT_HOLD_MINUTES: 5, CANCELLATION_CUTOFF_MINUTES: 120 } });
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  clock.set(new Date('2026-12-02T09:00:00Z'));
  await resetDatabase();
});

async function setup(hoursAhead = 24) {
  const fixture = await createShowFixture(ctx, { hoursAhead, basePrice: 200 });
  const [alice, bob] = await createUsers(ctx, 2);
  const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
  return { ...fixture, alice: alice!, bob: bob!, admin: admin! };
}

const hold = (token: string, showId: number, seatIds: number[], key?: string) =>
  api(ctx, 'POST', '/bookings', { token, body: { showId, seatIds }, headers: key ? { 'Idempotency-Key': key } : {} });
const pay = (token: string, bookingId: number, method = 'CARD', details: Record<string, string> = VALID_CARD, key?: string) =>
  api(ctx, 'POST', `/bookings/${bookingId}/payments`, { token, body: { method, details }, headers: key ? { 'Idempotency-Key': key } : {} });

describe('Booking lifecycle API', () => {
  it('hold -> pay -> CONFIRMED, with correct pricing and seat states', async () => {
    const { show, seatIds, alice } = await setup();
    // Seat A1 (REGULAR, 200) and E1 (RECLINER, 200 x 2.2 = 440)
    const recliner = seatIds[40]!;
    const h = await hold(alice.token, show.id, [seatIds[0]!, recliner]);
    expect(h.status).toBe(201);
    expect(h.body.data).toMatchObject({ status: 'PENDING', subtotal: 640, holdSecondsRemaining: 300 });
    // 640 tickets + 60 fee = 700, + 18% GST = 826
    expect(h.body.data.totalAmount).toBe(826);

    const map = await api(ctx, 'GET', `/shows/${show.id}/seats`);
    expect(map.body.data.summary).toEqual({ AVAILABLE: 48, LOCKED: 2, BOOKED: 0 });

    const p = await pay(alice.token, h.body.data.id);
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS', paymentMethod: 'CARD', cancellable: true });
    expect(p.body.data.transactionRef).toMatch(/^LP/);

    const after = await api(ctx, 'GET', `/shows/${show.id}/seats`);
    expect(after.body.data.summary).toEqual({ AVAILABLE: 48, LOCKED: 0, BOOKED: 2 });

    const history = await api(ctx, 'GET', '/bookings', { token: alice.token });
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].seats.map((s: { label: string }) => s.label)).toEqual(['A1', 'E1']);

    const notes = await api(ctx, 'GET', '/notifications', { token: alice.token });
    expect(notes.body.data.map((n: { type: string }) => n.type)).toEqual(['BOOKING_CONFIRMED', 'BOOKING_CONFIRMED']);
  });

  it('declined payment -> 402, booking FAILED, seats released, notification sent', async () => {
    const { show, seatIds, alice, bob } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[3]!]);
    const p = await pay(alice.token, h.body.data.id, 'CARD', DECLINED_CARD);
    expect(p.status).toBe(402);
    expect(p.body.error.code).toBe('PAYMENT_FAILED');
    expect(p.body.error.details.booking).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED' });

    // The seat is immediately bookable by someone else.
    expect((await hold(bob.token, show.id, [seatIds[3]!])).status).toBe(201);
    const notes = await pool().query(`SELECT count(*)::int AS n FROM notifications WHERE type = 'PAYMENT_FAILED'`);
    expect(notes.rows[0].n).toBe(2);
  });

  it('UPI and wallet declines are reported the same way', async () => {
    const { show, seatIds, alice } = await setup();
    const h1 = await hold(alice.token, show.id, [seatIds[1]!]);
    expect((await pay(alice.token, h1.body.data.id, 'UPI', { upiId: 'fail@bank' })).status).toBe(402);
    const h2 = await hold(alice.token, show.id, [seatIds[2]!]);
    expect((await pay(alice.token, h2.body.data.id, 'WALLET', { walletId: 'empty-wallet' })).status).toBe(402);
  });

  it('gateway outage -> 500-class failure is ROLLED BACK: hold survives and can be retried', async () => {
    const { show, seatIds, alice } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[4]!]);
    const failed = await pay(alice.token, h.body.data.id, 'CARD', GATEWAY_DOWN_CARD);
    expect(failed.status).toBe(500);

    const { rows } = await pool().query('SELECT status FROM bookings WHERE id = $1', [h.body.data.id]);
    expect(rows[0].status).toBe('PENDING');
    const payments = await pool().query('SELECT count(*)::int AS n FROM payments');
    expect(payments.rows[0].n).toBe(0); // nothing from the failed transaction was persisted
    const seat = await pool().query('SELECT status, booking_id FROM show_seats WHERE id = $1', [h.body.data.seats[0].showSeatId]);
    expect(seat.rows[0]).toEqual({ status: 'LOCKED', booking_id: h.body.data.id });

    expect((await pay(alice.token, h.body.data.id)).status).toBe(200); // retry with a working card
  });

  it('invalid payment details -> 400 and nothing changes', async () => {
    const { show, seatIds, alice } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[5]!]);
    const res = await pay(alice.token, h.body.data.id, 'CARD', { cardNumber: '123', expiry: '13/20', cvv: '1', cardHolder: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(4);
    const { rows } = await pool().query('SELECT status FROM bookings WHERE id = $1', [h.body.data.id]);
    expect(rows[0].status).toBe('PENDING');
  });

  it('paying twice returns 409; replaying with the same Idempotency-Key returns the original result', async () => {
    const { show, seatIds, alice } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[6]!]);
    const first = await pay(alice.token, h.body.data.id, 'CARD', VALID_CARD, 'pay-key-0001');
    expect(first.status).toBe(200);
    const replay = await pay(alice.token, h.body.data.id, 'CARD', VALID_CARD, 'pay-key-0001');
    expect(replay.status).toBe(200);
    expect(replay.body.data.transactionRef).toBe(first.body.data.transactionRef);
    expect((await pay(alice.token, h.body.data.id)).status).toBe(409);
  });

  it('reusing a hold Idempotency-Key for a different request -> 422', async () => {
    const { show, seatIds, alice } = await setup();
    await hold(alice.token, show.id, [seatIds[7]!], 'hold-key-0001');
    const res = await hold(alice.token, show.id, [seatIds[8]!, seatIds[9]!], 'hold-key-0001');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('expired hold: payment is refused with 410 and seats are released', async () => {
    const { show, seatIds, alice, bob } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[11]!]);
    clock.advanceMinutes(5); // exactly at expiry -> expired
    const res = await pay(alice.token, h.body.data.id);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
    const { rows } = await pool().query('SELECT status FROM bookings WHERE id = $1', [h.body.data.id]);
    expect(rows[0].status).toBe('EXPIRED');
    expect((await hold(bob.token, show.id, [seatIds[11]!])).status).toBe(201);
  });

  it('expired locks are shown as AVAILABLE before the sweeper runs', async () => {
    const { show, seatIds, alice } = await setup();
    await hold(alice.token, show.id, [seatIds[12]!]);
    clock.advanceMinutes(6);
    const map = await api(ctx, 'GET', `/shows/${show.id}/seats`);
    expect(map.body.data.summary.LOCKED).toBe(0);
  });

  it('cancels a confirmed booking with a refund and frees the seats', async () => {
    const { show, seatIds, alice, bob } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[13]!]);
    await pay(alice.token, h.body.data.id);
    const c = await api(ctx, 'POST', `/bookings/${h.body.data.id}/cancel`, { token: alice.token });
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', cancellable: false });
    expect((await hold(bob.token, show.id, [seatIds[13]!])).status).toBe(201);
    // Cancelling again is an invalid transition.
    expect((await api(ctx, 'POST', `/bookings/${h.body.data.id}/cancel`, { token: alice.token })).status).toBe(409);
  });

  it('abandoning a PENDING hold releases it without a refund', async () => {
    const { show, seatIds, alice } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[14]!]);
    const c = await api(ctx, 'POST', `/bookings/${h.body.data.id}/cancel`, { token: alice.token });
    expect(c.body.data).toMatchObject({ status: 'CANCELLED', paymentStatus: null });
  });

  it('refuses cancellation inside the cut-off window (422)', async () => {
    const { show, seatIds, alice } = await setup(3); // show in 3h, cut-off 2h
    const h = await hold(alice.token, show.id, [seatIds[15]!]);
    await pay(alice.token, h.body.data.id);
    clock.advanceMinutes(61); // now 1h59m before the show
    const res = await api(ctx, 'POST', `/bookings/${h.body.data.id}/cancel`, { token: alice.token });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANCELLATION_WINDOW_CLOSED');
    const { rows } = await pool().query('SELECT status FROM bookings WHERE id = $1', [h.body.data.id]);
    expect(rows[0].status).toBe('CONFIRMED');
  });

  it('refuses booking a show that has already started (422)', async () => {
    const { show, seatIds, alice } = await setup(1);
    clock.advanceMinutes(61);
    const res = await hold(alice.token, show.id, [seatIds[0]!]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SHOW_NOT_BOOKABLE');
  });

  it('enforces ownership: other customers get 403, admins can view', async () => {
    const { show, seatIds, alice, bob, admin } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[16]!]);
    expect((await api(ctx, 'GET', `/bookings/${h.body.data.id}`, { token: bob.token })).status).toBe(403);
    expect((await pay(bob.token, h.body.data.id)).status).toBe(403);
    expect((await api(ctx, 'POST', `/bookings/${h.body.data.id}/cancel`, { token: bob.token })).status).toBe(403);
    expect((await api(ctx, 'GET', `/bookings/${h.body.data.id}`, { token: admin.token })).status).toBe(200);
  });

  it('validates hold requests: duplicates, nonexistent seats, unknown show, too many seats, no auth', async () => {
    const { show, seatIds, alice } = await setup();
    expect((await hold(alice.token, show.id, [seatIds[0]!, seatIds[0]!])).status).toBe(400);
    expect((await hold(alice.token, show.id, [999999])).status).toBe(404);
    expect((await hold(alice.token, 999999, [seatIds[0]!])).status).toBe(404);
    expect((await hold(alice.token, show.id, seatIds.slice(0, 11))).body.error.code).toBe('TOO_MANY_SEATS');
    expect((await hold(alice.token, show.id, [])).status).toBe(400);
    expect((await api(ctx, 'POST', '/bookings', { body: { showId: show.id, seatIds: [seatIds[0]] } })).status).toBe(401);
  });

  it('admin dashboard reports revenue and booking counts', async () => {
    const { show, seatIds, alice, admin } = await setup();
    const h = await hold(alice.token, show.id, [seatIds[20]!]);
    await pay(alice.token, h.body.data.id);
    const stats = await api(ctx, 'GET', '/admin/stats', { token: admin.token });
    expect(stats.body.data.bookingsByStatus).toEqual({ CONFIRMED: 1 });
    expect(stats.body.data.revenue).toBe(h.body.data.totalAmount);
    expect(stats.body.data.topMovies).toHaveLength(1);
    const all = await api(ctx, 'GET', '/admin/bookings?status=CONFIRMED', { token: admin.token });
    expect(all.body.data).toHaveLength(1);
    expect((await api(ctx, 'GET', '/admin/stats', { token: alice.token })).status).toBe(403);
  });
});

describe('transaction rollback on a database failure mid-confirmation', () => {
  it('a DB failure AFTER the charge and seat update leaves NO partial state', async () => {
    // Fault injection via a Unit-of-Work decorator: bookings.save() throws inside the pay
    // transaction - after the payment row was inserted and the seats were marked BOOKED.
    let failSaves = true;
    const local = await startTestApp({
      clock,
      wrapUnitOfWork: (inner: UnitOfWorkFactory): UnitOfWorkFactory => ({
        db: inner.db,
        transaction: (work) =>
          inner.transaction((uow) =>
            work({
              ...uow,
              bookings: Object.assign(Object.create(uow.bookings), {
                save: async (b: Parameters<typeof uow.bookings.save>[0]) => {
                  if (failSaves && b.status === 'CONFIRMED') throw new Error('simulated database failure');
                  return uow.bookings.save(b);
                },
              }),
            }),
          ),
      }),
    });
    try {
      const fixture = await createShowFixture(local);
      const [u] = await createUsers(local, 1);
      const h = await api(local, 'POST', '/bookings', { token: u!.token, body: { showId: fixture.show.id, seatIds: [fixture.seatIds[0]] } });
      const res = await api(local, 'POST', `/bookings/${h.body.data.id}/payments`, { token: u!.token, body: { method: 'CARD', details: VALID_CARD } });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');

      const payments = await pool().query('SELECT count(*)::int AS n FROM payments');
      expect(payments.rows[0].n).toBe(0); // payment insert rolled back
      const seat = await pool().query('SELECT status FROM show_seats WHERE id = $1', [h.body.data.seats[0].showSeatId]);
      expect(seat.rows[0].status).toBe('LOCKED'); // BOOKED update rolled back
      const b = await pool().query('SELECT status FROM bookings WHERE id = $1', [h.body.data.id]);
      expect(b.rows[0].status).toBe('PENDING');

      failSaves = false; // the database "recovers" - the retry succeeds
      const retry = await api(local, 'POST', `/bookings/${h.body.data.id}/payments`, { token: u!.token, body: { method: 'CARD', details: VALID_CARD } });
      expect(retry.status).toBe(200);
    } finally {
      await local.close();
    }
  });
});
