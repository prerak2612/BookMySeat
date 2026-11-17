# SOLID Principles in BookMySeat

Each principle is applied in production code and can be demonstrated by a file and, where possible, a test.

## Mapping table

| Principle | Actual Classes | Implementation (code location) | Justification |
|---|---|---|---|
| **SRP** – Single Responsibility | `BookingService`, `SeatLockService`, `PaymentService`, `PriceCalculator`, `NotificationService`, controllers, presenters, `TransactionManager` | [BookingService.ts](../backend/src/services/BookingService.ts), [SeatLockService.ts](../backend/src/services/SeatLockService.ts), [PaymentService.ts](../backend/src/payments/PaymentService.ts), [controllers.ts](../backend/src/http/controllers/controllers.ts), [presenters.ts](../backend/src/http/controllers/presenters.ts), [TransactionManager.ts](../backend/src/db/TransactionManager.ts) | Each class has one reason to change: use-case flow, seat-state rules, charging money, pricing rules, messaging, HTTP translation, JSON shape, transaction mechanics. |
| **OCP** – Open/Closed | `PaymentStrategyFactory`, `PriceCalculatorDecorator` subclasses, `createSeatLockingStrategy`, `BookingEventPublisher`, `SeatLayoutFactory.PRESETS` | [PaymentStrategyFactory.ts](../backend/src/payments/PaymentStrategyFactory.ts), [pricing.ts](../backend/src/pricing/pricing.ts), [SeatLockingStrategy.ts](../backend/src/concurrency/SeatLockingStrategy.ts), [BookingEventPublisher.ts](../backend/src/notifications/BookingEventPublisher.ts) | New payment methods, charges, locking mechanisms and event reactions are added as new classes; `BookingService` is not edited. |
| **LSP** – Liskov Substitution | `PessimisticSeatLockingStrategy` / `OptimisticSeatLockingStrategy`; `Card`/`Upi`/`WalletPaymentStrategy`; `AppError` subclasses; `Customer`/`Admin` | [SeatLockingStrategy.ts](../backend/src/concurrency/SeatLockingStrategy.ts), [PaymentStrategies.ts](../backend/src/payments/PaymentStrategies.ts), [errors.ts](../backend/src/common/errors.ts), [User.ts](../backend/src/domain/User.ts) | Subtypes honour the base contract; the whole concurrency suite runs unchanged against both strategies and passes. |
| **ISP** – Interface Segregation | `MovieReader` / `MovieWriter`, `PaymentProcessor` / `RefundProcessor`, `BookingEventListener`, `NotificationChannel`, `Clock`, `AdvisoryLockRepository`, `PasswordHasher`, `TokenService` | [interfaces.ts](../backend/src/repositories/interfaces.ts), [PaymentStrategies.ts](../backend/src/payments/PaymentStrategies.ts), [BookingEventPublisher.ts](../backend/src/notifications/BookingEventPublisher.ts), [Clock.ts](../backend/src/common/Clock.ts) | Clients depend only on the methods they call; a read-only catalogue client cannot even see write methods. |
| **DIP** – Dependency Inversion | `BookingService`, `ShowService`, `AuthService`, `HoldExpiryJob`, `BasePaymentStrategy`, composition root `createContainer` | [container.ts](../backend/src/container.ts), constructors of all services | High-level policy depends on abstractions (`UnitOfWorkFactory`, `PaymentGateway`, `Clock`, `PasswordHasher`, `TokenService`); concrete classes are chosen in one place and swapped in tests. |

---

## S — Single Responsibility Principle

The booking use case is split across collaborators that each own one concern:

| Class | Single responsibility |
|---|---|
| `BookingService` | orchestrates the use cases and owns transaction boundaries / event publication |
| `SeatLockService` | the seat lifecycle (lock, re-claim, confirm, release) inside a given transaction |
| `SeatLockingStrategy` | *how* rows are protected (row lock vs version CAS) |
| `PaymentService` + strategies | charging/refunding money |
| `PriceCalculator` chain | computing the price |
| `NotificationService` | turning events into messages |
| `BookingController` | HTTP ⇄ service translation |
| `presenters.ts` | entity → JSON shape |

Controllers are one-liners:
```ts
cancel = async (req: Request, res: Response) =>
  ok(res, await this.bookings.cancel(currentUser(req), valid<IdParams>(req, 'params').id));
```

**What would violate it:** a `BookingController.pay` that parses the card number, opens `BEGIN`, runs `UPDATE show_seats`, computes GST and sends the e-mail. A change to the tax rate, the SQL or the e-mail template would all edit the same function.

---

## O — Open/Closed Principle

Pricing rules are added by wrapping, not editing:
```ts
let calculator: PriceCalculator = new BasePriceCalculator(strategy);
if (cfg.weekendSurchargeRate > 0) calculator = new WeekendSurchargeDecorator(calculator, cfg.weekendSurchargeRate);
if (cfg.convenienceFeePerSeat > 0) calculator = new ConvenienceFeeDecorator(calculator, cfg.convenienceFeePerSeat);
if (cfg.taxRate > 0) calculator = new TaxDecorator(calculator, cfg.taxRate);
```
Payment methods are registered:
```ts
return new PaymentStrategyFactory()
  .register(new CardPaymentStrategy(gateway))
  .register(new UpiPaymentStrategy(gateway))
  .register(new WalletPaymentStrategy(gateway));
```
Locking strategies are chosen by `createSeatLockingStrategy(name)`; new reactions to bookings are `events.subscribe(listener)`.

**What would violate it:** `switch (method) { case 'CARD': … case 'UPI': … }` inside `BookingService.pay`, or `if (isWeekend) total *= 1.1; if (festival) …` inside the service — every new rule would modify tested code.

---

## L — Liskov Substitution Principle

1. **Locking strategies.** [booking-concurrency.test.ts](../backend/tests/concurrency/booking-concurrency.test.ts) loops over `['PESSIMISTIC', 'OPTIMISTIC']` and runs the identical six scenarios (50-user race, race to payment, different seats, overlapping windows, idempotent duplicates, concurrent payments). Both return `ShowSeat[]` from `reserveCandidates`, throw `NotFoundError`/`SeatUnavailableError` under the same conditions, and leave the same database state.
2. **Payment strategies.** Every strategy resolves to a `PaymentResult` for a decline and only rejects for validation (`ValidationError`) or infrastructure (`GatewayUnavailableError`). The unit test *"strategies are substitutable: same contract against any gateway (LSP/DIP)"* ([payments.test.ts](../backend/tests/unit/payments.test.ts)) runs all three against a fake gateway with identical results.
3. **Errors.** `errorHandler` handles any `AppError` through the base type; `SeatUnavailableError` and `HoldExpiredError` can be caught as `ConflictError`.
4. **Users.** `Customer` and `Admin` are used wherever `User` is expected; behaviour differs only through the overridden queries.

```ts
// SeatLockService is written once against the abstraction:
const seats = await this.strategy.reserveCandidates(uow, showId, seatIds, now);
...
await this.strategy.claim(uow, seats, bookingId, draft.expiresAt);
```

**What would violate it:** an `OptimisticSeatLockingStrategy.claim` that silently returned when the CAS updated fewer rows (weakened post-condition), forcing `SeatLockService` to check `if (strategy instanceof Optimistic) …`.

---

## I — Interface Segregation Principle

```ts
export interface MovieReader { findById(id: number): Promise<Movie | null>; search(filter: MovieFilter): Promise<Movie[]>; }
export interface MovieWriter { create(...): Promise<Movie>; update(...): Promise<Movie | null>; }
export interface MovieRepository extends MovieReader, MovieWriter {}

export interface PaymentProcessor { readonly method: PaymentMethod; pay(request: PaymentRequest): Promise<PaymentResult>; }
export interface RefundProcessor  { refund(transactionRef: string, amount: number): Promise<...>; }

export interface BookingEventListener { readonly name: string; handle(event: BookingEvent): Promise<void>; }
export interface Clock { now(): Date; }
```
- `MovieService` is constructed with a reader and a writer (`new MovieService(repos.movies, repos.movies)`); the in-memory fake in [services.test.ts](../backend/tests/unit/services.test.ts) implements only what is needed.
- A future pay-only method (e.g. vouchers) can implement `PaymentProcessor` without a meaningless `refund`.
- Listeners and clocks have a single method, so fakes are one-liners in tests.

**What would violate it:** one `IRepository` with 40 methods (users, movies, payments …) that every fake must stub, or a `PaymentStrategy` interface forcing every method to implement `refund`, `void`, `capture`, `authorize`.

---

## D — Dependency Inversion Principle

High-level modules depend on abstractions; the composition root picks implementations:
```ts
export class BookingService {
  constructor(
    private readonly uowFactory: UnitOfWorkFactory,   // not PgUnitOfWorkFactory
    private readonly seatLocks: SeatLockService,
    private readonly payments: PaymentService,
    private readonly pricing: PriceCalculator,       // not TaxDecorator
    private readonly events: BookingEventPublisher,
    private readonly clock: Clock,                    // not new Date()
    private readonly policy: BookingPolicy,
  ) {}
}
```
- `AuthService(users: UserRepository, hasher: PasswordHasher, tokens: TokenService)` — unit tests inject trivial hasher/token fakes.
- `BasePaymentStrategy(gateway: PaymentGateway)` — the SDK is hidden behind `LegacyPayGatewayAdapter`.
- `ShowService`, `SeatAvailabilityService`, `HoldExpiryJob`, `AdminService` take a `Clock`; integration tests inject `FixedClock` to test expiry and the cancellation cut-off without waiting.
- [container.ts](../backend/src/container.ts) is the only module that instantiates `Pg*`, `LegacyPay*`, `Bcrypt*`, `Jwt*`; `ContainerOverrides` lets tests replace them (`paymentGateway`, `clock`, `seatLockStrategy`, `wrapUnitOfWork`).

**What would violate it:** `BookingService` doing `import { Database } from '../db/Database'` and `Database.getInstance().pool.query('BEGIN')`, or calling `new LegacyPaySdk()` directly — the rollback test with an injected failing repository would then be impossible.
