import { Router } from 'express';
import type { Container } from '../container.js';
import { authenticate, ok, optionalAuthenticate, requireCatalogManager as admin, validate } from './middleware/index.js';
import {
  AdminBookingsQuery,
  HoldBody,
  IdParam,
  LoginBody,
  MovieBody,
  MovieQuery,
  MovieUpdateBody,
  PaymentBody,
  RegisterBody,
  ScreenBody,
  ShowBody,
  ShowQuery,
  TheatreBody,
  TheatreQuery,
} from './validators/schemas.js';

/** REST resource map. Every route: [auth] -> [role] -> validation -> controller. */
export function buildRoutes(c: Container): Router {
  const r = Router();
  const auth = authenticate(c.authService);
  const maybeAuth = optionalAuthenticate(c.authService);
  const id = validate('params', IdParam);
  const { auth: authC, movies, theatres, shows, bookings, admin: adminC } = c.controllers;

  r.get('/health', async (_req, res) => {
    await c.uowFactory.db.users.findById(0); // touches the database
    ok(res, { status: 'ok', seatLockStrategy: c.seatLockService.strategy.name, time: c.clock.now() });
  });

  // ---- authentication
  r.post('/auth/register', validate('body', RegisterBody), authC.register);
  r.post('/auth/login', validate('body', LoginBody), authC.login);
  r.get('/auth/me', auth, authC.me);

  // ---- movies (public read, admin write)
  r.get('/movies', maybeAuth, validate('query', MovieQuery), movies.list);
  r.get('/movies/:id', id, movies.get);
  r.get('/movies/:id/shows', id, validate('query', ShowQuery), movies.shows_);
  r.post('/movies', auth, admin, validate('body', MovieBody), movies.create);
  r.patch('/movies/:id', auth, admin, id, validate('body', MovieUpdateBody), movies.update);
  r.delete('/movies/:id', auth, admin, id, movies.deactivate);

  // ---- theatres & screens
  r.get('/cities', theatres.cities);
  r.get('/theatres', validate('query', TheatreQuery), theatres.list);
  r.get('/theatres/:id', id, theatres.get);
  r.post('/theatres', auth, admin, validate('body', TheatreBody), theatres.create);
  r.post('/theatres/:id/screens', auth, admin, id, validate('body', ScreenBody), theatres.addScreen);
  r.get('/screens/:id', id, theatres.getScreen);

  // ---- shows & seat availability
  r.get('/shows/:id', id, shows.get);
  r.get('/shows/:id/seats', id, shows.seats);
  r.post('/shows', auth, admin, validate('body', ShowBody), shows.create);

  // ---- bookings (seat lock -> payment -> confirmation -> cancellation)
  r.post('/bookings', auth, validate('body', HoldBody), bookings.createHold);
  r.get('/bookings', auth, bookings.listMine);
  r.get('/bookings/:id', auth, id, bookings.get);
  r.post('/bookings/:id/payments', auth, id, validate('body', PaymentBody), bookings.pay);
  r.post('/bookings/:id/cancel', auth, id, bookings.cancel);
  r.get('/notifications', auth, bookings.myNotifications);

  // ---- admin
  r.get('/admin/stats', auth, admin, adminC.stats);
  r.get('/admin/bookings', auth, admin, validate('query', AdminBookingsQuery), adminC.listBookings);

  return r;
}
