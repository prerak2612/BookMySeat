/**
 * Concurrency & stress tests. Every test fires REAL concurrent HTTP requests at a running server
 * backed by PostgreSQL, then checks the database directly for consistency.
 * Runs once per locking strategy so both mechanisms are proven.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import type { SeatLockingStrategyName } from '../../src/concurrency/SeatLockingStrategy.js';
import { FixedClock } from '../../src/common/Clock.js';
import { api, createShowFixture, createUsers, resetDatabase, startTestApp, VALID_CARD, type TestContext } from '../helpers/testApp.js';

const pool = () => Database.getInstance().pool;
const CONCURRENT_REQUESTS = 50;

async function dbInvariants(showId: number) {
  const { rows } = await pool().query(
    `SELECT
       (SELECT count(*)::int FROM (SELECT show_seat_id FROM booking_seats WHERE is_active GROUP BY show_seat_id HAVING count(*) > 1) d) AS duplicate_active_lines,
       (SELECT count(*)::int FROM show_seats ss WHERE ss.show_id = $1 AND ss.status <> 'AVAILABLE'
          AND NOT EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.show_seat_id = ss.id AND bs.is_active AND bs.booking_id = ss.booking_id)) AS seats_without_matching_line,
       (SELECT count(*)::int FROM booking_seats bs JOIN show_seats ss ON ss.id = bs.show_seat_id
          WHERE bs.is_active AND ss.show_id = $1 AND ss.booking_id IS DISTINCT FROM bs.booking_id) AS lines_without_matching_seat`,
    [showId],
  );
  return rows[0];
}

for (const strategy of ['PESSIMISTIC', 'OPTIMISTIC'] as SeatLockingStrategyName[]) {
  describe(`concurrency [${strategy}]`, () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await startTestApp({ seatLockStrategy: strategy });
    });
    afterAll(async () => ctx.close());
    beforeEach(resetDatabase);

    it(`${CONCURRENT_REQUESTS} users racing for the SAME seat -> exactly one hold`, async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const users = await createUsers(ctx, CONCURRENT_REQUESTS);
      const target = seatIds[0]!;

      const responses = await Promise.all(
        users.map((u) => api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: [target] } })),
      );

      const created = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(CONCURRENT_REQUESTS - 1);
      conflicts.forEach((r) => expect(r.body.error.code).toBe('SEAT_UNAVAILABLE'));
      expect(responses.some((r) => r.status >= 500)).toBe(false);

      const { rows } = await pool().query(
        `SELECT count(*)::int AS n FROM booking_seats bs JOIN show_seats ss ON ss.id = bs.show_seat_id
         WHERE ss.show_id = $1 AND ss.seat_id = $2 AND bs.is_active`,
        [show.id, target],
      );
      expect(rows[0].n).toBe(1);
      // Failed attempts were rolled back completely: no orphan booking rows remain.
      const bookings = await pool().query('SELECT count(*)::int AS n FROM bookings');
      expect(bookings.rows[0].n).toBe(1);
      expect(await dbInvariants(show.id)).toEqual({ duplicate_active_lines: 0, seats_without_matching_line: 0, lines_without_matching_seat: 0 });
    });

    it(`${CONCURRENT_REQUESTS} users racing for the same seat all the way to PAYMENT -> exactly one confirmed booking`, async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const users = await createUsers(ctx, CONCURRENT_REQUESTS);
      const target = seatIds[1]!;

      const results = await Promise.all(
        users.map(async (u) => {
          const hold = await api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: [target] } });
          if (hold.status !== 201) return hold.status;
          const pay = await api(ctx, 'POST', `/bookings/${hold.body.data.id}/payments`, { token: u.token, body: { method: 'CARD', details: VALID_CARD } });
          return pay.status;
        }),
      );
      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(CONCURRENT_REQUESTS - 1);

      const confirmed = await pool().query(`SELECT count(*)::int AS n FROM bookings WHERE status = 'CONFIRMED'`);
      const payments = await pool().query(`SELECT count(*)::int AS n FROM payments WHERE status = 'SUCCESS'`);
      const seat = await pool().query(`SELECT status FROM show_seats WHERE show_id = $1 AND seat_id = $2`, [show.id, target]);
      expect(confirmed.rows[0].n).toBe(1);
      expect(payments.rows[0].n).toBe(1);
      expect(seat.rows[0].status).toBe('BOOKED');
    });

    it('concurrent bookings of DIFFERENT seats all succeed', async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const users = await createUsers(ctx, 40);
      const responses = await Promise.all(
        users.map((u, i) => api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: [seatIds[i]!] } })),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);
      const locked = await pool().query(`SELECT count(*)::int AS n FROM show_seats WHERE show_id = $1 AND status = 'LOCKED'`, [show.id]);
      expect(locked.rows[0].n).toBe(40);
      expect(await dbInvariants(show.id)).toEqual({ duplicate_active_lines: 0, seats_without_matching_line: 0, lines_without_matching_seat: 0 });
    });

    it('overlapping multi-seat requests never deadlock and never double-allocate', async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const users = await createUsers(ctx, 30);
      // Each request wants a window of 3 adjacent seats in alternating orders -> heavy overlap.
      const responses = await Promise.all(
        users.map((u, i) => {
          const window = seatIds.slice(i % 8, (i % 8) + 3);
          return api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: i % 2 ? window.reverse() : window } });
        }),
      );
      expect(responses.some((r) => r.status >= 500)).toBe(false);
      expect(responses.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      expect(await dbInvariants(show.id)).toEqual({ duplicate_active_lines: 0, seats_without_matching_line: 0, lines_without_matching_seat: 0 });
    });

    it('duplicate hold requests with the same Idempotency-Key create ONE booking', async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const [u] = await createUsers(ctx, 1);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          api(ctx, 'POST', '/bookings', {
            token: u!.token,
            headers: { 'Idempotency-Key': 'dup-request-key-1' },
            body: { showId: show.id, seatIds: [seatIds[5]!, seatIds[6]!] },
          }),
        ),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 200)).toHaveLength(9);
      expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
      const n = await pool().query('SELECT count(*)::int AS n FROM bookings');
      expect(n.rows[0].n).toBe(1);
    });

    it('concurrent payment submissions for one booking charge exactly once', async () => {
      const { show, seatIds } = await createShowFixture(ctx);
      const [u] = await createUsers(ctx, 1);
      const hold = await api(ctx, 'POST', '/bookings', { token: u!.token, body: { showId: show.id, seatIds: [seatIds[10]!] } });
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          api(ctx, 'POST', `/bookings/${hold.body.data.id}/payments`, { token: u!.token, body: { method: 'UPI', details: { upiId: 'user@okbank' } } }),
        ),
      );
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      responses.filter((r) => r.status !== 200).forEach((r) => expect(r.status).toBe(409));
      const p = await pool().query('SELECT count(*)::int AS n FROM payments WHERE booking_id = $1', [hold.body.data.id]);
      expect(p.rows[0].n).toBe(1);
    });
  });
}

describe('concurrency - expired locks', () => {
  const clock = new FixedClock(new Date('2026-12-01T10:00:00Z'));
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp({ clock, config: { SEAT_HOLD_MINUTES: 5 } });
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    clock.set(new Date('2026-12-01T10:00:00Z'));
    await resetDatabase();
  });

  it('an expired hold is re-claimed by exactly one of many concurrent users', async () => {
    const { show, seatIds } = await createShowFixture(ctx);
    const [first, ...others] = await createUsers(ctx, 21);
    const original = await api(ctx, 'POST', '/bookings', { token: first!.token, body: { showId: show.id, seatIds: [seatIds[0]!] } });
    expect(original.status).toBe(201);

    clock.advanceMinutes(6); // hold has expired, but the sweeper has NOT run
    const responses = await Promise.all(
      others.map((u) => api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: [seatIds[0]!] } })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(19);

    const old = await pool().query('SELECT status FROM bookings WHERE id = $1', [original.body.data.id]);
    expect(old.rows[0].status).toBe('EXPIRED');
    // The original user can no longer pay for the stolen seat.
    const pay = await api(ctx, 'POST', `/bookings/${original.body.data.id}/payments`, { token: first!.token, body: { method: 'CARD', details: VALID_CARD } });
    expect(pay.status).toBe(410);
    expect(pay.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('the hold-expiry job releases abandoned holds and is safe to run concurrently', async () => {
    const { show, seatIds } = await createShowFixture(ctx);
    const users = await createUsers(ctx, 5);
    for (const [i, u] of users.entries()) {
      await api(ctx, 'POST', '/bookings', { token: u.token, body: { showId: show.id, seatIds: [seatIds[i]!] } });
    }
    clock.advanceMinutes(10);
    const { holdExpiryJob } = ctx.container;
    const results = await Promise.all([holdExpiryJob.runOnce(), holdExpiryJob.runOnce()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(5);

    const seats = await pool().query(`SELECT count(*)::int AS n FROM show_seats WHERE show_id = $1 AND status = 'AVAILABLE'`, [show.id]);
    expect(seats.rows[0].n).toBe(50);
    const expired = await pool().query(`SELECT count(*)::int AS n FROM bookings WHERE status = 'EXPIRED'`);
    expect(expired.rows[0].n).toBe(5);
    const notes = await pool().query(`SELECT count(*)::int AS n FROM notifications WHERE type = 'BOOKING_EXPIRED'`);
    expect(notes.rows[0].n).toBe(10); // e-mail + SMS per booking
  });
});

describe('database-level guarantees (independent of application code)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(resetDatabase);

  it('the partial unique index rejects a second ACTIVE reservation line for the same show seat', async () => {
    const { show, seatIds } = await createShowFixture(ctx);
    const [u] = await createUsers(ctx, 1);
    const hold = await api(ctx, 'POST', '/bookings', { token: u!.token, body: { showId: show.id, seatIds: [seatIds[0]!] } });
    const showSeatId = hold.body.data.seats[0].showSeatId;
    const other = await pool().query(
      `INSERT INTO bookings (reference, user_id, show_id, subtotal, total_amount, expires_at) VALUES ('BMS-RAW00001', $1, $2, 0, 0, now()) RETURNING id`,
      [u!.user.id, show.id],
    );
    await expect(
      pool().query('INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES ($1, $2, 0)', [other.rows[0].id, showSeatId]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'ux_booking_seats_one_active_per_show_seat' });
  });

  it('the CHECK constraint rejects inconsistent seat states', async () => {
    const { show } = await createShowFixture(ctx);
    await expect(
      pool().query(`UPDATE show_seats SET status = 'BOOKED' WHERE show_id = $1 AND booking_id IS NULL`, [show.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
