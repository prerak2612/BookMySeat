import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { Database } from './Database.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Minimal forward-only migration runner.
 * Each *.sql file runs once, inside its own transaction, and is recorded in schema_migrations.
 */
export async function runMigrations(pool: pg.Pool, { reset = false, quiet = false } = {}): Promise<string[]> {
  const client = await pool.connect();
  try {
    // Serialise concurrent migrators (e.g. two test workers) with an advisory lock.
    await client.query('SELECT pg_advisory_lock(727274)');
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(200) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = new Set(
      (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran.push(file);
        if (!quiet) console.log(`  applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (!quiet && ran.length === 0) console.log('  schema is up to date');
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
}

// CLI entry point: `npm run migrate` / `npm run migrate -- --reset`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const reset = process.argv.includes('--reset');
  console.log(reset ? 'Resetting schema and running migrations...' : 'Running migrations...');
  runMigrations(Database.getInstance().pool, { reset })
    .then(() => Database.close())
    .catch(async (err) => {
      console.error(err.message);
      await Database.close();
      process.exit(1);
    });
}
