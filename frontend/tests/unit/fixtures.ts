import type { SeatCategory, SeatMap, SeatStatus, SeatView } from '../../src/api/types';

export function makeSeat(row: string, number: number, status: SeatStatus = 'AVAILABLE', category: SeatCategory = 'REGULAR'): SeatView {
  const seatId = row.charCodeAt(0) * 100 + number;
  return { seatId, showSeatId: seatId + 10000, row, number, label: `${row}${number}`, category, status, price: category === 'REGULAR' ? 200 : 300 };
}

export function makeSeatMap(rows: { row: string; statuses: SeatStatus[]; category?: SeatCategory }[]): SeatMap {
  const built = rows.map((r) => ({ row: r.row, seats: r.statuses.map((s, i) => makeSeat(r.row, i + 1, s, r.category)) }));
  const all = built.flatMap((r) => r.seats);
  return {
    show: {
      id: 1, movieId: 1, startTime: '2026-12-02T14:00:00Z', endTime: '2026-12-02T17:00:00Z', basePrice: 200, status: 'SCHEDULED',
      screenId: 1, screenName: 'Audi 1', theatreId: 1, theatreName: 'Galaxy', city: 'Mumbai', availableSeats: 0, totalSeats: all.length,
      movieTitle: 'Test', movieLanguage: 'English', movieCertificate: 'UA', durationMinutes: 120, theatreAddress: 'Road',
    },
    rows: built,
    summary: {
      AVAILABLE: all.filter((s) => s.status === 'AVAILABLE').length,
      LOCKED: all.filter((s) => s.status === 'LOCKED').length,
      BOOKED: all.filter((s) => s.status === 'BOOKED').length,
    },
    categoryPrices: { REGULAR: 200, PREMIUM: 300, RECLINER: 440 },
    serverTime: '2026-12-02T10:00:00Z',
  };
}
