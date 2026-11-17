/**
 * Persistence ports. Services depend on these interfaces (Dependency Inversion), never on `pg`.
 * Interfaces are kept small and role-specific (Interface Segregation): e.g. catalogue browsing
 * only needs MovieReader, the admin flow additionally needs MovieWriter.
 */
import type { Booking, BookingDraft } from '../domain/Booking.js';
import type { Movie, MovieProps } from '../domain/Movie.js';
import type { NewPayment, Payment } from '../domain/Payment.js';
import type { Screen } from '../domain/Screen.js';
import type { Show, ShowProps } from '../domain/Show.js';
import type { ShowSeat } from '../domain/ShowSeat.js';
import type { Theatre } from '../domain/Theatre.js';
import type { User, UserProps } from '../domain/User.js';
import type {
  AdminStats,
  BookingSummary,
  MovieFilter,
  SeatCreate,
  ShowDetails,
  ShowFilter,
  ShowListing,
} from './readModels.js';

export interface LockOptions {
  /** Take a row-level exclusive lock (SELECT ... FOR UPDATE) until the transaction ends. */
  forUpdate?: boolean;
}

export interface UserRepository {
  findById(id: number): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Omit<UserProps, 'id' | 'createdAt'>): Promise<User>;
}

export interface MovieReader {
  findById(id: number): Promise<Movie | null>;
  search(filter: MovieFilter): Promise<Movie[]>;
}

export interface MovieWriter {
  create(data: Omit<MovieProps, 'id'>): Promise<Movie>;
  update(id: number, data: Partial<Omit<MovieProps, 'id'>>): Promise<Movie | null>;
}

export interface MovieRepository extends MovieReader, MovieWriter {}

export interface TheatreRepository {
  list(city?: string): Promise<Theatre[]>;
  findById(id: number): Promise<Theatre | null>;
  create(data: { name: string; city: string; address: string }): Promise<Theatre>;
  findScreenById(id: number): Promise<Screen | null>;
  createScreen(theatreId: number, name: string, seats: SeatCreate[]): Promise<Screen>;
  listCities(): Promise<string[]>;
}

export interface ShowRepository {
  findById(id: number): Promise<Show | null>;
  findDetails(id: number, now: Date): Promise<ShowDetails | null>;
  listForMovie(movieId: number, filter: ShowFilter, now: Date): Promise<ShowListing[]>;
  /** Creates the show and one AVAILABLE show_seat per physical seat of the screen, atomically. */
  createWithInventory(data: Omit<ShowProps, 'id' | 'status'>): Promise<Show>;
}

/** Seat-inventory port: everything the concurrency layer needs, nothing more. */
export interface ShowSeatRepository {
  findByShow(showId: number): Promise<ShowSeat[]>;
  findByShowAndSeatIds(showId: number, seatIds: number[], options?: LockOptions): Promise<ShowSeat[]>;
  findByIds(ids: number[], options?: LockOptions): Promise<ShowSeat[]>;
  /** Unconditional lock of rows the caller already holds with FOR UPDATE (pessimistic path). */
  lockSeats(ids: number[], bookingId: number, expiresAt: Date): Promise<void>;
  /** Compare-and-set on `version` (optimistic path). Returns ids that were actually updated. */
  lockSeatsIfUnchanged(seats: { id: number; version: number }[], bookingId: number, expiresAt: Date): Promise<number[]>;
  markBooked(ids: number[], bookingId: number): Promise<number>;
  /** Releases only seats still owned by `bookingId` (never someone else's lock). */
  releaseForBooking(bookingId: number, ids?: number[]): Promise<number>;
  /** Frees expired locks whose booking is no longer PENDING (left over after a lazy re-claim). */
  releaseOrphanedLocks(now: Date): Promise<number>;
}

export interface BookingRepository {
  /** Inserts the booking header (status PENDING) and returns its id. */
  createHeader(draft: BookingDraft): Promise<number>;
  /** Inserts the line items. Guarded by the partial unique index on active show seats. */
  addLines(bookingId: number, seats: BookingDraft['seats']): Promise<void>;
  findById(id: number, options?: LockOptions): Promise<Booking | null>;
  findByIds(ids: number[], options?: LockOptions): Promise<Booking[]>;
  findByUserAndIdempotencyKey(userId: number, key: string): Promise<Booking | null>;
  /** Persists status, timestamps and line-item activity. */
  save(booking: Booking): Promise<void>;
  /** Deactivates the line items of other (stale) bookings for seats being re-claimed. */
  deactivateLinesForShowSeats(showSeatIds: number[], exceptBookingId?: number): Promise<void>;
  findExpiredPendingIds(now: Date, limit: number): Promise<number[]>;
  findSummary(id: number): Promise<BookingSummary | null>;
  listSummariesByUser(userId: number): Promise<BookingSummary[]>;
  listSummaries(filter: { status?: string; limit: number }): Promise<BookingSummary[]>;
}

export interface PaymentRepository {
  create(payment: NewPayment): Promise<Payment>;
  findByBookingAndKey(bookingId: number, idempotencyKey: string): Promise<Payment | null>;
  findSuccessfulByBooking(bookingId: number): Promise<Payment | null>;
  save(payment: Payment): Promise<void>;
}

export interface NotificationRecord {
  id: number;
  userId: number;
  bookingId: number | null;
  type: string;
  channel: string;
  subject: string;
  message: string;
  createdAt: Date;
}

export interface NotificationRepository {
  create(n: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord>;
  listByUser(userId: number, limit?: number): Promise<NotificationRecord[]>;
}

export interface ReportingRepository {
  stats(now: Date): Promise<AdminStats>;
}

/** Transaction-scoped advisory locks (used to serialise duplicate idempotent requests). */
export interface AdvisoryLockRepository {
  lockForTransaction(key: string): Promise<void>;
}

/** Unit of Work: one consistent set of repositories bound to a single connection/transaction. */
export interface UnitOfWork {
  users: UserRepository;
  movies: MovieRepository;
  theatres: TheatreRepository;
  shows: ShowRepository;
  showSeats: ShowSeatRepository;
  bookings: BookingRepository;
  payments: PaymentRepository;
  notifications: NotificationRepository;
  reporting: ReportingRepository;
  advisoryLocks: AdvisoryLockRepository;
}

export interface UnitOfWorkFactory {
  /** Repositories on the shared pool (autocommit) - for reads and single-statement writes. */
  readonly db: UnitOfWork;
  /** Runs `work` inside one ACID transaction; throws -> ROLLBACK, returns -> COMMIT. */
  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
