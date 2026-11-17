import { ValidationError } from '../common/errors.js';
import { SeatCategory } from '../domain/enums.js';
import type { SeatCreate } from '../repositories/readModels.js';

export interface RowSpec {
  label: string;
  seats: number;
  category: SeatCategory;
}

export type LayoutSpec = { preset: 'SMALL' | 'MEDIUM' | 'LARGE' } | { rows: RowSpec[] };

/**
 * Factory: produces the physical seats of a screen either from a named preset or from an explicit
 * row specification, enforcing layout rules in one place.
 */
export class SeatLayoutFactory {
  static readonly PRESETS: Record<'SMALL' | 'MEDIUM' | 'LARGE', RowSpec[]> = {
    SMALL: SeatLayoutFactory.rows('ABCDE', 10, { D: SeatCategory.PREMIUM, E: SeatCategory.RECLINER }),
    MEDIUM: SeatLayoutFactory.rows('ABCDEFGH', 12, { F: SeatCategory.PREMIUM, G: SeatCategory.PREMIUM, H: SeatCategory.RECLINER }),
    LARGE: SeatLayoutFactory.rows('ABCDEFGHIJ', 16, {
      G: SeatCategory.PREMIUM,
      H: SeatCategory.PREMIUM,
      I: SeatCategory.PREMIUM,
      J: SeatCategory.RECLINER,
    }),
  };

  static create(spec: LayoutSpec): SeatCreate[] {
    const rows = 'preset' in spec ? SeatLayoutFactory.PRESETS[spec.preset] : spec.rows;
    if (!rows || rows.length === 0) throw new ValidationError('A screen needs at least one row');
    const labels = rows.map((r) => r.label.toUpperCase());
    if (new Set(labels).size !== labels.length) throw new ValidationError('Row labels must be unique');
    return rows.flatMap((r) =>
      Array.from({ length: r.seats }, (_, i) => ({ rowLabel: r.label.toUpperCase(), seatNumber: i + 1, category: r.category })),
    );
  }

  private static rows(labels: string, seats: number, overrides: Record<string, SeatCategory>): RowSpec[] {
    return [...labels].map((label) => ({ label, seats, category: overrides[label] ?? SeatCategory.REGULAR }));
  }
}
