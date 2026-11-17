import { Entity } from './Entity.js';
import { SeatCategory, ShowSeatStatus } from './enums.js';

export interface ShowSeatProps {
  id: number;
  showId: number;
  seatId: number;
  rowLabel: string;
  seatNumber: number;
  category: SeatCategory;
  status: ShowSeatStatus;
  bookingId: number | null;
  lockExpiresAt: Date | null;
  version: number;
}

/**
 * Per-show seat inventory with an encapsulated state machine:
 *
 *   AVAILABLE --lock()--> LOCKED --book()--> BOOKED
 *       ^                   |                  |
 *       +----release()------+------release()---+   (expiry, payment failure, cancellation)
 *
 * State can only change through these methods; illegal transitions throw.
 */
export class ShowSeat extends Entity {
  readonly showId: number;
  readonly seatId: number;
  readonly rowLabel: string;
  readonly seatNumber: number;
  readonly category: SeatCategory;
  readonly version: number;
  #status: ShowSeatStatus;
  #bookingId: number | null;
  #lockExpiresAt: Date | null;

  constructor(props: ShowSeatProps) {
    super(props.id);
    this.showId = props.showId;
    this.seatId = props.seatId;
    this.rowLabel = props.rowLabel;
    this.seatNumber = props.seatNumber;
    this.category = props.category;
    this.version = props.version;
    this.#status = props.status;
    this.#bookingId = props.bookingId;
    this.#lockExpiresAt = props.lockExpiresAt;
  }

  get status(): ShowSeatStatus {
    return this.#status;
  }
  get bookingId(): number | null {
    return this.#bookingId;
  }
  get lockExpiresAt(): Date | null {
    return this.#lockExpiresAt;
  }
  get label(): string {
    return `${this.rowLabel}${this.seatNumber}`;
  }

  /** A lock whose expiry time has passed no longer protects the seat. */
  hasExpiredLock(now: Date): boolean {
    return this.#status === ShowSeatStatus.LOCKED && !!this.#lockExpiresAt && this.#lockExpiresAt <= now;
  }

  isAvailableAt(now: Date): boolean {
    return this.#status === ShowSeatStatus.AVAILABLE || this.hasExpiredLock(now);
  }

  isHeldBy(bookingId: number, now: Date): boolean {
    return this.#status === ShowSeatStatus.LOCKED && this.#bookingId === bookingId && !this.hasExpiredLock(now);
  }

  /** The status a client should see right now (expired locks are shown as available). */
  effectiveStatus(now: Date): ShowSeatStatus {
    return this.hasExpiredLock(now) ? ShowSeatStatus.AVAILABLE : this.#status;
  }

  lock(bookingId: number, expiresAt: Date, now: Date): void {
    if (!this.isAvailableAt(now)) {
      throw new Error(`Seat ${this.label} cannot be locked from state ${this.#status}`);
    }
    this.#status = ShowSeatStatus.LOCKED;
    this.#bookingId = bookingId;
    this.#lockExpiresAt = expiresAt;
  }

  book(bookingId: number, now: Date): void {
    if (!this.isHeldBy(bookingId, now)) {
      throw new Error(`Seat ${this.label} is not held by booking ${bookingId}`);
    }
    this.#status = ShowSeatStatus.BOOKED;
    this.#lockExpiresAt = null;
  }

  release(): void {
    this.#status = ShowSeatStatus.AVAILABLE;
    this.#bookingId = null;
    this.#lockExpiresAt = null;
  }
}
