import type { Queryable } from '../../db/Database.js';
import { Booking, type BookingDraft, type BookingSeat, type PriceLine } from '../../domain/Booking.js';
import type { BookingStatus, PaymentStatus, SeatCategory } from '../../domain/enums.js';
import type { BookingRepository, LockOptions } from '../interfaces.js';
import type { BookingSummary } from '../readModels.js';

interface BookingRow {
  id: number;
  reference: string;
  user_id: number;
  show_id: number;
  status: BookingStatus;
  subtotal: number;
  total_amount: number;
  price_breakdown: PriceLine[];
  idempotency_key: string | null;
  expires_at: Date;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

interface LineRow {
  booking_id: number;
  show_seat_id: number;
  price: number;
  is_active: boolean;
  label: string;
  category: string;
}

interface SummaryRow extends BookingRow {
  user_email: string;
  show_start_time: Date;
  movie_id: number;
  movie_title: string;
  theatre_name: string;
  city: string;
  screen_name: string;
  seats: { showSeatId: number; label: string; category: SeatCategory; price: number }[];
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  transaction_ref: string | null;
}

const SUMMARY_SELECT = `
  SELECT b.*, u.email AS user_email, sh.start_time AS show_start_time, m.id AS movie_id, m.title AS movie_title,
         t.name AS theatre_name, t.city, sc.name AS screen_name,
         COALESCE((
           SELECT json_agg(json_build_object('showSeatId', bs.show_seat_id, 'label', se.row_label || se.seat_number,
                                             'category', se.category, 'price', bs.price)
                           ORDER BY se.row_label, se.seat_number)
           FROM booking_seats bs JOIN show_seats ss ON ss.id = bs.show_seat_id JOIN seats se ON se.id = ss.seat_id
           WHERE bs.booking_id = b.id), '[]'::json) AS seats,
         p.status AS payment_status, p.method AS payment_method, p.transaction_ref
  FROM bookings b
  JOIN users u ON u.id = b.user_id
  JOIN shows sh ON sh.id = b.show_id
  JOIN movies m ON m.id = sh.movie_id
  JOIN screens sc ON sc.id = sh.screen_id
  JOIN theatres t ON t.id = sc.theatre_id
  LEFT JOIN LATERAL (
    SELECT status, method, transaction_ref FROM payments WHERE booking_id = b.id ORDER BY id DESC LIMIT 1
  ) p ON TRUE`;

const toSummary = (r: SummaryRow): BookingSummary => ({
  id: r.id,
  reference: r.reference,
  userId: r.user_id,
  userEmail: r.user_email,
  status: r.status,
  totalAmount: r.total_amount,
  subtotal: r.subtotal,
  priceBreakdown: r.price_breakdown,
  expiresAt: r.expires_at,
  confirmedAt: r.confirmed_at,
  cancelledAt: r.cancelled_at,
  createdAt: r.created_at,
  showId: r.show_id,
  showStartTime: r.show_start_time,
  movieId: r.movie_id,
  movieTitle: r.movie_title,
  theatreName: r.theatre_name,
  city: r.city,
  screenName: r.screen_name,
  seats: r.seats.map((s) => ({ ...s, price: Number(s.price) })),
  paymentStatus: r.payment_status,
  paymentMethod: r.payment_method,
  transactionRef: r.transaction_ref,
});

export class PgBookingRepository implements BookingRepository {
  constructor(private readonly db: Queryable) {}

  async createHeader(draft: BookingDraft): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO bookings (reference, user_id, show_id, status, subtotal, total_amount, price_breakdown, idempotency_key, expires_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8) RETURNING id`,
      [
        draft.reference,
        draft.userId,
        draft.showId,
        draft.subtotal,
        draft.totalAmount,
        JSON.stringify(draft.priceBreakdown),
        draft.idempotencyKey,
        draft.expiresAt,
      ],
    );
    return rows[0]!.id;
  }

  async addLines(bookingId: number, seats: BookingDraft['seats']): Promise<void> {
    // If another ACTIVE line already exists for any of these seats, the partial unique index
    // ux_booking_seats_one_active_per_show_seat raises 23505 and the whole transaction rolls back.
    await this.db.query(
      `INSERT INTO booking_seats (booking_id, show_seat_id, price)
       SELECT $1, s, p FROM unnest($2::bigint[], $3::numeric[]) AS t(s, p)`,
      [bookingId, seats.map((s) => s.showSeatId), seats.map((s) => s.price)],
    );
  }

  async findById(id: number, options?: LockOptions): Promise<Booking | null> {
    const [booking] = await this.findByIds([id], options);
    return booking ?? null;
  }

  async findByIds(ids: number[], options?: LockOptions): Promise<Booking[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<BookingRow>(
      `SELECT * FROM bookings WHERE id = ANY($1::bigint[]) ORDER BY id ${options?.forUpdate ? 'FOR UPDATE' : ''}`,
      [ids],
    );
    return this.hydrate(rows);
  }

  async findByUserAndIdempotencyKey(userId: number, key: string): Promise<Booking | null> {
    const { rows } = await this.db.query<BookingRow>('SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async save(booking: Booking): Promise<void> {
    await this.db.query(
      `UPDATE bookings SET status = $2, confirmed_at = $3, cancelled_at = $4, updated_at = now() WHERE id = $1`,
      [booking.id, booking.status, booking.confirmedAt, booking.cancelledAt],
    );
    const inactive = booking.seats.filter((s) => !s.isActive).map((s) => s.showSeatId);
    if (inactive.length > 0) {
      await this.db.query(
        `UPDATE booking_seats SET is_active = FALSE WHERE booking_id = $1 AND show_seat_id = ANY($2::bigint[]) AND is_active`,
        [booking.id, inactive],
      );
    }
  }

  async deactivateLinesForShowSeats(showSeatIds: number[], exceptBookingId?: number): Promise<void> {
    if (showSeatIds.length === 0) return;
    await this.db.query(
      `UPDATE booking_seats SET is_active = FALSE
       WHERE show_seat_id = ANY($1::bigint[]) AND is_active AND ($2::bigint IS NULL OR booking_id <> $2)`,
      [showSeatIds, exceptBookingId ?? null],
    );
  }

  async findExpiredPendingIds(now: Date, limit: number): Promise<number[]> {
    const { rows } = await this.db.query<{ id: number }>(
      `SELECT id FROM bookings WHERE status = 'PENDING' AND expires_at <= $1 ORDER BY expires_at LIMIT $2`,
      [now, limit],
    );
    return rows.map((r) => r.id);
  }

  async findSummary(id: number): Promise<BookingSummary | null> {
    const { rows } = await this.db.query<SummaryRow>(`${SUMMARY_SELECT} WHERE b.id = $1`, [id]);
    return rows[0] ? toSummary(rows[0]) : null;
  }

  async listSummariesByUser(userId: number): Promise<BookingSummary[]> {
    const { rows } = await this.db.query<SummaryRow>(`${SUMMARY_SELECT} WHERE b.user_id = $1 ORDER BY b.created_at DESC, b.id DESC`, [userId]);
    return rows.map(toSummary);
  }

  async listSummaries(filter: { status?: string; limit: number }): Promise<BookingSummary[]> {
    const { rows } = await this.db.query<SummaryRow>(
      `${SUMMARY_SELECT} WHERE ($1::booking_status IS NULL OR b.status = $1::booking_status)
       ORDER BY b.created_at DESC, b.id DESC LIMIT $2`,
      [filter.status ?? null, filter.limit],
    );
    return rows.map(toSummary);
  }

  private async hydrate(rows: BookingRow[]): Promise<Booking[]> {
    if (rows.length === 0) return [];
    const { rows: lines } = await this.db.query<LineRow>(
      `SELECT bs.booking_id, bs.show_seat_id, bs.price, bs.is_active, se.row_label || se.seat_number AS label, se.category
       FROM booking_seats bs JOIN show_seats ss ON ss.id = bs.show_seat_id JOIN seats se ON se.id = ss.seat_id
       WHERE bs.booking_id = ANY($1::bigint[]) ORDER BY se.row_label, se.seat_number`,
      [rows.map((r) => r.id)],
    );
    const byBooking = new Map<number, BookingSeat[]>();
    for (const l of lines) {
      const seat: BookingSeat = { showSeatId: l.show_seat_id, seatLabel: l.label, category: l.category, price: l.price, isActive: l.is_active };
      byBooking.set(l.booking_id, [...(byBooking.get(l.booking_id) ?? []), seat]);
    }
    return rows.map(
      (r) =>
        new Booking({
          id: r.id,
          reference: r.reference,
          userId: r.user_id,
          showId: r.show_id,
          status: r.status,
          subtotal: r.subtotal,
          totalAmount: r.total_amount,
          priceBreakdown: r.price_breakdown,
          idempotencyKey: r.idempotency_key,
          expiresAt: r.expires_at,
          confirmedAt: r.confirmed_at,
          cancelledAt: r.cancelled_at,
          createdAt: r.created_at,
          seats: byBooking.get(r.id) ?? [],
        }),
    );
  }
}
