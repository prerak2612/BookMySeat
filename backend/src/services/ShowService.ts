import type { Clock } from '../common/Clock.js';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import type { Show } from '../domain/Show.js';
import type { UnitOfWorkFactory } from '../repositories/interfaces.js';
import type { ShowDetails, ShowFilter, ShowListing } from '../repositories/readModels.js';

export class ShowService {
  constructor(
    private readonly uowFactory: UnitOfWorkFactory,
    private readonly clock: Clock,
  ) {}

  /** Upcoming shows of a movie; `date` (YYYY-MM-DD) narrows to one calendar day. */
  async listForMovie(movieId: number, filter: { date?: string; city?: string; theatreId?: number }): Promise<ShowListing[]> {
    const { movies, shows } = this.uowFactory.db;
    if (!(await movies.findById(movieId))) throw new NotFoundError('Movie', movieId);
    const showFilter: ShowFilter = { city: filter.city, theatreId: filter.theatreId };
    if (filter.date) {
      const from = new Date(`${filter.date}T00:00:00`);
      showFilter.from = from;
      showFilter.to = new Date(from.getTime() + 24 * 60 * 60_000);
    }
    return shows.listForMovie(movieId, showFilter, this.clock.now());
  }

  async get(id: number): Promise<ShowDetails> {
    const show = await this.uowFactory.db.shows.findDetails(id, this.clock.now());
    if (!show) throw new NotFoundError('Show', id);
    return show;
  }

  /**
   * Schedules a show. End time = start + runtime + cleaning buffer. Overlaps on the same screen are
   * rejected by the database exclusion constraint (mapped to 409 SHOW_OVERLAP by the error handler).
   */
  async create(input: { movieId: number; screenId: number; startTime: Date; basePrice: number }): Promise<Show> {
    if (input.startTime <= this.clock.now()) {
      throw new BusinessRuleError('SHOW_IN_PAST', 'Shows can only be scheduled in the future');
    }
    return this.uowFactory.transaction(async (uow) => {
      const movie = await uow.movies.findById(input.movieId);
      if (!movie || !movie.isActive) throw new NotFoundError('Active movie', input.movieId);
      const screen = await uow.theatres.findScreenById(input.screenId);
      if (!screen) throw new NotFoundError('Screen', input.screenId);
      if (screen.capacity === 0) throw new BusinessRuleError('SCREEN_HAS_NO_SEATS', 'Screen has no seats');
      const endTime = new Date(input.startTime.getTime() + movie.occupiedMinutes() * 60_000);
      return uow.shows.createWithInventory({ ...input, endTime });
    });
  }
}
