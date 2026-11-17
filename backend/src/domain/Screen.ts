import { Entity } from './Entity.js';
import type { Seat } from './Seat.js';

/**
 * Composition: a Screen owns its Seats. Seats have no meaning without their screen and are
 * deleted with it (ON DELETE CASCADE in the schema).
 */
export class Screen extends Entity {
  readonly #seats: Seat[];

  constructor(
    id: number,
    readonly theatreId: number,
    readonly name: string,
    seats: Seat[] = [],
    /** Seat count when the seats themselves were not loaded (list views). */
    private readonly capacityHint?: number,
  ) {
    super(id);
    this.#seats = [...seats];
  }

  get seats(): readonly Seat[] {
    return this.#seats;
  }

  get capacity(): number {
    return this.#seats.length > 0 ? this.#seats.length : (this.capacityHint ?? 0);
  }
}
