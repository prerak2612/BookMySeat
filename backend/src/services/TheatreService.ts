import { NotFoundError } from '../common/errors.js';
import type { Screen } from '../domain/Screen.js';
import type { Theatre } from '../domain/Theatre.js';
import type { UnitOfWorkFactory } from '../repositories/interfaces.js';
import { SeatLayoutFactory, type LayoutSpec } from './SeatLayoutFactory.js';

export class TheatreService {
  constructor(private readonly uowFactory: UnitOfWorkFactory) {}

  list(city?: string): Promise<Theatre[]> {
    return this.uowFactory.db.theatres.list(city);
  }

  listCities(): Promise<string[]> {
    return this.uowFactory.db.theatres.listCities();
  }

  async get(id: number): Promise<Theatre> {
    const theatre = await this.uowFactory.db.theatres.findById(id);
    if (!theatre) throw new NotFoundError('Theatre', id);
    return theatre;
  }

  create(data: { name: string; city: string; address: string }): Promise<Theatre> {
    return this.uowFactory.db.theatres.create(data);
  }

  async getScreen(id: number): Promise<Screen> {
    const screen = await this.uowFactory.db.theatres.findScreenById(id);
    if (!screen) throw new NotFoundError('Screen', id);
    return screen;
  }

  /** Screen + all its seats are created in one transaction (no half-built screens). */
  async addScreen(theatreId: number, name: string, layout: LayoutSpec): Promise<Screen> {
    const seats = SeatLayoutFactory.create(layout);
    return this.uowFactory.transaction(async (uow) => {
      if (!(await uow.theatres.findById(theatreId))) throw new NotFoundError('Theatre', theatreId);
      return uow.theatres.createScreen(theatreId, name, seats);
    });
  }
}
