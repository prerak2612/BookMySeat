import type { Clock } from '../common/Clock.js';
import { NotFoundError } from '../common/errors.js';
import { SeatCategory, ShowSeatStatus } from '../domain/enums.js';
import type { SeatPricingStrategy } from '../pricing/pricing.js';
import type { UnitOfWorkFactory } from '../repositories/interfaces.js';
import type { ShowDetails } from '../repositories/readModels.js';

export interface SeatView {
  seatId: number;
  showSeatId: number;
  row: string;
  number: number;
  label: string;
  category: SeatCategory;
  status: ShowSeatStatus;
  price: number;
}

export interface SeatMap {
  show: ShowDetails;
  rows: { row: string; seats: SeatView[] }[];
  summary: Record<ShowSeatStatus, number>;
  categoryPrices: Record<SeatCategory, number>;
  serverTime: Date;
}

/**
 * Read side of seat inventory. It reports the *effective* status (an expired lock is shown as
 * AVAILABLE). This is informational only - the write path re-validates everything under lock.
 */
export class SeatAvailabilityService {
  constructor(
    private readonly uowFactory: UnitOfWorkFactory,
    private readonly pricing: SeatPricingStrategy,
    private readonly clock: Clock,
  ) {}

  async getSeatMap(showId: number): Promise<SeatMap> {
    const now = this.clock.now();
    const { shows, showSeats } = this.uowFactory.db;
    const show = await shows.findDetails(showId, now);
    if (!show) throw new NotFoundError('Show', showId);

    const seats = await showSeats.findByShow(showId);
    const summary = { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } as Record<ShowSeatStatus, number>;
    const rows = new Map<string, SeatView[]>();
    for (const s of seats) {
      const status = s.effectiveStatus(now);
      summary[status]++;
      const view: SeatView = {
        seatId: s.seatId,
        showSeatId: s.id,
        row: s.rowLabel,
        number: s.seatNumber,
        label: s.label,
        category: s.category,
        status,
        price: this.pricing.priceForSeat(s.category, show.basePrice),
      };
      rows.set(s.rowLabel, [...(rows.get(s.rowLabel) ?? []), view]);
    }
    const categoryPrices = Object.fromEntries(
      Object.values(SeatCategory).map((c) => [c, this.pricing.priceForSeat(c, show.basePrice)]),
    ) as Record<SeatCategory, number>;

    return {
      show,
      rows: [...rows.entries()].map(([row, list]) => ({ row, seats: list.sort((a, b) => a.number - b.number) })),
      summary,
      categoryPrices,
      serverTime: now,
    };
  }
}
