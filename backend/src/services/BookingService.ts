import type { Clock } from '../common/Clock.js';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  HoldExpiredError,
  NotFoundError,
  PaymentFailedError,
  SeatUnavailableError,
  ValidationError,
} from '../common/errors.js';
import { BookingBuilder, type Booking } from '../domain/Booking.js';
import { PaymentStatus, type PaymentMethod } from '../domain/enums.js';
import type { BookingEvent, BookingEventType } from '../domain/events.js';
import type { User } from '../domain/User.js';
import type { BookingEventPublisher } from '../notifications/BookingEventPublisher.js';
import type { PaymentService } from '../payments/PaymentService.js';
import type { PaymentDetails } from '../payments/PaymentStrategies.js';
import type { PriceCalculator } from '../pricing/pricing.js';
import type { UnitOfWorkFactory } from '../repositories/interfaces.js';
import type { BookingSummary } from '../repositories/readModels.js';
import type { SeatLockService } from './SeatLockService.js';

export interface BookingPolicy {
  holdMinutes: number;
  maxSeatsPerBooking: number;
  cancellationCutoffMinutes: number;
}

export interface BookingView extends BookingSummary {
  cancellable: boolean;
  /** Seconds left on a PENDING hold (0 otherwise). */
  holdSecondsRemaining: number;
}

/** Internal result of a pay transaction: payment failures and expiries must COMMIT, then be reported. */
type PayOutcome =
  | { kind: 'confirmed'; event: BookingEvent }
  | { kind: 'replayed' }
  | { kind: 'payment_failed'; reason: string; event: BookingEvent }
  | { kind: 'expired'; bookingId: number; event: BookingEvent };

/**
 * Application service orchestrating the booking use cases. It owns the TRANSACTION BOUNDARIES;
 * seat-state rules live in SeatLockService/ShowSeat, booking-state rules in the Booking aggregate,
 * money in PaymentService, prices in the PriceCalculator, side effects in event listeners.
 */
export class BookingService {
  constructor(
    private readonly uowFactory: UnitOfWorkFactory,
    private readonly seatLocks: SeatLockService,
    private readonly payments: PaymentService,
    private readonly pricing: PriceCalculator,
    private readonly events: BookingEventPublisher,
    private readonly clock: Clock,
    private readonly policy: BookingPolicy,
  ) {}

  // ------------------------------------------------------------------ 1. hold seats (lock)

  async createHold(user: User, input: { showId: number; seatIds: number[] }, idempotencyKey?: string): Promise<{ booking: BookingView; replayed: boolean }> {
    const seatIds = [...new Set(input.seatIds)];
    if (seatIds.length !== input.seatIds.length) throw new ValidationError('Duplicate seats in request');
    if (seatIds.length > this.policy.maxSeatsPerBooking) {
      throw new BusinessRuleError('TOO_MANY_SEATS', `At most ${this.policy.maxSeatsPerBooking} seats per booking`);
    }

    const result = await this.withConstraintMapping(seatIds, () =>
      this.uowFactory.transaction(async (uow) => {
        const now = this.clock.now();
        if (idempotencyKey) {
          // Serialise retries carrying the same key; the second one sees the first one's booking.
          await uow.advisoryLocks.lockForTransaction(`hold:${user.id}:${idempotencyKey}`);
          const existing = await uow.bookings.findByUserAndIdempotencyKey(user.id, idempotencyKey);
          if (existing) {
            this.assertSameHoldRequest(existing, input.showId, seatIds);
            return { bookingId: existing.id, replayed: true };
          }
        }

        const show = await uow.shows.findById(input.showId);
        if (!show) throw new NotFoundError('Show', input.showId);
        if (!show.isBookableAt(now)) throw new BusinessRuleError('SHOW_NOT_BOOKABLE', 'This show is no longer open for booking');

        const expiresAt = new Date(now.getTime() + this.policy.holdMinutes * 60_000);
        const booking = await this.seatLocks.hold(uow, {
          showId: show.id,
          seatIds,
          now,
          buildDraft: (seats) => {
            const quote = this.pricing.calculate({
              show,
              seats: seats.map((s) => ({ showSeatId: s.id, label: s.label, category: s.category })),
            });
            const builder = new BookingBuilder()
              .forUser(user.id)
              .forShow(show.id)
              .withPricing(quote.subtotal, quote.total, quote.lines)
              .withIdempotencyKey(idempotencyKey)
              .holdUntil(expiresAt);
            quote.seatPrices.forEach((s) => builder.withSeat({ showSeatId: s.showSeatId, seatLabel: s.label, category: s.category, price: s.price }));
            return builder.build();
          },
        });
        return { bookingId: booking.id, replayed: false };
      }),
    );
    return { booking: await this.view(result.bookingId), replayed: result.replayed };
  }

  // ------------------------------------------------------------------ 2. pay -> confirm / fail

  async pay(user: User, bookingId: number, input: { method: PaymentMethod; details: PaymentDetails }, idempotencyKey?: string): Promise<BookingView> {
    const outcome = await this.uowFactory.transaction(async (uow): Promise<PayOutcome> => {
      const now = this.clock.now();
      // Lock order: seats, then booking (same as every other writer -> no deadlocks).
      const { booking, seats } = await this.seatLocks.lockBookingForUpdate(uow, bookingId);
      if (!booking) throw new NotFoundError('Booking', bookingId);
      this.authorize(user, booking);

      if (idempotencyKey && (await uow.payments.findByBookingAndKey(booking.id, idempotencyKey))) {
        return { kind: 'replayed' }; // duplicate submit: return the original outcome
      }

      if (booking.isHoldExpired(now)) {
        await this.seatLocks.expireHold(uow, booking);
        return { kind: 'expired', bookingId: booking.id, event: this.event('BOOKING_EXPIRED', booking, now) };
      }
      booking.assertPayable(now); // 409 if already confirmed / cancelled / failed
      this.seatLocks.assertStillHeld(booking, seats, now);

      // An exception from the gateway (timeout/outage) propagates -> ROLLBACK: the hold survives
      // untouched and the user can retry. A *decline* is a business outcome and is committed.
      const result = await this.payments.charge(input.method, booking.totalAmount, booking.reference, input.details);
      await uow.payments.create({
        bookingId: booking.id,
        amount: booking.totalAmount,
        method: input.method,
        status: result.success ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
        gateway: result.gateway,
        transactionRef: result.transactionRef,
        failureReason: result.failureReason,
        idempotencyKey: idempotencyKey ?? null,
      });

      if (result.success) {
        await this.seatLocks.confirmSeats(uow, booking, seats, now);
        booking.confirm(now);
        await uow.bookings.save(booking);
        return { kind: 'confirmed', event: this.event('BOOKING_CONFIRMED', booking, now) };
      }
      booking.markPaymentFailed();
      await uow.bookings.save(booking);
      await this.seatLocks.releaseSeats(uow, booking);
      const reason = result.failureReason ?? 'Payment declined';
      return { kind: 'payment_failed', reason, event: this.event('PAYMENT_FAILED', booking, now, reason) };
    });

    // Side effects only after COMMIT - never notify about something that was rolled back.
    if (outcome.kind !== 'replayed') await this.events.publish(outcome.event);
    if (outcome.kind === 'expired') throw new HoldExpiredError(outcome.bookingId);
    const view = await this.view(bookingId);
    if (outcome.kind === 'payment_failed' || (outcome.kind === 'replayed' && view.paymentStatus === PaymentStatus.FAILED)) {
      throw new PaymentFailedError(outcome.kind === 'payment_failed' ? outcome.reason : 'Payment failed', { booking: view });
    }
    return view;
  }

  // ------------------------------------------------------------------ 3. cancel

  async cancel(user: User, bookingId: number): Promise<BookingView> {
    const event = await this.uowFactory.transaction(async (uow) => {
      const now = this.clock.now();
      const { booking } = await this.seatLocks.lockBookingForUpdate(uow, bookingId);
      if (!booking) throw new NotFoundError('Booking', bookingId);
      this.authorize(user, booking);
      const show = (await uow.shows.findById(booking.showId))!;

      const { refundRequired } = booking.cancel(now, show, this.policy.cancellationCutoffMinutes);
      let reason = 'Seat hold released.';
      if (refundRequired) {
        const payment = await uow.payments.findSuccessfulByBooking(booking.id);
        if (payment?.transactionRef) {
          const refund = await this.payments.refund(payment.method, payment.transactionRef, payment.amount);
          if (!refund.success) throw new ConflictError(`Refund was rejected by the gateway: ${refund.message}`);
          payment.markRefunded(now);
          await uow.payments.save(payment);
          reason = `Refund of Rs ${payment.amount.toFixed(2)} initiated.`;
        }
      }
      await uow.bookings.save(booking);
      await this.seatLocks.releaseSeats(uow, booking);
      return this.event('BOOKING_CANCELLED', booking, now, reason);
    });
    await this.events.publish(event);
    return this.view(bookingId);
  }

  // ------------------------------------------------------------------ queries

  async get(user: User, bookingId: number): Promise<BookingView> {
    const view = await this.view(bookingId);
    if (!user.canAccessBookingOf(view.userId)) throw new ForbiddenError('You cannot access this booking');
    return view;
  }

  async listForUser(user: User): Promise<BookingView[]> {
    const summaries = await this.uowFactory.db.bookings.listSummariesByUser(user.id);
    return summaries.map((s) => this.decorate(s));
  }

  async listAll(filter: { status?: string; limit?: number }): Promise<BookingView[]> {
    const summaries = await this.uowFactory.db.bookings.listSummaries({ status: filter.status, limit: filter.limit ?? 100 });
    return summaries.map((s) => this.decorate(s));
  }

  // ------------------------------------------------------------------ helpers

  private authorize(user: User, booking: Booking): void {
    if (!user.canAccessBookingOf(booking.userId)) throw new ForbiddenError('You cannot access this booking');
  }

  private assertSameHoldRequest(existing: Booking, showId: number, seatIds: number[]): void {
    // Idempotency keys must not be reused for a *different* request.
    if (existing.showId !== showId || existing.seats.length !== seatIds.length) {
      throw new BusinessRuleError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different booking request');
    }
  }

  /** Converts low-level constraint violations into meaningful domain errors. */
  private async withConstraintMapping<T>(seatIds: number[], work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof AppError) throw err;
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint === 'ux_booking_seats_one_active_per_show_seat') {
        throw new SeatUnavailableError(seatIds); // last line of defence fired
      }
      if (pgErr.code === '23505' && pgErr.constraint === 'ux_bookings_idempotency') {
        throw new ConflictError('A request with this Idempotency-Key is already being processed');
      }
      throw err;
    }
  }

  private event(type: BookingEventType, booking: Booking, now: Date, reason?: string): BookingEvent {
    return {
      type,
      occurredAt: now,
      bookingId: booking.id,
      bookingReference: booking.reference,
      userId: booking.userId,
      showId: booking.showId,
      seatLabels: booking.seats.map((s) => s.seatLabel),
      amount: booking.totalAmount,
      reason,
    };
  }

  private async view(bookingId: number): Promise<BookingView> {
    const summary = await this.uowFactory.db.bookings.findSummary(bookingId);
    if (!summary) throw new NotFoundError('Booking', bookingId);
    return this.decorate(summary);
  }

  private decorate(s: BookingSummary): BookingView {
    const now = this.clock.now();
    const minutesToShow = (s.showStartTime.getTime() - now.getTime()) / 60_000;
    const cancellable =
      (s.status === 'PENDING' && s.expiresAt > now) || (s.status === 'CONFIRMED' && minutesToShow >= this.policy.cancellationCutoffMinutes);
    const holdSecondsRemaining = s.status === 'PENDING' ? Math.max(0, Math.floor((s.expiresAt.getTime() - now.getTime()) / 1000)) : 0;
    return { ...s, cancellable, holdSecondsRemaining };
  }
}
