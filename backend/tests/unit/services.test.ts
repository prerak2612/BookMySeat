/** Service-level unit tests with in-memory fakes (no database). */
import { describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../src/common/Clock.js';
import { BusinessRuleError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../src/common/errors.js';
import { SeatCategory, UserRole } from '../../src/domain/enums.js';
import { Movie, type MovieProps } from '../../src/domain/Movie.js';
import { Customer, UserFactory, type User, type UserProps } from '../../src/domain/User.js';
import type { BookingEvent } from '../../src/domain/events.js';
import { BookingEventPublisher } from '../../src/notifications/BookingEventPublisher.js';
import { AuditLogListener, NotificationService, type NotificationChannel } from '../../src/notifications/NotificationService.js';
import type { MovieRepository, UnitOfWorkFactory, UserRepository } from '../../src/repositories/interfaces.js';
import { AuthService, type PasswordHasher, type TokenService } from '../../src/services/AuthService.js';
import { BookingService } from '../../src/services/BookingService.js';
import { MovieService } from '../../src/services/MovieService.js';
import { SeatLayoutFactory } from '../../src/services/SeatLayoutFactory.js';

// ------------------------------------------------------------------ fakes

class InMemoryMovies implements MovieRepository {
  private rows: Movie[] = [];
  async findById(id: number) {
    return this.rows.find((m) => m.id === id) ?? null;
  }
  async search(f: { q?: string; includeInactive?: boolean }) {
    return this.rows.filter((m) => (f.includeInactive || m.isActive) && (!f.q || m.title.toLowerCase().includes(f.q.toLowerCase())));
  }
  async create(data: Omit<MovieProps, 'id'>) {
    const m = new Movie({ ...data, id: this.rows.length + 1 });
    this.rows.push(m);
    return m;
  }
  async update(id: number, data: Partial<Omit<MovieProps, 'id'>>) {
    const i = this.rows.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const current = this.rows[i]!;
    this.rows[i] = new Movie({ ...current, ...data, id, durationMinutes: data.durationMinutes ?? current.durationMinutes });
    return this.rows[i]!;
  }
}

class InMemoryUsers implements UserRepository {
  rows: User[] = [];
  async findById(id: number) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async findByEmail(email: string) {
    return this.rows.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async create(data: Omit<UserProps, 'id' | 'createdAt'>) {
    const u = UserFactory.create({ ...data, id: this.rows.length + 1, createdAt: new Date() });
    this.rows.push(u);
    return u;
  }
}

const movieInput = { title: 'Dune', description: '', durationMinutes: 155, language: 'English', genre: 'Sci-Fi', certificate: 'UA', releaseDate: '2021-10-22', posterUrl: null };

// ------------------------------------------------------------------ MovieService

describe('MovieService', () => {
  it('creates, searches, updates and soft-deletes movies', async () => {
    const repo = new InMemoryMovies();
    const service = new MovieService(repo, repo);
    const m = await service.create(movieInput);
    expect(m.isActive).toBe(true);
    expect((await service.list({ q: 'du' })).map((x) => x.title)).toEqual(['Dune']);
    expect((await service.update(m.id, { genre: 'Epic' })).genre).toBe('Epic');
    await service.deactivate(m.id);
    expect(await service.list({})).toHaveLength(0);
    expect(await service.list({ includeInactive: true })).toHaveLength(1);
  });

  it('throws NotFoundError for unknown ids', async () => {
    const repo = new InMemoryMovies();
    const service = new MovieService(repo, repo);
    await expect(service.get(9)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(9, { genre: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ------------------------------------------------------------------ AuthService

describe('AuthService', () => {
  const hasher: PasswordHasher = { hash: async (p) => `hashed:${p}`, verify: async (p, h) => h === `hashed:${p}` };
  const tokens: TokenService = {
    issue: (p) => `token-${p.sub}`,
    verify: (t) => {
      if (!t.startsWith('token-')) throw new UnauthorizedError();
      return { sub: Number(t.slice(6)), role: UserRole.CUSTOMER };
    },
  };

  it('registers customers with hashed passwords and normalised e-mail', async () => {
    const users = new InMemoryUsers();
    const auth = new AuthService(users, hasher, tokens);
    const res = await auth.register({ name: ' Mira ', email: 'MIRA@X.dev', password: 'Secret123' });
    expect(res).toMatchObject({ token: 'token-1', user: { name: 'Mira', email: 'mira@x.dev', role: 'CUSTOMER' } });
    expect(users.rows[0]!.passwordHash).toBe('hashed:Secret123');
    await expect(auth.register({ name: 'M', email: 'mira@x.dev', password: 'x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('logs in and authenticates tokens', async () => {
    const users = new InMemoryUsers();
    const auth = new AuthService(users, hasher, tokens);
    await auth.register({ name: 'Mira', email: 'mira@x.dev', password: 'Secret123' });
    expect((await auth.login({ email: 'mira@x.dev', password: 'Secret123' })).token).toBe('token-1');
    await expect(auth.login({ email: 'mira@x.dev', password: 'nope' })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await auth.authenticate('token-1')).toBeInstanceOf(Customer);
    await expect(auth.authenticate('token-99')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// ------------------------------------------------------------------ BookingService (input rules)

describe('BookingService input rules', () => {
  const uowFactory = { transaction: vi.fn(), db: {} } as unknown as UnitOfWorkFactory;
  const service = new BookingService(
    uowFactory,
    {} as never,
    {} as never,
    {} as never,
    new BookingEventPublisher(),
    new FixedClock(new Date()),
    { holdMinutes: 5, maxSeatsPerBooking: 3, cancellationCutoffMinutes: 120 },
  );
  const user = new Customer({ id: 1, name: 'U', email: 'u@x.dev', passwordHash: 'h', role: UserRole.CUSTOMER, createdAt: new Date() });

  it('rejects duplicate seats before opening a transaction', async () => {
    await expect(service.createHold(user, { showId: 1, seatIds: [1, 1] })).rejects.toBeInstanceOf(ValidationError);
    expect(uowFactory.transaction).not.toHaveBeenCalled();
  });

  it('enforces the maximum seats per booking', async () => {
    await expect(service.createHold(user, { showId: 1, seatIds: [1, 2, 3, 4] })).rejects.toMatchObject({ code: 'TOO_MANY_SEATS' });
    await expect(service.createHold(user, { showId: 1, seatIds: [1, 2, 3, 4] })).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('maps the database double-booking guard (23505) to SeatUnavailableError', async () => {
    (uowFactory.transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505', constraint: 'ux_booking_seats_one_active_per_show_seat' }),
    );
    await expect(service.createHold(user, { showId: 1, seatIds: [5] })).rejects.toMatchObject({ code: 'SEAT_UNAVAILABLE', statusCode: 409 });
  });
});

// ------------------------------------------------------------------ Observer

describe('BookingEventPublisher (Observer)', () => {
  const event: BookingEvent = {
    type: 'BOOKING_CONFIRMED', occurredAt: new Date(), bookingId: 1, bookingReference: 'BMS-1', userId: 1, showId: 1, seatLabels: ['A1'], amount: 100,
  };

  it('delivers events to subscribed listeners filtered by type, and supports unsubscribe', async () => {
    const publisher = new BookingEventPublisher();
    const all = new AuditLogListener();
    const onlyCancel = { name: 'cancel', handle: vi.fn(async () => undefined) };
    const unsubscribe = publisher.subscribe(all);
    publisher.subscribe(onlyCancel, ['BOOKING_CANCELLED']);
    await publisher.publish(event);
    expect(all.entries).toHaveLength(1);
    expect(onlyCancel.handle).not.toHaveBeenCalled();
    unsubscribe();
    await publisher.publish(event);
    expect(all.entries).toHaveLength(1);
  });

  it('a failing listener does not affect others', async () => {
    const publisher = new BookingEventPublisher();
    const ok = new AuditLogListener();
    publisher.subscribe({ name: 'broken', handle: async () => Promise.reject(new Error('boom')) });
    publisher.subscribe(ok);
    await expect(publisher.publish(event)).resolves.toBeUndefined();
    expect(ok.entries).toHaveLength(1);
  });

  it('NotificationService sends on every channel and persists each notification', async () => {
    const users = new InMemoryUsers();
    await users.create({ name: 'Ana', email: 'ana@x.dev', passwordHash: 'h', role: UserRole.CUSTOMER });
    const store = { create: vi.fn(async (n) => ({ ...n, id: 1, createdAt: new Date() })), listByUser: vi.fn() };
    const channel = (name: string): NotificationChannel => ({ name, send: vi.fn(async () => undefined) });
    const email = channel('EMAIL');
    const sms = channel('SMS');
    await new NotificationService(users, store, [email, sms]).handle(event);
    expect(email.send).toHaveBeenCalledWith({ email: 'ana@x.dev', name: 'Ana' }, 'Booking confirmed - BMS-1', expect.stringContaining('A1'));
    expect(store.create).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------ SeatLayoutFactory

describe('SeatLayoutFactory (Factory)', () => {
  it('builds preset layouts', () => {
    const seats = SeatLayoutFactory.create({ preset: 'SMALL' });
    expect(seats).toHaveLength(50);
    expect(seats.filter((s) => s.category === SeatCategory.RECLINER)).toHaveLength(10);
  });

  it('builds custom layouts and normalises labels', () => {
    const seats = SeatLayoutFactory.create({ rows: [{ label: 'a', seats: 2, category: SeatCategory.PREMIUM }] });
    expect(seats).toEqual([
      { rowLabel: 'A', seatNumber: 1, category: SeatCategory.PREMIUM },
      { rowLabel: 'A', seatNumber: 2, category: SeatCategory.PREMIUM },
    ]);
  });

  it('rejects empty or duplicate rows', () => {
    expect(() => SeatLayoutFactory.create({ rows: [] })).toThrow(ValidationError);
    expect(() => SeatLayoutFactory.create({ rows: [{ label: 'A', seats: 1, category: SeatCategory.REGULAR }, { label: 'a', seats: 1, category: SeatCategory.REGULAR }] })).toThrow(
      /unique/,
    );
  });
});
