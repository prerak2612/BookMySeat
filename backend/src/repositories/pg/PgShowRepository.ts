import type { Queryable } from '../../db/Database.js';
import { Show, type ShowProps } from '../../domain/Show.js';
import type { ShowStatus } from '../../domain/enums.js';
import type { ShowRepository } from '../interfaces.js';
import type { ShowDetails, ShowFilter, ShowListing } from '../readModels.js';

interface ShowRow {
  id: number;
  movie_id: number;
  screen_id: number;
  start_time: Date;
  end_time: Date;
  base_price: number;
  status: ShowStatus;
}

const toShow = (r: ShowRow): Show =>
  new Show({
    id: r.id,
    movieId: r.movie_id,
    screenId: r.screen_id,
    startTime: r.start_time,
    endTime: r.end_time,
    basePrice: r.base_price,
    status: r.status,
  });

// Availability is computed against the caller's clock ($1): an expired lock counts as available.
const LISTING_SELECT = `
  SELECT sh.id, sh.movie_id, sh.start_time, sh.end_time, sh.base_price, sh.status,
         sc.id AS screen_id, sc.name AS screen_name, t.id AS theatre_id, t.name AS theatre_name, t.city, t.address,
         (SELECT count(*)::int FROM show_seats ss WHERE ss.show_id = sh.id
            AND (ss.status = 'AVAILABLE' OR (ss.status = 'LOCKED' AND ss.lock_expires_at <= $1))) AS available_seats,
         (SELECT count(*)::int FROM show_seats ss WHERE ss.show_id = sh.id) AS total_seats
  FROM shows sh
  JOIN screens sc ON sc.id = sh.screen_id
  JOIN theatres t ON t.id = sc.theatre_id`;

interface ListingRow extends ShowRow {
  screen_name: string;
  theatre_id: number;
  theatre_name: string;
  city: string;
  address: string;
  available_seats: number;
  total_seats: number;
}

const toListing = (r: ListingRow): ShowListing => ({
  id: r.id,
  movieId: r.movie_id,
  startTime: r.start_time,
  endTime: r.end_time,
  basePrice: r.base_price,
  status: r.status,
  screenId: r.screen_id,
  screenName: r.screen_name,
  theatreId: r.theatre_id,
  theatreName: r.theatre_name,
  city: r.city,
  availableSeats: r.available_seats,
  totalSeats: r.total_seats,
});

export class PgShowRepository implements ShowRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<Show | null> {
    const { rows } = await this.db.query<ShowRow>('SELECT * FROM shows WHERE id = $1', [id]);
    return rows[0] ? toShow(rows[0]) : null;
  }

  async findDetails(id: number, now: Date): Promise<ShowDetails | null> {
    const { rows } = await this.db.query<
      ListingRow & { movie_title: string; movie_language: string; movie_certificate: string; duration_minutes: number }
    >(
      `SELECT x.*, m.title AS movie_title, m.language AS movie_language, m.certificate AS movie_certificate, m.duration_minutes
       FROM (${LISTING_SELECT} WHERE sh.id = $2) x JOIN movies m ON m.id = x.movie_id`,
      [now, id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ...toListing(r),
      movieTitle: r.movie_title,
      movieLanguage: r.movie_language,
      movieCertificate: r.movie_certificate,
      durationMinutes: r.duration_minutes,
      theatreAddress: r.address,
    };
  }

  async listForMovie(movieId: number, filter: ShowFilter, now: Date): Promise<ShowListing[]> {
    const params: unknown[] = [now, movieId, filter.from ?? now];
    const where = [`sh.movie_id = $2`, `sh.status = 'SCHEDULED'`, `sh.start_time >= $3`];
    if (filter.to) {
      params.push(filter.to);
      where.push(`sh.start_time < $${params.length}`);
    }
    if (filter.city) {
      params.push(filter.city);
      where.push(`lower(t.city) = lower($${params.length})`);
    }
    if (filter.theatreId) {
      params.push(filter.theatreId);
      where.push(`t.id = $${params.length}`);
    }
    const { rows } = await this.db.query<ListingRow>(
      `${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.city, t.name, sh.start_time`,
      params,
    );
    return rows.map(toListing);
  }

  /** Caller must run this inside a transaction so the show and its inventory appear atomically. */
  async createWithInventory(data: Omit<ShowProps, 'id' | 'status'>): Promise<Show> {
    const { rows } = await this.db.query<ShowRow>(
      `INSERT INTO shows (movie_id, screen_id, start_time, end_time, base_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.movieId, data.screenId, data.startTime, data.endTime, data.basePrice],
    );
    const show = rows[0]!;
    // Seat inventory for this show: one AVAILABLE row per physical seat.
    await this.db.query(`INSERT INTO show_seats (show_id, seat_id) SELECT $1, id FROM seats WHERE screen_id = $2`, [
      show.id,
      show.screen_id,
    ]);
    return toShow(show);
  }
}
