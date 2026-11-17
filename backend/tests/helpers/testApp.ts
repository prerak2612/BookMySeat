/**
 * Integration-test harness: a real Express app on an ephemeral port, a real PostgreSQL test
 * database, and helpers to build fixtures through the real services.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import type { Clock } from '../../src/common/Clock.js';
import type { SeatLockingStrategyName } from '../../src/concurrency/SeatLockingStrategy.js';
import { createContainer, type Container } from '../../src/container.js';
import { Database } from '../../src/db/Database.js';
import { UserRole } from '../../src/domain/enums.js';
import type { UnitOfWorkFactory } from '../../src/repositories/interfaces.js';
import type { PaymentGateway } from '../../src/payments/gateway/PaymentGateway.js';
import { BcryptPasswordHasher, JwtTokenService } from '../../src/services/AuthService.js';

export interface TestContext {
  container: Container;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startTestApp(
  options: {
    clock?: Clock;
    seatLockStrategy?: SeatLockingStrategyName;
    paymentGateway?: PaymentGateway;
    config?: Record<string, unknown>;
    wrapUnitOfWork?: (inner: UnitOfWorkFactory) => UnitOfWorkFactory;
  } = {},
): Promise<TestContext> {
  const container = createContainer({
    wrapUnitOfWork: options.wrapUnitOfWork,
    pool: Database.getInstance().pool,
    clock: options.clock,
    seatLockStrategy: options.seatLockStrategy,
    paymentGateway: options.paymentGateway,
    config: options.config,
  });
  const app = createApp(container);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    container,
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function resetDatabase(): Promise<void> {
  await Database.getInstance().pool.query(
    `TRUNCATE notifications, payments, booking_seats, show_seats, bookings, shows, seats, screens, theatres, movies, users RESTART IDENTITY CASCADE`,
  );
}

// ------------------------------------------------------------------ HTTP helper

export interface ApiResponse<T = any> {
  status: number;
  body: { success: boolean; data: T; error: { code: string; message: string; details?: any } };
}

export async function api<T = any>(
  ctx: TestContext,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<T>['body'] };
}

// ------------------------------------------------------------------ fixtures

const fastHash = new BcryptPasswordHasher(4);
let cachedHash: string | null = null;

/** Creates users directly (one shared hash -> fast) and returns them with signed tokens. */
export async function createUsers(ctx: TestContext, count: number, role: UserRole = UserRole.CUSTOMER, prefix = 'user') {
  cachedHash ??= await fastHash.hash('Password1');
  const tokens = new JwtTokenService(ctx.container.config.JWT_SECRET, '1h');
  const users = [];
  for (let i = 0; i < count; i++) {
    const user = await ctx.container.uowFactory.db.users.create({
      name: `${prefix} ${i}`,
      email: `${prefix}${i}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
      passwordHash: cachedHash,
      role,
    });
    users.push({ user, token: tokens.issue({ sub: user.id, role: user.role }) });
  }
  return users;
}

/** A movie, a theatre with one SMALL screen (50 seats, rows A-E) and one show `hoursAhead` from the clock. */
export async function createShowFixture(ctx: TestContext, opts: { hoursAhead?: number; basePrice?: number } = {}) {
  const c = ctx.container;
  const movie = await c.movieService.create({
    title: `Test Movie ${Math.random().toString(36).slice(2, 7)}`,
    description: 'fixture',
    durationMinutes: 120,
    language: 'English',
    genre: 'Drama',
    certificate: 'UA',
    releaseDate: '2026-01-01',
    posterUrl: null,
  });
  const theatre = await c.theatreService.create({ name: `Theatre ${Math.random().toString(36).slice(2, 7)}`, city: 'Testville', address: '1 Test Road' });
  const screen = await c.theatreService.addScreen(theatre.id, 'Screen 1', { preset: 'SMALL' });
  const start = new Date(c.clock.now().getTime() + (opts.hoursAhead ?? 24) * 3_600_000);
  const show = await c.showService.create({ movieId: movie.id, screenId: screen.id, startTime: start, basePrice: opts.basePrice ?? 200 });
  return { movie, theatre, screen, show, seatIds: screen.seats.map((s) => s.id) };
}

export const VALID_CARD = { cardNumber: '4111111111111111', expiry: '12/30', cvv: '123', cardHolder: 'Test User' };
export const DECLINED_CARD = { ...VALID_CARD, cardNumber: '4000000000000002' };
export const GATEWAY_DOWN_CARD = { ...VALID_CARD, cardNumber: '4000000000009999' };
