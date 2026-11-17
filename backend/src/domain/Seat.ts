import { Entity } from './Entity.js';
import { SeatCategory } from './enums.js';

/** A physical seat in a screen. Immutable; per-show state lives in ShowSeat. */
export class Seat extends Entity {
  constructor(
    id: number,
    readonly screenId: number,
    readonly rowLabel: string,
    readonly seatNumber: number,
    readonly category: SeatCategory,
  ) {
    super(id);
  }

  get label(): string {
    return `${this.rowLabel}${this.seatNumber}`;
  }
}
