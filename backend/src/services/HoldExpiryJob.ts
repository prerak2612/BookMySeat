import type { Clock } from '../common/Clock.js';
import { logger } from '../common/logger.js';
import type { BookingEvent } from '../domain/events.js';
import type { BookingEventPublisher } from '../notifications/BookingEventPublisher.js';
import type { UnitOfWorkFactory } from '../repositories/interfaces.js';
import type { SeatLockService } from './SeatLockService.js';

/**
 * Background sweeper for abandoned holds. Expired locks are ALSO treated as available lazily by
 * every read and lock query, so correctness never depends on this job running on time - it only
 * keeps the data tidy (bookings marked EXPIRED, seats back to AVAILABLE) and notifies users.
 */
export class HoldExpiryJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly uowFactory: UnitOfWorkFactory,
    private readonly seatLocks: SeatLockService,
    private readonly events: BookingEventPublisher,
    private readonly clock: Clock,
    private readonly batchSize = 100,
  ) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => logger.error('hold_expiry.failed', { error: (e as Error).message })), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns the number of holds expired in this run. */
  async runOnce(): Promise<number> {
    if (this.running) return 0; // never overlap two sweeps in one process
    this.running = true;
    try {
      const now = this.clock.now();
      const ids = await this.uowFactory.db.bookings.findExpiredPendingIds(now, this.batchSize);
      let expired = 0;
      for (const id of ids) {
        const event = await this.uowFactory.transaction(async (uow): Promise<BookingEvent | null> => {
          const { booking } = await this.seatLocks.lockBookingForUpdate(uow, id);
          // Re-check under lock: the user may have paid or cancelled in the meantime.
          if (!booking || !booking.isHoldExpired(now)) return null;
          await this.seatLocks.expireHold(uow, booking);
          return {
            type: 'BOOKING_EXPIRED',
            occurredAt: now,
            bookingId: booking.id,
            bookingReference: booking.reference,
            userId: booking.userId,
            showId: booking.showId,
            seatLabels: booking.seats.map((s) => s.seatLabel),
            amount: booking.totalAmount,
          };
        });
        if (event) {
          expired++;
          await this.events.publish(event);
        }
      }
      const orphans = await this.uowFactory.db.showSeats.releaseOrphanedLocks(now);
      if (expired > 0 || orphans > 0) logger.info('hold_expiry.swept', { expired, orphans });
      return expired;
    } finally {
      this.running = false;
    }
  }
}
