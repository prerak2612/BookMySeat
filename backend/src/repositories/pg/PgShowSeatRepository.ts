import type { Queryable } from '../../db/Database.js';
import { ShowSeat } from '../../domain/ShowSeat.js';
import type { SeatCategory, ShowSeatStatus } from '../../domain/enums.js';
import type { LockOptions, ShowSeatRepository } from '../interfaces.js';

interface ShowSeatRow {
  id: number;
  show_id: number;
  seat_id: number;
  row_label: string;
  seat_number: number;
  category: SeatCategory;
  status: ShowSeatStatus;
  booking_id: number | null;
  lock_expires_at: Date | null;
  version: number;
}

const toShowSeat = (r: ShowSeatRow): ShowSeat =>
  new ShowSeat({
    id: r.id,
    showId: r.show_id,
    seatId: r.seat_id,
    rowLabel: r.row_label,
    seatNumber: r.seat_number,
    category: r.category,
    status: r.status,
    bookingId: r.booking_id,
    lockExpiresAt: r.lock_expires_at,
    version: r.version,
  });

const SELECT = `SELECT ss.id, ss.show_id, ss.seat_id, se.row_label, se.seat_number, se.category,
                       ss.status, ss.booking_id, ss.lock_expires_at, ss.version
                FROM show_seats ss JOIN seats se ON se.id = ss.seat_id`;

/**
 * `FOR UPDATE OF ss` takes an exclusive row lock on the show_seats rows only (not the joined
 * physical seats). `ORDER BY ss.id` makes every transaction acquire its row locks in the same
 * global order, which prevents deadlocks between bookings that overlap on several seats.
 */
const orderAndLock = (o?: LockOptions) =>
  o?.forUpdate ? 'ORDER BY ss.id FOR UPDATE OF ss' : 'ORDER BY se.row_label, se.seat_number';

export class PgShowSeatRepository implements ShowSeatRepository {
  constructor(private readonly db: Queryable) {}

  async findByShow(showId: number): Promise<ShowSeat[]> {
    const { rows } = await this.db.query<ShowSeatRow>(
      `${SELECT} WHERE ss.show_id = $1 ORDER BY se.row_label, se.seat_number`,
      [showId],
    );
    return rows.map(toShowSeat);
  }

  async findByShowAndSeatIds(showId: number, seatIds: number[], options?: LockOptions): Promise<ShowSeat[]> {
    const { rows } = await this.db.query<ShowSeatRow>(
      `${SELECT} WHERE ss.show_id = $1 AND ss.seat_id = ANY($2::bigint[]) ${orderAndLock(options)}`,
      [showId, seatIds],
    );
    return rows.map(toShowSeat);
  }

  async findByIds(ids: number[], options?: LockOptions): Promise<ShowSeat[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<ShowSeatRow>(`${SELECT} WHERE ss.id = ANY($1::bigint[]) ${orderAndLock(options)}`, [ids]);
    return rows.map(toShowSeat);
  }

  async lockSeats(ids: number[], bookingId: number, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE show_seats
       SET status = 'LOCKED', booking_id = $2, lock_expires_at = $3, version = version + 1, updated_at = now()
       WHERE id = ANY($1::bigint[])`,
      [ids, bookingId, expiresAt],
    );
  }

  async lockSeatsIfUnchanged(seats: { id: number; version: number }[], bookingId: number, expiresAt: Date): Promise<number[]> {
    // Compare-and-set on the version column. Under READ COMMITTED a concurrent writer of the same
    // row makes this statement wait; PostgreSQL then re-evaluates the WHERE clause against the
    // newly committed row version - the version no longer matches, so that row is NOT updated.
    const { rows } = await this.db.query<{ id: number }>(
      `UPDATE show_seats ss
       SET status = 'LOCKED', booking_id = $3, lock_expires_at = $4, version = ss.version + 1, updated_at = now()
       FROM unnest($1::bigint[], $2::int[]) AS expected(id, version)
       WHERE ss.id = expected.id AND ss.version = expected.version
       RETURNING ss.id`,
      [seats.map((s) => s.id), seats.map((s) => s.version), bookingId, expiresAt],
    );
    return rows.map((r) => r.id);
  }

  async markBooked(ids: number[], bookingId: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE show_seats SET status = 'BOOKED', lock_expires_at = NULL, version = version + 1, updated_at = now()
       WHERE id = ANY($1::bigint[]) AND booking_id = $2 AND status = 'LOCKED'`,
      [ids, bookingId],
    );
    return rowCount ?? 0;
  }

  async releaseForBooking(bookingId: number, ids?: number[]): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE show_seats
       SET status = 'AVAILABLE', booking_id = NULL, lock_expires_at = NULL, version = version + 1, updated_at = now()
       WHERE booking_id = $1 AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
      [bookingId, ids ?? null],
    );
    return rowCount ?? 0;
  }

  async releaseOrphanedLocks(now: Date): Promise<number> {
    // Each row is re-checked after acquiring its row lock, so a seat that was concurrently
    // re-claimed by a new hold (fresh expiry) is skipped.
    const { rowCount } = await this.db.query(
      `UPDATE show_seats ss
       SET status = 'AVAILABLE', booking_id = NULL, lock_expires_at = NULL, version = ss.version + 1, updated_at = now()
       FROM bookings b
       WHERE b.id = ss.booking_id AND ss.status = 'LOCKED' AND ss.lock_expires_at <= $1 AND b.status <> 'PENDING'`,
      [now],
    );
    return rowCount ?? 0;
  }
}
