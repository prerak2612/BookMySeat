import { NotFoundError } from '../common/errors.js';
import type { Movie, MovieProps } from '../domain/Movie.js';
import type { MovieReader, MovieWriter } from '../repositories/interfaces.js';
import type { MovieFilter } from '../repositories/readModels.js';

/**
 * SRP: catalogue rules only. ISP/DIP: depends on the narrow MovieReader/MovieWriter ports.
 */
export class MovieService {
  constructor(
    private readonly reader: MovieReader,
    private readonly writer: MovieWriter,
  ) {}

  list(filter: MovieFilter): Promise<Movie[]> {
    return this.reader.search(filter);
  }

  async get(id: number): Promise<Movie> {
    const movie = await this.reader.findById(id);
    if (!movie) throw new NotFoundError('Movie', id);
    return movie;
  }

  create(data: Omit<MovieProps, 'id' | 'isActive'> & { isActive?: boolean }): Promise<Movie> {
    return this.writer.create({ ...data, isActive: data.isActive ?? true });
  }

  async update(id: number, data: Partial<Omit<MovieProps, 'id'>>): Promise<Movie> {
    const movie = await this.writer.update(id, data);
    if (!movie) throw new NotFoundError('Movie', id);
    return movie;
  }

  /** Soft delete: existing shows/bookings keep their history. */
  deactivate(id: number): Promise<Movie> {
    return this.update(id, { isActive: false });
  }
}
