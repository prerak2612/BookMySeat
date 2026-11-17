/**
 * Thin HTTP controllers: translate HTTP <-> service calls, nothing else (SRP).
 * Business rules live in services; validation happens in middleware before these run.
 */
import type { Request, Response } from 'express';
import type { PaymentMethod } from '../../domain/enums.js';
import type { MovieProps } from '../../domain/Movie.js';
import type { NotificationRepository } from '../../repositories/interfaces.js';
import type { MovieFilter } from '../../repositories/readModels.js';
import type { AdminService } from '../../services/AdminService.js';
import type { AuthService } from '../../services/AuthService.js';
import type { BookingService } from '../../services/BookingService.js';
import type { MovieService } from '../../services/MovieService.js';
import type { SeatAvailabilityService } from '../../services/SeatAvailabilityService.js';
import type { LayoutSpec } from '../../services/SeatLayoutFactory.js';
import type { ShowService } from '../../services/ShowService.js';
import type { TheatreService } from '../../services/TheatreService.js';
import { currentUser, idempotencyKey, ok, valid } from '../middleware/index.js';
import { movieDto, screenDto, showDto, theatreDto } from './presenters.js';

type IdParams = { id: number };

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  register = async (req: Request, res: Response) => ok(res, await this.auth.register(valid(req, 'body')), 201);
  login = async (req: Request, res: Response) => ok(res, await this.auth.login(valid(req, 'body')));
  me = async (req: Request, res: Response) => ok(res, currentUser(req).toPublic());
}

export class MovieController {
  constructor(
    private readonly movies: MovieService,
    private readonly shows: ShowService,
  ) {}

  list = async (req: Request, res: Response) => {
    const filter = valid<MovieFilter>(req, 'query');
    // Only catalogue managers may see deactivated movies.
    if (!req.user?.canManageCatalog()) filter.includeInactive = false;
    ok(res, (await this.movies.list(filter)).map(movieDto));
  };
  get = async (req: Request, res: Response) => ok(res, movieDto(await this.movies.get(valid<IdParams>(req, 'params').id)));
  create = async (req: Request, res: Response) =>
    ok(res, movieDto(await this.movies.create(valid<Omit<MovieProps, 'id' | 'isActive'>>(req, 'body'))), 201);
  update = async (req: Request, res: Response) =>
    ok(res, movieDto(await this.movies.update(valid<IdParams>(req, 'params').id, valid(req, 'body'))));
  deactivate = async (req: Request, res: Response) => ok(res, movieDto(await this.movies.deactivate(valid<IdParams>(req, 'params').id)));
  shows_ = async (req: Request, res: Response) =>
    ok(res, await this.shows.listForMovie(valid<IdParams>(req, 'params').id, valid(req, 'query')));
}

export class TheatreController {
  constructor(private readonly theatres: TheatreService) {}

  list = async (req: Request, res: Response) => ok(res, (await this.theatres.list(valid<{ city?: string }>(req, 'query').city)).map((t) => theatreDto(t)));
  cities = async (_req: Request, res: Response) => ok(res, await this.theatres.listCities());
  get = async (req: Request, res: Response) => ok(res, theatreDto(await this.theatres.get(valid<IdParams>(req, 'params').id)));
  create = async (req: Request, res: Response) => ok(res, theatreDto(await this.theatres.create(valid(req, 'body'))), 201);
  addScreen = async (req: Request, res: Response) => {
    const { name, layout } = valid<{ name: string; layout: LayoutSpec }>(req, 'body');
    ok(res, screenDto(await this.theatres.addScreen(valid<IdParams>(req, 'params').id, name, layout), true), 201);
  };
  getScreen = async (req: Request, res: Response) => ok(res, screenDto(await this.theatres.getScreen(valid<IdParams>(req, 'params').id), true));
}

export class ShowController {
  constructor(
    private readonly shows: ShowService,
    private readonly availability: SeatAvailabilityService,
  ) {}

  get = async (req: Request, res: Response) => ok(res, await this.shows.get(valid<IdParams>(req, 'params').id));
  seats = async (req: Request, res: Response) => ok(res, await this.availability.getSeatMap(valid<IdParams>(req, 'params').id));
  create = async (req: Request, res: Response) => ok(res, showDto(await this.shows.create(valid(req, 'body'))), 201);
}

export class BookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly notifications: NotificationRepository,
  ) {}

  /** POST /bookings - lock seats and create a PENDING booking (201), or replay (200). */
  createHold = async (req: Request, res: Response) => {
    const { booking, replayed } = await this.bookings.createHold(currentUser(req), valid(req, 'body'), idempotencyKey(req));
    ok(res, booking, replayed ? 200 : 201);
  };
  pay = async (req: Request, res: Response) => {
    const body = valid<{ method: PaymentMethod; details: Record<string, string> }>(req, 'body');
    ok(res, await this.bookings.pay(currentUser(req), valid<IdParams>(req, 'params').id, body, idempotencyKey(req)));
  };
  cancel = async (req: Request, res: Response) => ok(res, await this.bookings.cancel(currentUser(req), valid<IdParams>(req, 'params').id));
  get = async (req: Request, res: Response) => ok(res, await this.bookings.get(currentUser(req), valid<IdParams>(req, 'params').id));
  listMine = async (req: Request, res: Response) => ok(res, await this.bookings.listForUser(currentUser(req)));
  myNotifications = async (req: Request, res: Response) => ok(res, await this.notifications.listByUser(currentUser(req).id));
}

export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly bookings: BookingService,
  ) {}

  stats = async (_req: Request, res: Response) => ok(res, await this.admin.stats());
  listBookings = async (req: Request, res: Response) => ok(res, await this.bookings.listAll(valid(req, 'query')));
}
