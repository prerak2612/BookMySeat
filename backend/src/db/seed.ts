/**
 * Demo data: 1 admin, 2 customers, 6 movies, 4 theatres in 3 cities, 7 screens and ~5 days of shows
 * (relative to "now", so the demo always has upcoming shows). Safe to re-run: skips if data exists.
 *   npm run seed             (or: npm run db:reset  -> drop schema, migrate, seed)
 */
import { createContainer } from '../container.js';
import { UserRole } from '../domain/enums.js';
import { BcryptPasswordHasher } from '../services/AuthService.js';
import { Database } from './Database.js';
import { runMigrations } from './migrate.js';

export const DEMO_USERS = {
  admin: { name: 'Admin User', email: 'admin@bookmyseat.dev', password: 'Admin@123' },
  alice: { name: 'Alice Sharma', email: 'alice@example.com', password: 'Password1' },
  bob: { name: 'Bob Verma', email: 'bob@example.com', password: 'Password1' },
};

const MOVIES = [
  { title: 'The Last Monsoon', genre: 'Drama', language: 'Hindi', durationMinutes: 148, certificate: 'UA',
    description: 'A fisherman and his estranged daughter race to save their coastal village before the season’s final storm.' },
  { title: 'Orbitfall', genre: 'Sci-Fi', language: 'English', durationMinutes: 162, certificate: 'UA',
    description: 'When a mining station loses contact with Earth, its youngest engineer has twelve hours to stop a collision.' },
  { title: 'Masala Mayhem', genre: 'Comedy', language: 'Hindi', durationMinutes: 131, certificate: 'U',
    description: 'Two rival street-food vendors are forced to cater the same wedding. Chaos is on the menu.' },
  { title: 'Shadow Protocol', genre: 'Action', language: 'English', durationMinutes: 139, certificate: 'A',
    description: 'A retired cryptographer is pulled back in when a cipher she wrote decades ago resurfaces.' },
  { title: 'Kaveri', genre: 'Drama', language: 'Kannada', durationMinutes: 124, certificate: 'U',
    description: 'Three generations of a family follow the river that shaped their lives.' },
  { title: 'Pixel Paws', genre: 'Animation', language: 'English', durationMinutes: 98, certificate: 'U',
    description: 'A video-game cat escapes into the real world and must find its way back before the next update.' },
];

const THEATRES = [
  { name: 'Galaxy Cinemas', city: 'Mumbai', address: 'Linking Road, Bandra West', screens: [{ name: 'Audi 1', preset: 'LARGE' }, { name: 'Audi 2', preset: 'MEDIUM' }] },
  { name: 'Sea Breeze Multiplex', city: 'Mumbai', address: 'Juhu Tara Road, Juhu', screens: [{ name: 'Screen 1', preset: 'MEDIUM' }] },
  { name: 'Garden City Screens', city: 'Bengaluru', address: 'MG Road', screens: [{ name: 'Gold', preset: 'MEDIUM' }, { name: 'Silver', preset: 'SMALL' }] },
  { name: 'Capital Talkies', city: 'Delhi', address: 'Connaught Place', screens: [{ name: 'Hall A', preset: 'LARGE' }, { name: 'Hall B', preset: 'SMALL' }] },
] as const;

const SLOTS = [
  [10, 0],
  [14, 0],
  [18, 30],
  [22, 0],
] as const;

export async function seed({ days = 5, quiet = false } = {}): Promise<void> {
  const c = createContainer();
  const repos = c.uowFactory.db;
  if ((await repos.movies.search({ includeInactive: true })).length > 0) {
    if (!quiet) console.log('  database already seeded - skipping (use `npm run db:reset` to start over)');
    return;
  }
  const hasher = new BcryptPasswordHasher(c.config.BCRYPT_ROUNDS);
  for (const [key, u] of Object.entries(DEMO_USERS)) {
    await repos.users.create({ name: u.name, email: u.email, passwordHash: await hasher.hash(u.password), role: key === 'admin' ? UserRole.ADMIN : UserRole.CUSTOMER });
  }

  const today = new Date();
  const movies = [];
  for (const [i, m] of MOVIES.entries()) {
    const release = new Date(today.getTime() - (i * 9 + 3) * 86_400_000).toISOString().slice(0, 10);
    movies.push(await c.movieService.create({ ...m, releaseDate: release, posterUrl: null }));
  }

  const screens = [];
  for (const t of THEATRES) {
    const theatre = await c.theatreService.create({ name: t.name, city: t.city, address: t.address });
    for (const s of t.screens) screens.push(await c.theatreService.addScreen(theatre.id, s.name, { preset: s.preset }));
  }

  let shows = 0;
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    for (const [si, screen] of screens.entries()) {
      for (const [slotIndex, [h, min]] of SLOTS.entries()) {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d, h, min);
        if (start.getTime() <= now + 30 * 60_000) continue;
        const movie = movies[(si + slotIndex + d) % movies.length]!;
        const basePrice = [180, 220, 260, 300][slotIndex]! + (screen.capacity > 150 ? 40 : 0);
        await c.showService.create({ movieId: movie.id, screenId: screen.id, startTime: start, basePrice });
        shows++;
      }
    }
  }
  if (!quiet) {
    console.log(`  seeded ${Object.keys(DEMO_USERS).length} users, ${movies.length} movies, ${THEATRES.length} theatres, ${screens.length} screens, ${shows} shows`);
    console.log(`  admin login:    ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
    console.log(`  customer login: ${DEMO_USERS.alice.email} / ${DEMO_USERS.alice.password}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Seeding demo data...');
  runMigrations(Database.getInstance().pool, { quiet: true })
    .then(() => seed())
    .then(() => Database.close())
    .catch(async (err) => {
      console.error(err);
      await Database.close();
      process.exit(1);
    });
}
