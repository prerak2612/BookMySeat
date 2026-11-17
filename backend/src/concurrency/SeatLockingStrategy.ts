/**
 * Concurrency-control strategies for claiming seats.
 *
 * Both strategies give the same guarantee - two transactions can never both claim the same seat -
 * but they get there differently:
 *
 *  PESSIMISTIC  SELECT ... FOR UPDATE takes exclusive row locks up front. A competing transaction
 *               BLOCKS on the same rows until the winner commits, then re-reads them, sees LOCKED
 *               and fails with SeatUnavailableError. Best under high contention (hot seats).
 *
 *  OPTIMISTIC   Reads without locks, then performs a compare-and-set UPDATE guarded by the row's
 *               `version`. If anyone changed the row in between, fewer rows are updated than
 *               requested and the transaction is rolled back. Best when conflicts are rare.
 *
 * Strategy pattern + Template Method: the common validation lives in AbstractSeatLockingStrategy;
 * subclasses implement only `loadCandidates` and `claim`. They are fully substitutable (LSP), and
 * the active one is selected by configuration (SEAT_LOCK_STRATEGY).
 */
import { NotFoundError, SeatUnavailableError } from '../common/errors.js';
import type { ShowSeat } from '../domain/ShowSeat.js';
import type { UnitOfWork } from '../repositories/interfaces.js';

export type SeatLockingStrategyName = 'PESSIMISTIC' | 'OPTIMISTIC';

export interface SeatLockingStrategy {
  readonly name: SeatLockingStrategyName;
  /** Phase 1 - load the requested seats and verify every one is available at `now`. */
  reserveCandidates(uow: UnitOfWork, showId: number, seatIds: number[], now: Date): Promise<ShowSeat[]>;
  /** Phase 2 - atomically assign the seats to the booking hold, or throw SeatUnavailableError. */
  claim(uow: UnitOfWork, seats: ShowSeat[], bookingId: number, expiresAt: Date): Promise<void>;
}

export abstract class AbstractSeatLockingStrategy implements SeatLockingStrategy {
  abstract readonly name: SeatLockingStrategyName;

  async reserveCandidates(uow: UnitOfWork, showId: number, seatIds: number[], now: Date): Promise<ShowSeat[]> {
    const seats = await this.loadCandidates(uow, showId, seatIds);
    if (seats.length !== seatIds.length) {
      const found = new Set(seats.map((s) => s.seatId));
      const missing = seatIds.filter((id) => !found.has(id));
      throw new NotFoundError(`Seat(s) ${missing.join(', ')} for show ${showId}`);
    }
    const unavailable = seats.filter((s) => !s.isAvailableAt(now)).map((s) => s.seatId);
    if (unavailable.length > 0) throw new SeatUnavailableError(unavailable);
    return seats;
  }

  protected abstract loadCandidates(uow: UnitOfWork, showId: number, seatIds: number[]): Promise<ShowSeat[]>;
  abstract claim(uow: UnitOfWork, seats: ShowSeat[], bookingId: number, expiresAt: Date): Promise<void>;
}

export class PessimisticSeatLockingStrategy extends AbstractSeatLockingStrategy {
  readonly name = 'PESSIMISTIC' as const;

  protected loadCandidates(uow: UnitOfWork, showId: number, seatIds: number[]): Promise<ShowSeat[]> {
    // Row-level exclusive locks, acquired in ascending id order (deadlock avoidance).
    return uow.showSeats.findByShowAndSeatIds(showId, seatIds, { forUpdate: true });
  }

  async claim(uow: UnitOfWork, seats: ShowSeat[], bookingId: number, expiresAt: Date): Promise<void> {
    // We already own the row locks, so nobody else can have changed these rows.
    await uow.showSeats.lockSeats(
      seats.map((s) => s.id),
      bookingId,
      expiresAt,
    );
  }
}

export class OptimisticSeatLockingStrategy extends AbstractSeatLockingStrategy {
  readonly name = 'OPTIMISTIC' as const;

  protected loadCandidates(uow: UnitOfWork, showId: number, seatIds: number[]): Promise<ShowSeat[]> {
    return uow.showSeats.findByShowAndSeatIds(showId, seatIds); // plain read, no locks
  }

  async claim(uow: UnitOfWork, seats: ShowSeat[], bookingId: number, expiresAt: Date): Promise<void> {
    const sorted = [...seats].sort((a, b) => a.id - b.id);
    const updated = new Set(
      await uow.showSeats.lockSeatsIfUnchanged(
        sorted.map((s) => ({ id: s.id, version: s.version })),
        bookingId,
        expiresAt,
      ),
    );
    if (updated.size !== seats.length) {
      // Someone else modified at least one seat after we read it -> we lost the race.
      // Throwing makes TransactionManager roll back the partial update.
      throw new SeatUnavailableError(seats.filter((s) => !updated.has(s.id)).map((s) => s.seatId));
    }
  }
}

export function createSeatLockingStrategy(name: SeatLockingStrategyName): SeatLockingStrategy {
  return name === 'OPTIMISTIC' ? new OptimisticSeatLockingStrategy() : new PessimisticSeatLockingStrategy();
}
