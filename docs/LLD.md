# Low-Level Design — BookMySeat

Notation: `+` public, `-` private, `#` protected, `~` readonly getter. TypeScript `#field` (ECMAScript private) is written `-#field`. Multiplicities use UML style (`1`, `0..1`, `*`, `1..*`). All paths are relative to `backend/src` unless stated.

---

## 1. Domain model

### 1.1 `Entity` (abstract) — [domain/Entity.ts](../backend/src/domain/Entity.ts)
Base of every persisted object; identity-based equality.

| Member | Signature |
|---|---|
| attr | `+id: number` (readonly) |
| ctor | `#constructor(id: number)` |
| method | `+equals(other: Entity \| null \| undefined): boolean` — same concrete class and same id |

Subclasses: `User`, `Movie`, `Theatre`, `Screen`, `Seat`, `Show`, `ShowSeat`, `Booking`, `Payment`.

### 1.2 `User` (abstract) → `Customer`, `Admin`; `UserFactory` — [domain/User.ts](../backend/src/domain/User.ts)

| Member | Signature |
|---|---|
| attrs | `+name: string`, `+email: string`, `+createdAt: Date`, `-#passwordHash: string` |
| abstract | `+get role(): UserRole`, `+canManageCatalog(): boolean` |
| methods | `+canAccessBookingOf(ownerId: number): boolean` (admin or owner), `+get passwordHash(): string`, `+toPublic(): {id,name,email,role,createdAt}` |
| `Customer` | `role = CUSTOMER`, `canManageCatalog() = false` |
| `Admin` | `role = ADMIN`, `canManageCatalog() = true` |
| `UserFactory` | `+static create(props: UserProps): User` — picks the subclass from `props.role` |

### 1.3 `Movie` — [domain/Movie.ts](../backend/src/domain/Movie.ts)
Attributes (all `+readonly`): `title`, `description: string`, `durationMinutes: number`, `language`, `genre`, `certificate: string`, `releaseDate: string (YYYY-MM-DD)`, `posterUrl: string | null`, `isActive: boolean`.
Invariant: constructor throws if `durationMinutes <= 0`.
Method: `+occupiedMinutes(cleaningBufferMinutes = 15): number`.

### 1.4 `Theatre` — [domain/Theatre.ts](../backend/src/domain/Theatre.ts)
`+name`, `+city`, `+address: string`, `-#screens: Screen[]`; `+get screens(): readonly Screen[]`. **Aggregation** Theatre `1` ◇— `*` Screen.

### 1.5 `Screen` — [domain/Screen.ts](../backend/src/domain/Screen.ts)
`+theatreId: number`, `+name: string`, `-#seats: Seat[]`, `-capacityHint?: number`; `+get seats(): readonly Seat[]`, `+get capacity(): number` (seat count, or the hint when seats were not loaded). **Composition** Screen `1` ◆— `1..*` Seat (`ON DELETE CASCADE`).

### 1.6 `Seat` — [domain/Seat.ts](../backend/src/domain/Seat.ts)
Immutable physical seat: `+screenId`, `+rowLabel: string`, `+seatNumber: number`, `+category: SeatCategory`; `+get label(): string` (e.g. `"C7"`).

### 1.7 `Show` — [domain/Show.ts](../backend/src/domain/Show.ts)
`+movieId`, `+screenId: number`, `+startTime`, `+endTime: Date`, `+basePrice: number`, `+status: ShowStatus`. Invariant: `endTime > startTime`.
Methods: `+isBookableAt(now: Date): boolean` (SCHEDULED and not started), `+minutesUntilStart(now: Date): number`, `+isWeekend(): boolean`.
**Association** Movie `1` — `*` Show `*` — `1` Screen.

### 1.8 `ShowSeat` — [domain/ShowSeat.ts](../backend/src/domain/ShowSeat.ts)
Per-show seat inventory with an encapsulated state machine.

| Member | Signature |
|---|---|
| attrs | `+showId`, `+seatId`, `+rowLabel`, `+seatNumber`, `+category`, `+version: number`; `-#status: ShowSeatStatus`, `-#bookingId: number \| null`, `-#lockExpiresAt: Date \| null` |
| getters | `~status`, `~bookingId`, `~lockExpiresAt`, `~label` |
| queries | `+hasExpiredLock(now): boolean`, `+isAvailableAt(now): boolean`, `+isHeldBy(bookingId, now): boolean`, `+effectiveStatus(now): ShowSeatStatus` |
| commands | `+lock(bookingId, expiresAt, now): void`, `+book(bookingId, now): void`, `+release(): void` |

**State machine**

| From | Event / method | Guard | To |
|---|---|---|---|
| AVAILABLE | `lock(b, exp, now)` | — | LOCKED (booking b, expires exp) |
| LOCKED (expired) | `lock(b, exp, now)` | `lockExpiresAt <= now` | LOCKED (new holder) |
| LOCKED | `book(b, now)` | `bookingId == b` and not expired | BOOKED (expiry cleared) |
| LOCKED | `release()` | payment failure, cancel, expiry | AVAILABLE |
| BOOKED | `release()` | cancellation | AVAILABLE |
| LOCKED (valid) / BOOKED | `lock(...)` | — | **throws** |
| AVAILABLE / LOCKED by other / expired | `book(...)` | — | **throws** |

The same machine is enforced in SQL by `ck_show_seats_state` (columns must agree with status) and by the conditional `WHERE` clauses in `PgShowSeatRepository`.

### 1.9 `Booking` (aggregate root), `BookingSeat`, `BookingDraft`, `BookingBuilder` — [domain/Booking.ts](../backend/src/domain/Booking.ts)

| Member | Signature |
|---|---|
| attrs | `+reference: string`, `+userId`, `+showId: number`, `+subtotal`, `+totalAmount: number`, `+priceBreakdown: readonly PriceLine[]`, `+idempotencyKey: string \| null`, `+expiresAt: Date`, `+createdAt: Date`; `-#status: BookingStatus`, `-#confirmedAt`, `-#cancelledAt: Date \| null`, `-#seats: BookingSeat[]` |
| getters | `~status`, `~confirmedAt`, `~cancelledAt`, `~seats: readonly BookingSeat[]`, `~showSeatIds: number[]` |
| queries | `+isHoldExpired(now): boolean`, `+isCancellable(now, show, cutoffMinutes): boolean` |
| commands | `+assertPayable(now): void`, `+confirm(now): void`, `+markPaymentFailed(): void`, `+expire(): void`, `+cancel(now, show, cutoffMinutes): CancellationOutcome` |
| private | `-transitionToTerminal(target, allowedFrom[]): void` — also sets every line `isActive = false` |

`BookingSeat` (value object, **composition** Booking `1` ◆— `1..*` BookingSeat): `showSeatId`, `seatLabel`, `category`, `price`, `isActive`.

**State machine**

| From | Method | Guard | To | Side effect |
|---|---|---|---|---|
| PENDING | `confirm(now)` | `expiresAt > now` | CONFIRMED | `confirmedAt = now` |
| PENDING | `markPaymentFailed()` | — | FAILED | lines inactive |
| PENDING | `expire()` | — | EXPIRED | lines inactive |
| PENDING | `cancel(now, show, cutoff)` | — | CANCELLED | `refundRequired=false`, lines inactive |
| CONFIRMED | `cancel(now, show, cutoff)` | `show.minutesUntilStart(now) >= cutoff` | CANCELLED | `refundRequired=true`, lines inactive |
| CONFIRMED | `cancel` | inside cut-off | — | throws `BusinessRuleError CANCELLATION_WINDOW_CLOSED` |
| CONFIRMED | `confirm`/`assertPayable` | — | — | throws `ConflictError` (already paid) |
| PENDING expired / EXPIRED | `confirm`/`assertPayable` | — | — | throws `HoldExpiredError` (410) |
| FAILED / CANCELLED / EXPIRED | `cancel` or any transition | — | — | throws `ConflictError` |

`BookingBuilder` (fluent): `+forUser(id)`, `+forShow(id)`, `+withSeat(seat)`, `+withPricing(subtotal, total, breakdown)`, `+withIdempotencyKey(key?)`, `+holdUntil(date)`, `+withReference(ref)`, `+build(): BookingDraft` (validates user, show, ≥1 seat, no duplicates, pricing, expiry), `+static generateReference(): string` (`BMS-` + 8 chars from an unambiguous alphabet).

### 1.10 `Payment` — [domain/Payment.ts](../backend/src/domain/Payment.ts)
`+bookingId`, `+amount`, `+method: PaymentMethod`, `+gateway: string`, `+transactionRef`, `+failureReason`, `+idempotencyKey: string | null`, `+createdAt`; `-#status: PaymentStatus`, `-#refundedAt`. Method `+markRefunded(now)` (only from SUCCESS). Booking `1` — `0..*` Payment.

### 1.11 Events — [domain/events.ts](../backend/src/domain/events.ts)
`BookingEvent { type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'PAYMENT_FAILED' | 'BOOKING_EXPIRED'; occurredAt; bookingId; bookingReference; userId; showId; seatLabels; amount; reason? }`.

---

## 2. Errors — [common/errors.ts](../backend/src/common/errors.ts)

```
Error
└── AppError (abstract)  #statusCode, #code, +details?, +toJSON()
    ├── ValidationError        400 VALIDATION_ERROR
    ├── UnauthorizedError      401 UNAUTHORIZED
    ├── ForbiddenError         403 FORBIDDEN
    ├── NotFoundError          404 NOT_FOUND
    ├── ConflictError          409 CONFLICT
    │   ├── SeatUnavailableError  409 SEAT_UNAVAILABLE  details.seatIds
    │   └── HoldExpiredError      410 HOLD_EXPIRED      details.bookingId
    ├── BusinessRuleError      422 <custom code>
    └── PaymentFailedError     402 PAYMENT_FAILED
```

---

## 3. Persistence

### 3.1 Ports — [repositories/interfaces.ts](../backend/src/repositories/interfaces.ts)

| Interface | Methods |
|---|---|
| `UserRepository` | `findById`, `findByEmail`, `create` |
| `MovieReader` | `findById`, `search(filter)` |
| `MovieWriter` | `create`, `update(id, partial)` |
| `MovieRepository` | `extends MovieReader, MovieWriter` |
| `TheatreRepository` | `list(city?)`, `findById`, `create`, `findScreenById`, `createScreen(theatreId, name, seats)`, `listCities` |
| `ShowRepository` | `findById`, `findDetails(id, now)`, `listForMovie(movieId, filter, now)`, `createWithInventory(data)` |
| `ShowSeatRepository` | `findByShow`, `findByShowAndSeatIds(showId, seatIds, {forUpdate}?)`, `findByIds(ids, {forUpdate}?)`, `lockSeats`, `lockSeatsIfUnchanged`, `markBooked`, `releaseForBooking(bookingId, ids?)`, `releaseOrphanedLocks(now)` |
| `BookingRepository` | `createHeader(draft)`, `addLines(id, seats)`, `findById(id, {forUpdate}?)`, `findByIds`, `findByUserAndIdempotencyKey`, `save(booking)`, `deactivateLinesForShowSeats(ids, except?)`, `findExpiredPendingIds(now, limit)`, `findSummary`, `listSummariesByUser`, `listSummaries` |
| `PaymentRepository` | `create`, `findByBookingAndKey`, `findSuccessfulByBooking`, `save` |
| `NotificationRepository` | `create`, `listByUser` |
| `ReportingRepository` | `stats(now)` |
| `AdvisoryLockRepository` | `lockForTransaction(key)` |
| `UnitOfWork` | one property per repository above |
| `UnitOfWorkFactory` | `+db: UnitOfWork`, `+transaction<T>(work: (uow) => Promise<T>): Promise<T>` |

### 3.2 Adapters — [repositories/pg/](../backend/src/repositories/pg)
Each `Pg*Repository` receives a `Queryable` (pool or transactional client) in its constructor and maps rows to entities. `createUnitOfWork(db)` instantiates all of them on one `Queryable`; `PgUnitOfWorkFactory` (realizes `UnitOfWorkFactory`) uses `TransactionManager` for `transaction()`.

Key SQL decisions:
- `PgShowSeatRepository` — `FOR UPDATE OF ss` + `ORDER BY ss.id` (deadlock-free lock order); `lockSeatsIfUnchanged` is a version compare-and-set via `UPDATE … FROM unnest($ids, $versions)`; every release is guarded by `booking_id = $1` so a booking can never free someone else's lock.
- `PgBookingRepository.addLines` relies on the partial unique index; `save` only ever deactivates lines.
- `PgAdvisoryLockRepository` uses `pg_advisory_xact_lock(hashtextextended(key, 0))` — released automatically at COMMIT/ROLLBACK.

### 3.3 Infrastructure — [db/](../backend/src/db)

| Class | Members |
|---|---|
| `Database` (Singleton) | `-static instance`, `+pool: pg.Pool`, `-constructor`, `+static getInstance()`, `+static close()` |
| `TransactionManager` | `-pool`, `+run<T>(work: (tx: Queryable) => Promise<T>, {isolation?, retries?}): Promise<T>`; helper `isRetryableDbError(err)` |
| `runMigrations(pool, {reset, quiet})` | applies `migrations/*.sql` once each, in a transaction, under an advisory lock |

---

## 4. Services

| Class | Dependencies (constructor) | Public methods | Responsibility |
|---|---|---|---|
| `AuthService` ([AuthService.ts](../backend/src/services/AuthService.ts)) | `UserRepository`, `PasswordHasher`, `TokenService` | `register`, `login`, `authenticate(token): User` | identity |
| `BcryptPasswordHasher` ⊳ `PasswordHasher` | `rounds` | `hash`, `verify` | hashing |
| `JwtTokenService` ⊳ `TokenService` | `secret`, `expiresIn` | `issue(payload)`, `verify(token)` | tokens |
| `MovieService` ([MovieService.ts](../backend/src/services/MovieService.ts)) | `MovieReader`, `MovieWriter` | `list`, `get`, `create`, `update`, `deactivate` | catalogue |
| `TheatreService` ([TheatreService.ts](../backend/src/services/TheatreService.ts)) | `UnitOfWorkFactory` | `list`, `listCities`, `get`, `create`, `getScreen`, `addScreen(theatreId, name, layout)` | venues |
| `SeatLayoutFactory` ([SeatLayoutFactory.ts](../backend/src/services/SeatLayoutFactory.ts)) | — | `+static create(spec: LayoutSpec): SeatCreate[]`, `+static PRESETS` | seat generation |
| `ShowService` ([ShowService.ts](../backend/src/services/ShowService.ts)) | `UnitOfWorkFactory`, `Clock` | `listForMovie`, `get`, `create` | scheduling |
| `SeatAvailabilityService` ([SeatAvailabilityService.ts](../backend/src/services/SeatAvailabilityService.ts)) | `UnitOfWorkFactory`, `SeatPricingStrategy`, `Clock` | `getSeatMap(showId): SeatMap` | read side of inventory |
| `SeatLockService` ([SeatLockService.ts](../backend/src/services/SeatLockService.ts)) | `+strategy: SeatLockingStrategy` | `hold(uow, {showId, seatIds, now, buildDraft})`, `lockBookingForUpdate(uow, id)`, `assertStillHeld(booking, seats, now)`, `confirmSeats(uow, booking, seats, now)`, `releaseSeats(uow, booking)`, `expireHold(uow, booking)`; `-reclaimExpiredHolds` | seat lifecycle inside a caller's transaction |
| `BookingService` ([BookingService.ts](../backend/src/services/BookingService.ts)) | `UnitOfWorkFactory`, `SeatLockService`, `PaymentService`, `PriceCalculator`, `BookingEventPublisher`, `Clock`, `BookingPolicy` | `createHold`, `pay`, `cancel`, `get`, `listForUser`, `listAll` | use-case orchestration, transaction boundaries |
| `HoldExpiryJob` ([HoldExpiryJob.ts](../backend/src/services/HoldExpiryJob.ts)) | `UnitOfWorkFactory`, `SeatLockService`, `BookingEventPublisher`, `Clock`, `batchSize` | `start(ms)`, `stop()`, `runOnce(): number` | sweeper |
| `AdminService` ([AdminService.ts](../backend/src/services/AdminService.ts)) | `ReportingRepository`, `Clock` | `stats()` | metrics |
| `PaymentService` ([PaymentService.ts](../backend/src/payments/PaymentService.ts)) | `PaymentStrategyFactory` | `charge(method, amount, ref, details)`, `refund(method, txnRef, amount)`, `supportedMethods()` | payment facade |

---

## 5. Strategies, factories, decorators, adapter, observer

### 5.1 Seat locking — [concurrency/SeatLockingStrategy.ts](../backend/src/concurrency/SeatLockingStrategy.ts)
```
«interface» SeatLockingStrategy
  +name: 'PESSIMISTIC' | 'OPTIMISTIC'
  +reserveCandidates(uow, showId, seatIds, now): Promise<ShowSeat[]>
  +claim(uow, seats, bookingId, expiresAt): Promise<void>
        △
AbstractSeatLockingStrategy (template method)
  +reserveCandidates(...)            -- load → existence check (404) → availability check (409)
  #loadCandidates(uow, showId, ids)  -- abstract
  +claim(...)                        -- abstract
     △                              △
PessimisticSeatLockingStrategy   OptimisticSeatLockingStrategy
  load: FOR UPDATE                 load: plain SELECT
  claim: lockSeats()               claim: lockSeatsIfUnchanged() + count check
```
`createSeatLockingStrategy(name)` is the factory.

### 5.2 Pricing — [pricing/pricing.ts](../backend/src/pricing/pricing.ts)
- `«interface» SeatPricingStrategy { name; priceForSeat(category, basePrice) }` ⊲ `CategoryPricingStrategy` (`MULTIPLIERS`), `FlatPricingStrategy`.
- `«interface» PriceCalculator { calculate(ctx: PricingContext): PriceQuote }` ⊲ `BasePriceCalculator(strategy)`.
- `PriceCalculatorDecorator` (abstract, `#inner: PriceCalculator`, `#extraCharge(quote, ctx): PriceLine | null`) ⊲ `WeekendSurchargeDecorator(inner, rate)`, `ConvenienceFeeDecorator(inner, feePerSeat)`, `TaxDecorator(inner, rate)`.
- `PriceCalculatorFactory.create(cfg): { calculator, strategy }`, `createStrategy(name)`.

### 5.3 Payments — [payments/](../backend/src/payments)
```
«interface» PaymentProcessor { method; pay(req): Promise<PaymentResult> }
«interface» RefundProcessor  { refund(txnRef, amount) }
BasePaymentStrategy (abstract) implements both
  #gateway: PaymentGateway, #instrumentType
  +pay(req)   -- template: amount>0 → validate → tokenise → gateway.charge → map
  +refund(...)
  #validate(details): string[]   #tokenise(details): string   #mask(details): string   (abstract)
     △ CardPaymentStrategy   △ UpiPaymentStrategy   △ WalletPaymentStrategy
PaymentStrategyFactory  -strategies: Map<PaymentMethod, PaymentStrategy>
  +register(s): this  +get(method)  +supportedMethods()  +static withDefaults(gateway)
«interface» PaymentGateway { name; charge(req); refund(ref, amount) }
LegacyPayGatewayAdapter implements PaymentGateway  -sdk: LegacyPaySdk
LegacyPaySdk  +makeTransaction(payload, cb)  +reverseTransaction(txnId, paise, cb)
GatewayUnavailableError extends Error
```

### 5.4 Observer — [notifications/](../backend/src/notifications)
- `BookingEventPublisher`: `-subscriptions`, `+subscribe(listener, types?): () => void`, `+publish(event)` (isolates listener failures).
- `«interface» BookingEventListener { name; handle(event) }` ⊲ `NotificationService(users, notifications, channels)`, `AuditLogListener` (`+entries`).
- `«interface» NotificationChannel { name; send(recipient, subject, message) }` ⊲ `EmailChannel`, `SmsChannel`.

### 5.5 HTTP layer — [http/](../backend/src/http)
Controllers (`AuthController`, `MovieController`, `TheatreController`, `ShowController`, `BookingController`, `AdminController`) hold service references and expose arrow-function handlers; presenters `movieDto`, `screenDto`, `theatreDto`, `showDto`. Middleware: `authenticate`, `optionalAuthenticate`, `requireCatalogManager`, `validate(part, schema)`, `valid<T>(req, part)`, `idempotencyKey(req)`, `errorHandler`, `notFoundHandler`, `ok(res, data, status)`.

### 5.6 Frontend classes — [frontend/src](../frontend/src)

| Class / object | Members |
|---|---|
| `ApiError extends Error` | `status`, `code`, `details`; getters `isConflict`, `isUnauthorized`, `isNetwork` |
| `HttpClient` | `-baseUrl`, `-getToken`, `-fetchImpl`, `-onUnauthorized`; `get/post/patch/delete/request`, `setUnauthorizedHandler` |
| `Observable<T>` | `#value`, `-listeners`; `~current`, `subscribe(l)`, `~subscriberCount`, `#emit(next)` |
| `SeatAvailabilityPoller extends Observable<SeatAvailabilityState>` | `-showId`, `-fetchSeatMap`, `-intervalMs`, `-timer`, `-inFlight`; `start()`, `stop()`, `refresh()` |
| `«interface» SeatSelectionStrategy` ⊲ `ManualSelectionStrategy`, `ContiguousBlockStrategy` | `id`, `label`, `onSeatClick(clicked, ctx): number[]` |
| `«interface» PaymentFormStrategy`; `PaymentFormFactory` | `method`, `label`, `hint`, `fields`, `validate`, `toDetails`; `static get(method)`, `static all()` |

---

## 6. OOP pillars in the code

**Encapsulation.** State that has rules is private and changes only through intention-revealing methods. `ShowSeat` keeps `#status`, `#bookingId`, `#lockExpiresAt` private; callers must use `lock()`, `book()`, `release()`, which reject illegal transitions:
```ts
book(bookingId: number, now: Date): void {
  if (!this.isHeldBy(bookingId, now)) throw new Error(`Seat ${this.label} is not held by booking ${bookingId}`);
  this.#status = ShowSeatStatus.BOOKED;
  this.#lockExpiresAt = null;
}
```
`Booking.#seats` is exposed as `readonly BookingSeat[]`; `User.#passwordHash` is excluded from `toPublic()` and from JSON serialisation.

**Abstraction.** Services see only interfaces: `UnitOfWorkFactory`, `SeatLockingStrategy`, `PriceCalculator`, `PaymentGateway`, `PasswordHasher`, `TokenService`, `Clock`, `BookingEventListener`. `BookingService.pay` calls `this.payments.charge(...)` without knowing about cards, paise or callbacks.

**Inheritance.** `Entity` → all entities; `User` → `Customer`, `Admin`; `AppError` → 8 subclasses (two levels under `ConflictError`); `AbstractSeatLockingStrategy` → two strategies; `BasePaymentStrategy` → three strategies; `PriceCalculatorDecorator` → three decorators; frontend `Observable` → `SeatAvailabilityPoller`.

**Polymorphism.**
- `requireCatalogManager` calls `req.user.canManageCatalog()` — the subclass answers, no role `if`.
- `errorHandler` reads `err.statusCode` / `err.code` from whichever `AppError` subclass was thrown.
- `SeatLockService` calls `strategy.reserveCandidates/claim` — pessimistic or optimistic at runtime.
- `PaymentStrategyFactory.get(method).pay(...)`, `PriceCalculator.calculate(...)` through any decorator depth, `listener.handle(event)` for any observer, `strategy.onSeatClick(...)` in the UI.

---

## 7. Relationship types

| Relationship | Example | Multiplicity | Where |
|---|---|---|---|
| Association | `Show` → `Movie` (`movieId`), `Show` → `Screen` | Movie 1 — * Show; Screen 1 — * Show | `Show.ts`, FKs `shows.movie_id`, `shows.screen_id` |
| Association | `Booking` → `User`, `Booking` → `Show` | User 1 — * Booking; Show 1 — * Booking | `Booking.ts` |
| Aggregation | `Theatre` ◇ `Screen` (screens listed by theatre; created separately via `addScreen`) | 1 — * | `Theatre.ts` |
| Composition | `Screen` ◆ `Seat` (cascade delete) | 1 — 1..* | `Screen.ts`, `seats.screen_id ON DELETE CASCADE` |
| Composition | `Booking` ◆ `BookingSeat` (line items) | 1 — 1..* | `Booking.ts`, `booking_seats.booking_id ON DELETE CASCADE` |
| Composition | `Show` ◆ `ShowSeat` (inventory) | 1 — 1..* | `show_seats.show_id ON DELETE CASCADE` |
| Inheritance | `Customer`/`Admin` extend `User`; errors; strategies; decorators | — | see §6 |
| Realization | `PgBookingRepository` implements `BookingRepository`; `LegacyPayGatewayAdapter` implements `PaymentGateway`; `NotificationService` implements `BookingEventListener`; `SystemClock`/`FixedClock` implement `Clock` | — | various |
| Dependency | `BookingService` uses `BookingBuilder`, `PriceCalculator`; `TheatreService` uses `SeatLayoutFactory`; controllers use presenters | — | various |

---

## 8. Entity ↔ table mapping

| Class | Table | Notes |
|---|---|---|
| `User` (`Customer`/`Admin`) | `users` | single-table inheritance, discriminator `role` (`user_role` enum); `UserFactory` maps back |
| `Movie` | `movies` | `release_date` read as `YYYY-MM-DD` via `to_char` |
| `Theatre` | `theatres` | |
| `Screen` | `screens` | `capacity` computed with `count(seats)` |
| `Seat` | `seats` | |
| `Show` | `shows` | `end_time` computed by service; overlap guarded by `ex_shows_no_overlap` |
| `ShowSeat` | `show_seats` ⨝ `seats` | row label / number / category come from the join |
| `Booking` | `bookings` | `price_breakdown` JSONB holds `PriceLine[]` |
| `BookingSeat` | `booking_seats` ⨝ `show_seats` ⨝ `seats` | label/category from joins; `is_active` drives the partial unique index |
| `Payment` | `payments` | |
| `NotificationRecord` (read model) | `notifications` | |
| `BookingSummary`, `ShowListing`, `ShowDetails`, `AdminStats` | multi-table read models | query-shaped DTOs in [readModels.ts](../backend/src/repositories/readModels.ts) |
