/**
 * Composition root (manual Dependency Injection).
 *
 * This is the ONLY place that knows concrete classes. Every service receives its collaborators
 * through its constructor, typed by interfaces - so tests can swap the clock, the payment gateway
 * or the seat-locking strategy without touching production code.
 */
import type pg from 'pg';
import { SystemClock, type Clock } from './common/Clock.js';
import { config as defaultConfig, type AppConfig } from './config/env.js';
import { createSeatLockingStrategy, type SeatLockingStrategyName } from './concurrency/SeatLockingStrategy.js';
import { Database } from './db/Database.js';
import { AdminController, AuthController, BookingController, MovieController, ShowController, TheatreController } from './http/controllers/controllers.js';
import { BookingEventPublisher } from './notifications/BookingEventPublisher.js';
import { AuditLogListener, EmailChannel, NotificationService, SmsChannel } from './notifications/NotificationService.js';
import { LegacyPayGatewayAdapter } from './payments/gateway/LegacyPayGatewayAdapter.js';
import { LegacyPaySdk } from './payments/gateway/LegacyPaySdk.js';
import type { PaymentGateway } from './payments/gateway/PaymentGateway.js';
import { PaymentService } from './payments/PaymentService.js';
import { PaymentStrategyFactory } from './payments/PaymentStrategyFactory.js';
import { PriceCalculatorFactory } from './pricing/pricing.js';
import type { UnitOfWorkFactory } from './repositories/interfaces.js';
import { PgUnitOfWorkFactory } from './repositories/pg/PgUnitOfWork.js';
import { AdminService } from './services/AdminService.js';
import { AuthService, BcryptPasswordHasher, JwtTokenService } from './services/AuthService.js';
import { BookingService } from './services/BookingService.js';
import { HoldExpiryJob } from './services/HoldExpiryJob.js';
import { MovieService } from './services/MovieService.js';
import { SeatAvailabilityService } from './services/SeatAvailabilityService.js';
import { SeatLockService } from './services/SeatLockService.js';
import { ShowService } from './services/ShowService.js';
import { TheatreService } from './services/TheatreService.js';

export interface ContainerOverrides {
  config?: Partial<AppConfig>;
  pool?: pg.Pool;
  clock?: Clock;
  paymentGateway?: PaymentGateway;
  seatLockStrategy?: SeatLockingStrategyName;
  /** Decorator hook (tests use it to inject faults into the persistence layer). */
  wrapUnitOfWork?: (inner: UnitOfWorkFactory) => UnitOfWorkFactory;
}

export function createContainer(overrides: ContainerOverrides = {}) {
  const cfg: AppConfig = { ...defaultConfig, ...overrides.config };
  const pool = overrides.pool ?? Database.getInstance().pool;
  const clock = overrides.clock ?? new SystemClock();
  const baseUow = new PgUnitOfWorkFactory(pool);
  const uowFactory: UnitOfWorkFactory = overrides.wrapUnitOfWork ? overrides.wrapUnitOfWork(baseUow) : baseUow;
  const repos = uowFactory.db;

  // Observer wiring
  const events = new BookingEventPublisher();
  const auditLog = new AuditLogListener();
  events.subscribe(new NotificationService(repos.users, repos.notifications, [new EmailChannel(), new SmsChannel()]));
  events.subscribe(auditLog);

  // Strategy / Decorator / Factory / Adapter wiring
  const { calculator, strategy: seatPricing } = PriceCalculatorFactory.create({
    strategy: cfg.PRICING_STRATEGY,
    weekendSurchargeRate: cfg.WEEKEND_SURCHARGE_RATE,
    convenienceFeePerSeat: cfg.CONVENIENCE_FEE_PER_SEAT,
    taxRate: cfg.TAX_RATE,
  });
  const gateway = overrides.paymentGateway ?? new LegacyPayGatewayAdapter(new LegacyPaySdk(cfg.NODE_ENV === 'test' ? 1 : 300));
  const paymentService = new PaymentService(PaymentStrategyFactory.withDefaults(gateway));
  const seatLockService = new SeatLockService(createSeatLockingStrategy(overrides.seatLockStrategy ?? cfg.SEAT_LOCK_STRATEGY));

  const authService = new AuthService(repos.users, new BcryptPasswordHasher(cfg.BCRYPT_ROUNDS), new JwtTokenService(cfg.JWT_SECRET, cfg.JWT_EXPIRES_IN));
  const movieService = new MovieService(repos.movies, repos.movies);
  const theatreService = new TheatreService(uowFactory);
  const showService = new ShowService(uowFactory, clock);
  const availabilityService = new SeatAvailabilityService(uowFactory, seatPricing, clock);
  const bookingService = new BookingService(uowFactory, seatLockService, paymentService, calculator, events, clock, {
    holdMinutes: cfg.SEAT_HOLD_MINUTES,
    maxSeatsPerBooking: cfg.MAX_SEATS_PER_BOOKING,
    cancellationCutoffMinutes: cfg.CANCELLATION_CUTOFF_MINUTES,
  });
  const adminService = new AdminService(repos.reporting, clock);
  const holdExpiryJob = new HoldExpiryJob(uowFactory, seatLockService, events, clock);

  return {
    config: cfg,
    pool,
    clock,
    uowFactory,
    events,
    auditLog,
    authService,
    movieService,
    theatreService,
    showService,
    availabilityService,
    bookingService,
    paymentService,
    seatLockService,
    adminService,
    holdExpiryJob,
    controllers: {
      auth: new AuthController(authService),
      movies: new MovieController(movieService, showService),
      theatres: new TheatreController(theatreService),
      shows: new ShowController(showService, availabilityService),
      bookings: new BookingController(bookingService, repos.notifications),
      admin: new AdminController(adminService, bookingService),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
