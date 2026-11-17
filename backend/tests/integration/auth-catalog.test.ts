import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '../../src/domain/enums.js';
import { api, createShowFixture, createUsers, resetDatabase, startTestApp, type TestContext } from '../helpers/testApp.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => ctx.close());
beforeEach(resetDatabase);

describe('Authentication API', () => {
  it('registers, logs in and returns the current user', async () => {
    const reg = await api(ctx, 'POST', '/auth/register', { body: { name: 'Riya', email: 'Riya@Example.com', password: 'Secret123' } });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user).toMatchObject({ email: 'riya@example.com', role: 'CUSTOMER' });
    expect(reg.body.data.user.passwordHash).toBeUndefined();

    const login = await api(ctx, 'POST', '/auth/login', { body: { email: 'riya@example.com', password: 'Secret123' } });
    expect(login.status).toBe(200);
    const me = await api(ctx, 'GET', '/auth/me', { token: login.body.data.token });
    expect(me.body.data.email).toBe('riya@example.com');
  });

  it('rejects duplicate e-mails case-insensitively (409)', async () => {
    const first = await api(ctx, 'POST', '/auth/register', { body: { name: 'Ann', email: 'dup@example.com', password: 'Secret123' } });
    expect(first.status).toBe(201);
    const again = await api(ctx, 'POST', '/auth/register', { body: { name: 'Bee', email: 'DUP@example.com', password: 'Secret123' } });
    expect(again.status).toBe(409);
  });

  it('validates registration input (400 with field details)', async () => {
    const res = await api(ctx, 'POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', password: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('uses one generic error for wrong password and unknown e-mail (401)', async () => {
    await api(ctx, 'POST', '/auth/register', { body: { name: 'Sam', email: 'sam@example.com', password: 'Secret123' } });
    const wrong = await api(ctx, 'POST', '/auth/login', { body: { email: 'sam@example.com', password: 'Wrong1234' } });
    const unknown = await api(ctx, 'POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'Wrong1234' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects missing and tampered tokens', async () => {
    expect((await api(ctx, 'GET', '/auth/me')).status).toBe(401);
    expect((await api(ctx, 'GET', '/auth/me', { token: 'abc.def.ghi' })).status).toBe(401);
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await fetch(`${ctx.baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MALFORMED_JSON');
  });
});

describe('Movie API', () => {
  const movie = { title: 'Inception', durationMinutes: 148, language: 'English', genre: 'Sci-Fi', releaseDate: '2010-07-16' };

  it('allows admins to create/update/deactivate and customers only to read', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    const [customer] = await createUsers(ctx, 1);

    expect((await api(ctx, 'POST', '/movies', { token: customer!.token, body: movie })).status).toBe(403);
    const created = await api(ctx, 'POST', '/movies', { token: admin!.token, body: movie });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const patched = await api(ctx, 'PATCH', `/movies/${id}`, { token: admin!.token, body: { genre: 'Thriller' } });
    expect(patched.body.data.genre).toBe('Thriller');

    const list = await api(ctx, 'GET', '/movies?genre=thriller');
    expect(list.body.data.map((m: { id: number }) => m.id)).toEqual([id]);

    await api(ctx, 'DELETE', `/movies/${id}`, { token: admin!.token });
    expect((await api(ctx, 'GET', '/movies')).body.data).toHaveLength(0);
    // Admins can still see deactivated movies.
    expect((await api(ctx, 'GET', '/movies?includeInactive=true', { token: admin!.token })).body.data).toHaveLength(1);
    expect((await api(ctx, 'GET', '/movies?includeInactive=true')).body.data).toHaveLength(0);
  });

  it('returns 404 for unknown movies and 400 for invalid ids', async () => {
    expect((await api(ctx, 'GET', '/movies/99999')).status).toBe(404);
    expect((await api(ctx, 'GET', '/movies/abc')).status).toBe(400);
  });

  it('searches titles case-insensitively', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    await api(ctx, 'POST', '/movies', { token: admin!.token, body: movie });
    await api(ctx, 'POST', '/movies', { token: admin!.token, body: { ...movie, title: 'Interstellar' } });
    const res = await api(ctx, 'GET', '/movies?q=incep');
    expect(res.body.data.map((m: { title: string }) => m.title)).toEqual(['Inception']);
  });
});

describe('Theatre, screen and show API', () => {
  it('creates a theatre with a custom screen layout', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    const theatre = await api(ctx, 'POST', '/theatres', { token: admin!.token, body: { name: 'PVR', city: 'Pune', address: 'FC Road' } });
    expect(theatre.status).toBe(201);
    const screen = await api(ctx, 'POST', `/theatres/${theatre.body.data.id}/screens`, {
      token: admin!.token,
      body: { name: 'IMAX', layout: { rows: [{ label: 'A', seats: 5, category: 'REGULAR' }, { label: 'B', seats: 4, category: 'RECLINER' }] } },
    });
    expect(screen.status).toBe(201);
    expect(screen.body.data.capacity).toBe(9);
    expect(screen.body.data.seats.filter((s: { category: string }) => s.category === 'RECLINER')).toHaveLength(4);

    const list = await api(ctx, 'GET', '/theatres?city=pune');
    expect(list.body.data[0].screens[0]).toMatchObject({ name: 'IMAX', capacity: 9 });
    expect((await api(ctx, 'GET', '/cities')).body.data).toEqual(['Pune']);
  });

  it('rejects duplicate row labels in a layout', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    const t = await api(ctx, 'POST', '/theatres', { token: admin!.token, body: { name: 'Dup', city: 'Pune', address: 'Road' } });
    const res = await api(ctx, 'POST', `/theatres/${t.body.data.id}/screens`, {
      token: admin!.token,
      body: { name: 'S', layout: { rows: [{ label: 'A', seats: 2, category: 'REGULAR' }, { label: 'a', seats: 2, category: 'REGULAR' }] } },
    });
    expect(res.status).toBe(400);
  });

  it('schedules shows, generates seat inventory and rejects overlapping shows (409)', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    const { movie, screen, show } = await createShowFixture(ctx);
    const seats = await api(ctx, 'GET', `/shows/${show.id}/seats`);
    expect(seats.body.data.summary).toEqual({ AVAILABLE: 50, LOCKED: 0, BOOKED: 0 });
    expect(seats.body.data.rows).toHaveLength(5);

    // Overlaps the fixture show on the same screen (runtime 120 + 15 buffer).
    const overlapping = await api(ctx, 'POST', '/shows', {
      token: admin!.token,
      body: { movieId: movie.id, screenId: screen.id, startTime: new Date(show.startTime.getTime() + 60 * 60_000).toISOString(), basePrice: 150 },
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('SHOW_OVERLAP');

    const later = await api(ctx, 'POST', '/shows', {
      token: admin!.token,
      body: { movieId: movie.id, screenId: screen.id, startTime: new Date(show.endTime.getTime() + 60_000).toISOString(), basePrice: 150 },
    });
    expect(later.status).toBe(201);

    const listing = await api(ctx, 'GET', `/movies/${movie.id}/shows`);
    expect(listing.body.data).toHaveLength(2);
    expect(listing.body.data[0]).toMatchObject({ availableSeats: 50, totalSeats: 50, city: 'Testville' });
  });

  it('rejects shows in the past (422)', async () => {
    const [admin] = await createUsers(ctx, 1, UserRole.ADMIN, 'admin');
    const { movie, screen } = await createShowFixture(ctx);
    const res = await api(ctx, 'POST', '/shows', {
      token: admin!.token,
      body: { movieId: movie.id, screenId: screen.id, startTime: '2020-01-01T10:00:00Z', basePrice: 150 },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SHOW_IN_PAST');
  });

  it('returns 404 for unknown routes and shows', async () => {
    expect((await api(ctx, 'GET', '/shows/424242/seats')).status).toBe(404);
    expect((await api(ctx, 'GET', '/nope')).body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
