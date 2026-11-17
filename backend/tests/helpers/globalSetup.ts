import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';

/** Runs once per `vitest run`: rebuilds the test database schema from the migration files. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://bookmyseat@127.0.0.1:5433/bookmyseat_test';
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await runMigrations(pool, { reset: true, quiet: true });
  } finally {
    await pool.end();
  }
}
