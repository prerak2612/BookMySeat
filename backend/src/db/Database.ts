import pg from 'pg';
import { config } from '../config/env.js';

// node-postgres returns BIGINT (int8) and NUMERIC as strings to avoid precision loss.
// Our ids fit comfortably in a JS number and money is NUMERIC(10,2), so parse both.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

/** Anything that can run a query: the pool itself or a checked-out transactional client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

/**
 * Singleton wrapper around the connection pool.
 *
 * A Singleton is genuinely appropriate here: a process must share ONE pool, otherwise every
 * module would open its own connections and exhaust the server's `max_connections`.
 */
export class Database {
  private static instance: Database | null = null;
  readonly pool: pg.Pool;

  private constructor(connectionString: string, max: number) {
    this.pool = new pg.Pool({ connectionString, max });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database(config.DATABASE_URL, config.DB_POOL_MAX);
    }
    return Database.instance;
  }

  static async close(): Promise<void> {
    if (Database.instance) {
      const { pool } = Database.instance;
      Database.instance = null;
      await pool.end();
    }
  }
}
