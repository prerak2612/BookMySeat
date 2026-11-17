import type { Queryable } from '../../db/Database.js';
import { Movie, type MovieProps } from '../../domain/Movie.js';
import type { MovieRepository } from '../interfaces.js';
import type { MovieFilter } from '../readModels.js';

interface MovieRow {
  id: number;
  title: string;
  description: string;
  duration_minutes: number;
  language: string;
  genre: string;
  certificate: string;
  release_date: string;
  poster_url: string | null;
  is_active: boolean;
}

const SELECT = `SELECT id, title, description, duration_minutes, language, genre, certificate,
                       to_char(release_date, 'YYYY-MM-DD') AS release_date, poster_url, is_active
                FROM movies`;

const toMovie = (r: MovieRow): Movie =>
  new Movie({
    id: r.id,
    title: r.title,
    description: r.description,
    durationMinutes: r.duration_minutes,
    language: r.language,
    genre: r.genre,
    certificate: r.certificate,
    releaseDate: r.release_date,
    posterUrl: r.poster_url,
    isActive: r.is_active,
  });

// Domain property -> column, used to build partial UPDATEs safely (no user-controlled identifiers).
const COLUMNS: Record<keyof Omit<MovieProps, 'id'>, string> = {
  title: 'title',
  description: 'description',
  durationMinutes: 'duration_minutes',
  language: 'language',
  genre: 'genre',
  certificate: 'certificate',
  releaseDate: 'release_date',
  posterUrl: 'poster_url',
  isActive: 'is_active',
};

export class PgMovieRepository implements MovieRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<Movie | null> {
    const { rows } = await this.db.query<MovieRow>(`${SELECT} WHERE id = $1`, [id]);
    return rows[0] ? toMovie(rows[0]) : null;
  }

  async search(filter: MovieFilter): Promise<Movie[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeInactive) where.push('is_active');
    if (filter.q) {
      params.push(`%${filter.q}%`);
      where.push(`title ILIKE $${params.length}`);
    }
    if (filter.genre) {
      params.push(filter.genre);
      where.push(`lower(genre) = lower($${params.length})`);
    }
    if (filter.language) {
      params.push(filter.language);
      where.push(`lower(language) = lower($${params.length})`);
    }
    const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY release_date DESC, id`;
    const { rows } = await this.db.query<MovieRow>(sql, params);
    return rows.map(toMovie);
  }

  async create(data: Omit<MovieProps, 'id'>): Promise<Movie> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO movies (title, description, duration_minutes, language, genre, certificate, release_date, poster_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [data.title, data.description, data.durationMinutes, data.language, data.genre, data.certificate, data.releaseDate, data.posterUrl, data.isActive],
    );
    return (await this.findById(rows[0]!.id))!;
  }

  async update(id: number, data: Partial<Omit<MovieProps, 'id'>>): Promise<Movie | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      params.push(id);
      await this.db.query(`UPDATE movies SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    return this.findById(id);
  }
}
