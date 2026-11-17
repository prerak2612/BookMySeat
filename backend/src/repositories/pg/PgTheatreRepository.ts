import type { Queryable } from '../../db/Database.js';
import { Screen } from '../../domain/Screen.js';
import { Seat } from '../../domain/Seat.js';
import { Theatre } from '../../domain/Theatre.js';
import type { SeatCategory } from '../../domain/enums.js';
import type { TheatreRepository } from '../interfaces.js';
import type { SeatCreate } from '../readModels.js';

interface TheatreRow {
  id: number;
  name: string;
  city: string;
  address: string;
}
interface ScreenRow {
  id: number;
  theatre_id: number;
  name: string;
}
interface SeatRow {
  id: number;
  screen_id: number;
  row_label: string;
  seat_number: number;
  category: SeatCategory;
}

export class PgTheatreRepository implements TheatreRepository {
  constructor(private readonly db: Queryable) {}

  async list(city?: string): Promise<Theatre[]> {
    const { rows } = await this.db.query<TheatreRow>(
      `SELECT id, name, city, address FROM theatres WHERE ($1::text IS NULL OR lower(city) = lower($1)) ORDER BY city, name`,
      [city ?? null],
    );
    if (rows.length === 0) return [];
    const screens = await this.screensFor(rows.map((r) => r.id), false);
    return rows.map((t) => new Theatre(t.id, t.name, t.city, t.address, screens.get(t.id) ?? []));
  }

  async findById(id: number): Promise<Theatre | null> {
    const { rows } = await this.db.query<TheatreRow>('SELECT id, name, city, address FROM theatres WHERE id = $1', [id]);
    const t = rows[0];
    if (!t) return null;
    const screens = await this.screensFor([id], true);
    return new Theatre(t.id, t.name, t.city, t.address, screens.get(id) ?? []);
  }

  async create(data: { name: string; city: string; address: string }): Promise<Theatre> {
    const { rows } = await this.db.query<TheatreRow>(
      'INSERT INTO theatres (name, city, address) VALUES ($1, $2, $3) RETURNING id, name, city, address',
      [data.name, data.city, data.address],
    );
    const t = rows[0]!;
    return new Theatre(t.id, t.name, t.city, t.address);
  }

  async findScreenById(id: number): Promise<Screen | null> {
    const { rows } = await this.db.query<ScreenRow>('SELECT id, theatre_id, name FROM screens WHERE id = $1', [id]);
    const s = rows[0];
    if (!s) return null;
    const seats = await this.seatsFor([id]);
    return new Screen(s.id, s.theatre_id, s.name, seats.get(id) ?? []);
  }

  /** Screen + all seats in ONE statement-group; caller wraps it in a transaction. */
  async createScreen(theatreId: number, name: string, seats: SeatCreate[]): Promise<Screen> {
    const { rows } = await this.db.query<ScreenRow>(
      'INSERT INTO screens (theatre_id, name) VALUES ($1, $2) RETURNING id, theatre_id, name',
      [theatreId, name],
    );
    const screen = rows[0]!;
    // Bulk insert with unnest() - one round trip regardless of seat count.
    await this.db.query(
      `INSERT INTO seats (screen_id, row_label, seat_number, category)
       SELECT $1, r, n, c::seat_category FROM unnest($2::text[], $3::int[], $4::text[]) AS t(r, n, c)`,
      [screen.id, seats.map((s) => s.rowLabel), seats.map((s) => s.seatNumber), seats.map((s) => s.category)],
    );
    return (await this.findScreenById(screen.id))!;
  }

  async listCities(): Promise<string[]> {
    const { rows } = await this.db.query<{ city: string }>('SELECT DISTINCT city FROM theatres ORDER BY city');
    return rows.map((r) => r.city);
  }

  private async screensFor(theatreIds: number[], withSeats: boolean): Promise<Map<number, Screen[]>> {
    const { rows } = await this.db.query<ScreenRow & { capacity: number }>(
      `SELECT sc.id, sc.theatre_id, sc.name, count(se.id)::int AS capacity
       FROM screens sc LEFT JOIN seats se ON se.screen_id = sc.id
       WHERE sc.theatre_id = ANY($1::bigint[]) GROUP BY sc.id ORDER BY sc.name`,
      [theatreIds],
    );
    const seats = withSeats ? await this.seatsFor(rows.map((r) => r.id)) : new Map<number, Seat[]>();
    const map = new Map<number, Screen[]>();
    for (const r of rows) {
      const screen = new Screen(r.id, r.theatre_id, r.name, seats.get(r.id) ?? [], r.capacity);
      map.set(r.theatre_id, [...(map.get(r.theatre_id) ?? []), screen]);
    }
    return map;
  }

  private async seatsFor(screenIds: number[]): Promise<Map<number, Seat[]>> {
    if (screenIds.length === 0) return new Map();
    const { rows } = await this.db.query<SeatRow>(
      `SELECT id, screen_id, row_label, seat_number, category FROM seats
       WHERE screen_id = ANY($1::bigint[]) ORDER BY row_label, seat_number`,
      [screenIds],
    );
    const map = new Map<number, Seat[]>();
    for (const r of rows) {
      const seat = new Seat(r.id, r.screen_id, r.row_label, r.seat_number, r.category);
      map.set(r.screen_id, [...(map.get(r.screen_id) ?? []), seat]);
    }
    return map;
  }
}
