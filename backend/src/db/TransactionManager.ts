import type pg from 'pg';
import type { Queryable } from './Database.js';
import { logger } from '../common/logger.js';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolation?: IsolationLevel;
  /** How many times to re-run the unit of work after a deadlock / serialization failure. */
  retries?: number;
}

// SQLSTATE codes that mean "the transaction was aborted by the concurrency control system and is
// safe to retry from scratch".
const RETRYABLE_SQLSTATES = new Set(['40001' /* serialization_failure */, '40P01' /* deadlock_detected */]);

export function isRetryableDbError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && RETRYABLE_SQLSTATES.has((err as { code?: string }).code ?? '');
}

/**
 * Owns transaction boundaries: BEGIN, COMMIT, ROLLBACK and safe retry.
 * Business services never write BEGIN/COMMIT themselves - they hand a callback to `run`.
 * Any exception thrown inside the callback rolls back every statement executed in it.
 */
export class TransactionManager {
  constructor(private readonly pool: pg.Pool) {}

  async run<T>(work: (tx: Queryable) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const { isolation = 'READ COMMITTED', retries = 3 } = options;
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (isRetryableDbError(err) && attempt < retries) {
          logger.debug('Retrying transaction after concurrency abort', { attempt, code: (err as { code: string }).code });
          await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }
}
