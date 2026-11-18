/**
 * Strategy pattern for seat selection behaviour. The SeatMap component delegates "what happens
 * when a seat is clicked" to the active strategy, so new behaviours (e.g. "best available")
 * are added without touching the component.
 */
import type { SeatMap, SeatView } from '../api/types';

export interface SelectionContext {
  seatMap: SeatMap;
  selected: number[]; // seatIds
  quantity: number;
  maxSeats: number;
}

export interface SeatSelectionStrategy {
  readonly id: string;
  readonly label: string;
  /** Returns the new selection (seatIds) after `clicked` was clicked. */
  onSeatClick(clicked: SeatView, ctx: SelectionContext): number[];
}

const isFree = (s: SeatView) => s.status === 'AVAILABLE';

/** Click toggles one seat at a time. */
export class ManualSelectionStrategy implements SeatSelectionStrategy {
  readonly id = 'manual';
  readonly label = 'Pick seats one by one';

  onSeatClick(clicked: SeatView, { selected, maxSeats }: SelectionContext): number[] {
    if (selected.includes(clicked.seatId)) return selected.filter((id) => id !== clicked.seatId);
    if (!isFree(clicked) || selected.length >= maxSeats) return selected;
    return [...selected, clicked.seatId];
  }
}

/**
 * Click selects a contiguous block of `quantity` free seats in the same row and category,
 * starting at the clicked seat (sliding left if there is not enough room to the right).
 */
export class ContiguousBlockStrategy implements SeatSelectionStrategy {
  readonly id = 'block';
  readonly label = 'Select a block of seats together';

  onSeatClick(clicked: SeatView, { seatMap, selected, quantity }: SelectionContext): number[] {
    if (!isFree(clicked)) return selected;
    const row = seatMap.rows.find((r) => r.row === clicked.row)?.seats ?? [];
    const idx = row.findIndex((s) => s.seatId === clicked.seatId);
    for (let start = idx; start >= Math.max(0, idx - quantity + 1); start--) {
      const block = row.slice(start, start + quantity);
      const contiguous = block.every((s, i) => i === 0 || s.number === block[i - 1]!.number + 1);
      if (block.length === quantity && contiguous && block.every((s) => isFree(s) && s.category === clicked.category)) {
        return block.map((s) => s.seatId);
      }
    }
    return selected; // no block fits here - keep the previous selection
  }
}

export const SELECTION_STRATEGIES: SeatSelectionStrategy[] = [new ManualSelectionStrategy(), new ContiguousBlockStrategy()];

/** After a refresh, drop selected seats that someone else has taken meanwhile. */
export function pruneUnavailable(selected: number[], seatMap: SeatMap): number[] {
  const free = new Set(seatMap.rows.flatMap((r) => r.seats).filter(isFree).map((s) => s.seatId));
  return selected.filter((id) => free.has(id));
}
