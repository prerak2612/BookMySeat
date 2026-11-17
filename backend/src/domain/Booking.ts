import { BusinessRuleError, ConflictError, HoldExpiredError } from '../common/errors.js';
import { Entity } from './Entity.js';
import { BookingStatus } from './enums.js';
import type { Show } from './Show.js';

export interface PriceLine {
  label: string;
  amount: number;
}

/** A line item of a booking (composition: it cannot exist without its Booking). */
export interface BookingSeat {
  showSeatId: number;
  seatLabel: string;
  category: string;
  price: number;
  isActive: boolean;
}

export interface BookingProps {
  id: number;
  reference: string;
  userId: number;
  showId: number;
  status: BookingStatus;
  subtotal: number;
  totalAmount: number;
  priceBreakdown: PriceLine[];
  idempotencyKey: string | null;
  expiresAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  seats: BookingSeat[];
}

export interface CancellationOutcome {
  /** True when money was captured and must be refunded. */
  refundRequired: boolean;
}

/**
 * Booking aggregate root. Owns the booking lifecycle:
 *
 *   PENDING --confirm()--> CONFIRMED --cancel()--> CANCELLED
 *      |--expire()-------> EXPIRED
 *      |--markPaymentFailed()--> FAILED
 *      |--cancel()-------> CANCELLED   (user abandons the hold)
 */
export class Booking extends Entity {
  readonly reference: string;
  readonly userId: number;
  readonly showId: number;
  readonly subtotal: number;
  readonly totalAmount: number;
  readonly priceBreakdown: readonly PriceLine[];
  readonly idempotencyKey: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  #status: BookingStatus;
  #confirmedAt: Date | null;
  #cancelledAt: Date | null;
  #seats: BookingSeat[];

  constructor(props: BookingProps) {
    super(props.id);
    this.reference = props.reference;
    this.userId = props.userId;
    this.showId = props.showId;
    this.subtotal = props.subtotal;
    this.totalAmount = props.totalAmount;
    this.priceBreakdown = props.priceBreakdown;
    this.idempotencyKey = props.idempotencyKey;
    this.expiresAt = props.expiresAt;
    this.createdAt = props.createdAt;
    this.#status = props.status;
    this.#confirmedAt = props.confirmedAt;
    this.#cancelledAt = props.cancelledAt;
    this.#seats = props.seats.map((s) => ({ ...s }));
  }

  get status(): BookingStatus {
    return this.#status;
  }
  get confirmedAt(): Date | null {
    return this.#confirmedAt;
  }
  get cancelledAt(): Date | null {
    return this.#cancelledAt;
  }
  get seats(): readonly BookingSeat[] {
    return this.#seats;
  }
  get showSeatIds(): number[] {
    return this.#seats.map((s) => s.showSeatId);
  }

  isHoldExpired(now: Date): boolean {
    return this.#status === BookingStatus.PENDING && this.expiresAt <= now;
  }

  /** Guard used before charging money. */
  assertPayable(now: Date): void {
    if (this.#status === BookingStatus.CONFIRMED) {
      throw new ConflictError('This booking has already been paid for', { bookingId: this.id });
    }
    if (this.#status === BookingStatus.EXPIRED || this.isHoldExpired(now)) {
      throw new HoldExpiredError(this.id);
    }
    if (this.#status !== BookingStatus.PENDING) {
      throw new ConflictError(`Booking cannot be paid in status ${this.#status}`, { bookingId: this.id, status: this.#status });
    }
  }

  confirm(now: Date): void {
    this.assertPayable(now);
    this.#status = BookingStatus.CONFIRMED;
    this.#confirmedAt = now;
  }

  markPaymentFailed(): void {
    this.transitionToTerminal(BookingStatus.FAILED, [BookingStatus.PENDING]);
  }

  expire(): void {
    this.transitionToTerminal(BookingStatus.EXPIRED, [BookingStatus.PENDING]);
  }

  /**
   * Business rules:
   *  - a PENDING hold can always be abandoned (no money involved);
   *  - a CONFIRMED booking can be cancelled only until `cutoffMinutes` before the show starts;
   *  - anything else is already terminal.
   */
  cancel(now: Date, show: Show, cutoffMinutes: number): CancellationOutcome {
    if (this.#status === BookingStatus.PENDING) {
      this.transitionToTerminal(BookingStatus.CANCELLED, [BookingStatus.PENDING]);
      this.#cancelledAt = now;
      return { refundRequired: false };
    }
    if (this.#status !== BookingStatus.CONFIRMED) {
      throw new ConflictError(`Booking cannot be cancelled in status ${this.#status}`, { status: this.#status });
    }
    if (show.minutesUntilStart(now) < cutoffMinutes) {
      throw new BusinessRuleError(
        'CANCELLATION_WINDOW_CLOSED',
        `Bookings can only be cancelled at least ${cutoffMinutes} minutes before the show starts`,
        { showStartsAt: show.startTime.toISOString() },
      );
    }
    this.transitionToTerminal(BookingStatus.CANCELLED, [BookingStatus.CONFIRMED]);
    this.#cancelledAt = now;
    return { refundRequired: true };
  }

  isCancellable(now: Date, show: Show, cutoffMinutes: number): boolean {
    if (this.#status === BookingStatus.PENDING) return true;
    return this.#status === BookingStatus.CONFIRMED && show.minutesUntilStart(now) >= cutoffMinutes;
  }

  private transitionToTerminal(target: BookingStatus, allowedFrom: BookingStatus[]): void {
    if (!allowedFrom.includes(this.#status)) {
      throw new ConflictError(`Illegal booking transition ${this.#status} -> ${target}`);
    }
    this.#status = target;
    // Terminal states free the seats: line items stop counting as active reservations.
    this.#seats = this.#seats.map((s) => ({ ...s, isActive: false }));
  }
}

/** Unsaved booking produced by BookingBuilder and persisted by the repository. */
export interface BookingDraft {
  reference: string;
  userId: number;
  showId: number;
  subtotal: number;
  totalAmount: number;
  priceBreakdown: PriceLine[];
  idempotencyKey: string | null;
  expiresAt: Date;
  seats: Omit<BookingSeat, 'isActive'>[];
}

/**
 * Builder: a booking has many required parts (user, show, seats, pricing, expiry, optional
 * idempotency key). The builder assembles them step by step and validates the whole before
 * anything touches the database.
 */
export class BookingBuilder {
  private userId?: number;
  private showId?: number;
  private seats: Omit<BookingSeat, 'isActive'>[] = [];
  private subtotal?: number;
  private totalAmount?: number;
  private priceBreakdown: PriceLine[] = [];
  private idempotencyKey: string | null = null;
  private expiresAt?: Date;
  private reference?: string;

  forUser(userId: number): this {
    this.userId = userId;
    return this;
  }
  forShow(showId: number): this {
    this.showId = showId;
    return this;
  }
  withSeat(seat: Omit<BookingSeat, 'isActive'>): this {
    this.seats.push(seat);
    return this;
  }
  withPricing(subtotal: number, total: number, breakdown: PriceLine[]): this {
    this.subtotal = subtotal;
    this.totalAmount = total;
    this.priceBreakdown = breakdown;
    return this;
  }
  withIdempotencyKey(key: string | null | undefined): this {
    this.idempotencyKey = key ?? null;
    return this;
  }
  holdUntil(expiresAt: Date): this {
    this.expiresAt = expiresAt;
    return this;
  }
  withReference(reference: string): this {
    this.reference = reference;
    return this;
  }

  build(): BookingDraft {
    if (this.userId === undefined) throw new Error('BookingBuilder: user is required');
    if (this.showId === undefined) throw new Error('BookingBuilder: show is required');
    if (this.seats.length === 0) throw new Error('BookingBuilder: at least one seat is required');
    if (new Set(this.seats.map((s) => s.showSeatId)).size !== this.seats.length) {
      throw new Error('BookingBuilder: duplicate seats');
    }
    if (this.subtotal === undefined || this.totalAmount === undefined) throw new Error('BookingBuilder: pricing is required');
    if (!this.expiresAt) throw new Error('BookingBuilder: hold expiry is required');
    return {
      reference: this.reference ?? BookingBuilder.generateReference(),
      userId: this.userId,
      showId: this.showId,
      subtotal: this.subtotal,
      totalAmount: this.totalAmount,
      priceBreakdown: this.priceBreakdown,
      idempotencyKey: this.idempotencyKey,
      expiresAt: this.expiresAt,
      seats: this.seats,
    };
  }

  static generateReference(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return `BMS-${code}`;
  }
}
