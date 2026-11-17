import type { Queryable } from '../../db/Database.js';
import { Payment, type NewPayment } from '../../domain/Payment.js';
import type { PaymentMethod, PaymentStatus } from '../../domain/enums.js';
import type {
  AdvisoryLockRepository,
  NotificationRecord,
  NotificationRepository,
  PaymentRepository,
  ReportingRepository,
} from '../interfaces.js';
import type { AdminStats } from '../readModels.js';

interface PaymentRow {
  id: number;
  booking_id: number;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  gateway: string;
  transaction_ref: string | null;
  failure_reason: string | null;
  idempotency_key: string | null;
  created_at: Date;
  refunded_at: Date | null;
}

const toPayment = (r: PaymentRow): Payment =>
  new Payment({
    id: r.id,
    bookingId: r.booking_id,
    amount: r.amount,
    method: r.method,
    status: r.status,
    gateway: r.gateway,
    transactionRef: r.transaction_ref,
    failureReason: r.failure_reason,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    refundedAt: r.refunded_at,
  });

export class PgPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Queryable) {}

  async create(p: NewPayment): Promise<Payment> {
    const { rows } = await this.db.query<PaymentRow>(
      `INSERT INTO payments (booking_id, amount, method, status, gateway, transaction_ref, failure_reason, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [p.bookingId, p.amount, p.method, p.status, p.gateway, p.transactionRef, p.failureReason, p.idempotencyKey],
    );
    return toPayment(rows[0]!);
  }

  async findByBookingAndKey(bookingId: number, idempotencyKey: string): Promise<Payment | null> {
    const { rows } = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE booking_id = $1 AND idempotency_key = $2', [
      bookingId,
      idempotencyKey,
    ]);
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async findSuccessfulByBooking(bookingId: number): Promise<Payment | null> {
    const { rows } = await this.db.query<PaymentRow>(`SELECT * FROM payments WHERE booking_id = $1 AND status = 'SUCCESS'`, [bookingId]);
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async save(payment: Payment): Promise<void> {
    await this.db.query('UPDATE payments SET status = $2, refunded_at = $3 WHERE id = $1', [payment.id, payment.status, payment.refundedAt]);
  }
}

interface NotificationRow {
  id: number;
  user_id: number;
  booking_id: number | null;
  type: string;
  channel: string;
  subject: string;
  message: string;
  created_at: Date;
}

const toNotification = (r: NotificationRow): NotificationRecord => ({
  id: r.id,
  userId: r.user_id,
  bookingId: r.booking_id,
  type: r.type,
  channel: r.channel,
  subject: r.subject,
  message: r.message,
  createdAt: r.created_at,
});

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Queryable) {}

  async create(n: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord> {
    const { rows } = await this.db.query<NotificationRow>(
      `INSERT INTO notifications (user_id, booking_id, type, channel, subject, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [n.userId, n.bookingId, n.type, n.channel, n.subject, n.message],
    );
    return toNotification(rows[0]!);
  }

  async listByUser(userId: number, limit = 50): Promise<NotificationRecord[]> {
    const { rows } = await this.db.query<NotificationRow>(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
      [userId, limit],
    );
    return rows.map(toNotification);
  }
}

export class PgReportingRepository implements ReportingRepository {
  constructor(private readonly db: Queryable) {}

  async stats(now: Date): Promise<AdminStats> {
    const [totals, byStatus, money, top] = await Promise.all([
      this.db.query<AdminStats['totals']>(
        `SELECT (SELECT count(*)::int FROM movies WHERE is_active) AS movies,
                (SELECT count(*)::int FROM theatres) AS theatres,
                (SELECT count(*)::int FROM screens) AS screens,
                (SELECT count(*)::int FROM shows WHERE status = 'SCHEDULED' AND start_time > $1) AS "upcomingShows",
                (SELECT count(*)::int FROM users) AS users`,
        [now],
      ),
      this.db.query<{ status: string; count: number }>('SELECT status, count(*)::int AS count FROM bookings GROUP BY status'),
      this.db.query<{ revenue: number; refunded: number }>(
        `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'SUCCESS'), 0)::numeric AS revenue,
                COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'), 0)::numeric AS refunded
         FROM payments`,
      ),
      this.db.query<AdminStats['topMovies'][number]>(
        `SELECT m.id AS "movieId", m.title, count(b.id)::int AS "confirmedBookings",
                COALESCE(sum(b.total_amount), 0)::numeric AS revenue
         FROM movies m
         JOIN shows sh ON sh.movie_id = m.id
         JOIN bookings b ON b.show_id = sh.id AND b.status = 'CONFIRMED'
         GROUP BY m.id ORDER BY revenue DESC LIMIT 5`,
      ),
    ]);
    return {
      totals: totals.rows[0]!,
      bookingsByStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.count])),
      revenue: money.rows[0]!.revenue,
      refunded: money.rows[0]!.refunded,
      topMovies: top.rows,
    };
  }
}

export class PgAdvisoryLockRepository implements AdvisoryLockRepository {
  constructor(private readonly db: Queryable) {}

  /** Transaction-scoped: released automatically on COMMIT/ROLLBACK, so it can never leak. */
  async lockForTransaction(key: string): Promise<void> {
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
}
