import type pg from 'pg';
import type { Queryable } from '../../db/Database.js';
import { TransactionManager, type TransactionOptions } from '../../db/TransactionManager.js';
import type { UnitOfWork, UnitOfWorkFactory } from '../interfaces.js';
import { PgBookingRepository } from './PgBookingRepository.js';
import { PgMovieRepository } from './PgMovieRepository.js';
import { PgShowRepository } from './PgShowRepository.js';
import { PgShowSeatRepository } from './PgShowSeatRepository.js';
import {
  PgAdvisoryLockRepository,
  PgNotificationRepository,
  PgPaymentRepository,
  PgReportingRepository,
} from './PgSupportRepositories.js';
import { PgTheatreRepository } from './PgTheatreRepository.js';
import { PgUserRepository } from './PgUserRepository.js';

/** Binds every repository to the same Queryable so they all share one connection/transaction. */
export function createUnitOfWork(db: Queryable): UnitOfWork {
  return {
    users: new PgUserRepository(db),
    movies: new PgMovieRepository(db),
    theatres: new PgTheatreRepository(db),
    shows: new PgShowRepository(db),
    showSeats: new PgShowSeatRepository(db),
    bookings: new PgBookingRepository(db),
    payments: new PgPaymentRepository(db),
    notifications: new PgNotificationRepository(db),
    reporting: new PgReportingRepository(db),
    advisoryLocks: new PgAdvisoryLockRepository(db),
  };
}

export class PgUnitOfWorkFactory implements UnitOfWorkFactory {
  readonly db: UnitOfWork;
  private readonly tx: TransactionManager;

  constructor(
    pool: pg.Pool,
    private readonly options: TransactionOptions = {},
  ) {
    this.db = createUnitOfWork(pool);
    this.tx = new TransactionManager(pool);
  }

  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return this.tx.run((client) => work(createUnitOfWork(client)), this.options);
  }
}
