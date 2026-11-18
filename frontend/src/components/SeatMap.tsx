import type { SeatCategory, SeatMap as SeatMapData, SeatView } from '../api/types';
import { formatMoney } from './common';

const CATEGORY_LABEL: Record<SeatCategory, string> = { REGULAR: 'Regular', PREMIUM: 'Premium', RECLINER: 'Recliner' };

export type SeatVisualState = 'available' | 'selected' | 'locked' | 'booked';

export function seatVisualState(seat: SeatView, selected: Set<number>): SeatVisualState {
  if (seat.status === 'BOOKED') return 'booked';
  if (seat.status === 'LOCKED') return 'locked';
  return selected.has(seat.seatId) ? 'selected' : 'available';
}

interface Props {
  seatMap: SeatMapData;
  selected: number[];
  onSeatClick(seat: SeatView): void;
  disabled?: boolean;
}

/**
 * Presentational seat grid. Rows are grouped into category sections (front -> back), and the
 * four states are distinguishable by colour AND by shape/pattern + aria-label (accessibility).
 */
export function SeatMap({ seatMap, selected, onSeatClick, disabled }: Props) {
  const selectedSet = new Set(selected);
  // Group consecutive rows by category for section headers.
  const sections: { category: SeatCategory; rows: SeatMapData['rows'] }[] = [];
  for (const row of seatMap.rows) {
    const category = row.seats[0]?.category ?? 'REGULAR';
    const last = sections[sections.length - 1];
    if (last && last.category === category) last.rows.push(row);
    else sections.push({ category, rows: [row] });
  }

  return (
    <div className="seatmap" aria-label="Seat layout">
      {sections.map((section) => (
        <section key={section.rows[0]!.row} className="seat-section">
          <h4 className="seat-section-title">
            {CATEGORY_LABEL[section.category]} · {formatMoney(seatMap.categoryPrices[section.category])}
          </h4>
          {section.rows.map(({ row, seats }) => (
            <div key={row} className="seat-row">
              <span className="row-label">{row}</span>
              {seats.map((seat) => {
                const state = seatVisualState(seat, selectedSet);
                const clickable = !disabled && (state === 'available' || state === 'selected');
                return (
                  <button
                    key={seat.seatId}
                    type="button"
                    className={`seat seat-${state} seat-cat-${seat.category.toLowerCase()}`}
                    data-seat={seat.label}
                    data-state={state}
                    aria-pressed={state === 'selected'}
                    aria-label={`Seat ${seat.label}, ${CATEGORY_LABEL[seat.category]}, ${state}, ${formatMoney(seat.price)}`}
                    title={`${seat.label} · ${CATEGORY_LABEL[seat.category]} · ${formatMoney(seat.price)}`}
                    disabled={!clickable}
                    onClick={() => onSeatClick(seat)}
                  >
                    {seat.number}
                  </button>
                );
              })}
              <span className="row-label">{row}</span>
            </div>
          ))}
        </section>
      ))}
      <div className="screen-indicator">SCREEN THIS WAY</div>
      <SeatLegend summary={seatMap.summary} selectedCount={selected.length} />
    </div>
  );
}

export function SeatLegend({ summary, selectedCount }: { summary: SeatMapData['summary']; selectedCount: number }) {
  const items: [SeatVisualState, string, number][] = [
    ['available', 'Available', summary.AVAILABLE - selectedCount],
    ['selected', 'Selected', selectedCount],
    ['locked', 'Held by others', summary.LOCKED],
    ['booked', 'Booked', summary.BOOKED],
  ];
  return (
    <ul className="legend" aria-label="Seat legend">
      {items.map(([state, label, count]) => (
        <li key={state}>
          <span className={`seat seat-${state} legend-swatch`} aria-hidden="true" />
          {label} <strong data-testid={`legend-${state}`}>{Math.max(0, count)}</strong>
        </li>
      ))}
    </ul>
  );
}
