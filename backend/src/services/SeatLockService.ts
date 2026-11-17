import { HoldExpiredError } from '../common/errors.js';
import type { Booking, BookingDraft } from '../domain/Booking.js';
import type { ShowSeat } from '../domain/ShowSeat.js';
import type { SeatLockingStrategy } from '../concurrency/SeatLockingStrategy.js';
import type { UnitOfWork } from '../repositories/interfaces.js';

/**
 * Owns the seat lifecycle AVAILABLE -> LOCKED -> BOOKED -> AVAILABLE inside a caller-provided
 * transaction (UnitOfWork). It never opens transactions itself - BookingService decides the
 * transaction boundary - so every operation here is atomic with the surrounding booking change.
 *
 * Global lock order (deadlock avoidance) used by EVERY write path in the system:
 *     1. show_seats rows, ascending id      2. bookings rows, ascending id
 */
export class SeatLockService {
  constructor(readonly strategy: SeatLockingStrategy) {}

  /**
   * Temporarily locks the seats for a new PENDING booking.
   * @param buildDraft builds the booking from the (validated) seats - pricing is done by the caller.
   */
  async hold(
    uow: UnitOfWork,
    params: { showId: number; seatIds: number[]; now: Date; buildDraft: (seats: ShowSeat[]) => BookingDraft },
  ): Promise<Booking> {
    const { showId, seatIds, now } = params;
    // 1. Load + validate (pessimistic strategy also row-locks here).
    const seats = await this.strategy.reserveCandidates(uow, showId, seatIds, now);

    // 2. Re-claim seats whose previous hold has expired but was not swept yet.
    await this.reclaimExpiredHolds(uow, seats, now);

    // 3. Create the booking header, claim the seats for it, then attach the line items.
    const draft = params.buildDraft(seats);
    const bookingId = await uow.bookings.createHeader(draft);
    await this.strategy.claim(uow, seats, bookingId, draft.expiresAt);
    await uow.bookings.addLines(bookingId, draft.seats);
    return (await uow.bookings.findById(bookingId))!;
  }

  /**
   * Row-locks every seat a booking currently references, then the booking itself, in the global
   * lock order. Returns the locked booking (fresh state) and its seats.
   */
  async lockBookingForUpdate(uow: UnitOfWork, bookingId: number): Promise<{ booking: Booking | null; seats: ShowSeat[] }> {
    const snapshot = await uow.bookings.findById(bookingId);
    if (!snapshot) return { booking: null, seats: [] };
    const activeIds = snapshot.seats.filter((s) => s.isActive).map((s) => s.showSeatId);
    const seats = await uow.showSeats.findByIds(activeIds, { forUpdate: true });
    const booking = await uow.bookings.findById(bookingId, { forUpdate: true });
    return { booking, seats };
  }

  /** Throws HoldExpiredError unless every seat is still held by this booking. */
  assertStillHeld(booking: Booking, seats: ShowSeat[], now: Date): void {
    const held = seats.length === booking.seats.filter((s) => s.isActive).length && seats.every((s) => s.isHeldBy(booking.id, now));
    if (!held || booking.isHoldExpired(now)) throw new HoldExpiredError(booking.id);
  }

  /** LOCKED -> BOOKED for every seat of the booking. */
  async confirmSeats(uow: UnitOfWork, booking: Booking, seats: ShowSeat[], now: Date): Promise<void> {
    seats.forEach((s) => s.book(booking.id, now)); // domain-level guard of the transition
    const updated = await uow.showSeats.markBooked(
      seats.map((s) => s.id),
      booking.id,
    );
    if (updated !== seats.length) throw new HoldExpiredError(booking.id); // defensive: rolls back
  }

  /** Any state -> AVAILABLE, for seats still owned by this booking only. */
  async releaseSeats(uow: UnitOfWork, booking: Booking): Promise<number> {
    return uow.showSeats.releaseForBooking(booking.id);
  }

  /** Expires a PENDING hold whose time is up (used by payment, cancellation and the sweeper). */
  async expireHold(uow: UnitOfWork, booking: Booking): Promise<void> {
    booking.expire();
    await uow.bookings.save(booking);
    await this.releaseSeats(uow, booking);
  }

  private async reclaimExpiredHolds(uow: UnitOfWork, seats: ShowSeat[], now: Date): Promise<void> {
    const stale = seats.filter((s) => s.hasExpiredLock(now));
    if (stale.length === 0) return;
    // Free the old reservation lines first so the unique "one active line per seat" index allows ours.
    await uow.bookings.deactivateLinesForShowSeats(stale.map((s) => s.id));
    const staleBookingIds = [...new Set(stale.map((s) => s.bookingId!))];
    // Lock order respected: show_seats already locked/claimed, bookings now (ascending id).
    for (const old of await uow.bookings.findByIds(staleBookingIds, { forUpdate: true })) {
      if (old.isHoldExpired(now)) {
        old.expire();
        await uow.bookings.save(old);
      }
    }
  }
}
