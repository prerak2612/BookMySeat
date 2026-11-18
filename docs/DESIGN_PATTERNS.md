# Design Patterns — BookMySeat

Patterns were introduced only where they solve a concrete problem in this system. Summary:

| Category | Pattern | Where |
|---|---|---|
| Creational | Factory / Factory Method | `UserFactory`, `SeatLayoutFactory`, `PaymentStrategyFactory`, `PriceCalculatorFactory`, `createSeatLockingStrategy`, frontend `PaymentFormFactory` |
| Creational | Builder | `BookingBuilder` |
| Creational | Singleton | `Database` |
| Structural | Adapter | `LegacyPayGatewayAdapter` |
| Structural | Decorator | price decorators; `wrapUnitOfWork` fault-injection decorator (tests) |
| Structural | Facade | `PaymentService` |
| Behavioural | Strategy | seat locking, seat pricing, payment methods, notification channels, frontend seat selection & payment forms |
| Behavioural | Observer | `BookingEventPublisher` + listeners; frontend `Observable` / `SeatAvailabilityPoller` |
| Behavioural | Template Method | `AbstractSeatLockingStrategy`, `BasePaymentStrategy`, `PriceCalculatorDecorator` |
| Architectural | Repository, Unit of Work | `repositories/interfaces.ts`, `PgUnitOfWorkFactory` |

---

## 1. Factory

### 1.1 `UserFactory` — [domain/User.ts](../backend/src/domain/User.ts)
1. **Problem:** rows from `users` carry a `role` string; the rest of the code needs a `Customer` or `Admin` object with role-specific behaviour.
2. **Why:** centralises the role → class decision so no other code switches on `role`.
3. **Participants:** `UserFactory`, `User`, `Customer`, `Admin`, `PgUserRepository` (caller).
4. **Implementation:**
   ```ts
   static create(props: UserProps): User {
     switch (props.role) {
       case UserRole.ADMIN: return new Admin(props);
       case UserRole.CUSTOMER: return new Customer(props);
       default: throw new Error(`Unknown user role: ${String(props.role)}`);
     }
   }
   ```
5. **Interaction:** repository maps a row → `UserFactory.create` → middleware calls polymorphic `canManageCatalog()`.
6. **Trade-offs:** + one place to add a role; − a new role still edits the switch (acceptable: roles change rarely).

### 1.2 `SeatLayoutFactory` — [services/SeatLayoutFactory.ts](../backend/src/services/SeatLayoutFactory.ts)
1. **Problem:** screens are created from either a named preset or an explicit row list; both must produce valid, uniquely-labelled seats.
2. **Why:** a factory hides the two construction paths and enforces layout rules in one place.
3. **Participants:** `SeatLayoutFactory`, `TheatreService.addScreen`, `PgTheatreRepository.createScreen`.
4. **Implementation:** `static create(spec: LayoutSpec): SeatCreate[]` resolves `PRESETS[spec.preset]` or `spec.rows`, rejects empty/duplicate rows, expands rows into `{rowLabel, seatNumber, category}`.
5. **Interaction:** controller → `TheatreService.addScreen(theatreId, name, layout)` → factory → bulk insert inside a transaction.
6. **Trade-offs:** + new presets are data; − presets are code, not admin-editable.

### 1.3 `PaymentStrategyFactory` — [payments/PaymentStrategyFactory.ts](../backend/src/payments/PaymentStrategyFactory.ts)
1. **Problem:** pick the payment strategy for a request's `method` without conditionals in business code.
2. **Why:** registry-based factory makes the set of methods open for extension.
3. **Participants:** `PaymentStrategyFactory`, `CardPaymentStrategy`, `UpiPaymentStrategy`, `WalletPaymentStrategy`, `PaymentService`.
4. **Implementation:** `register(strategy)` stores by `strategy.method`; `get(method)` throws `ValidationError` for unknown methods; `withDefaults(gateway)` wires the three built-ins.
5. **Interaction:** `PaymentService.charge(method, …)` → `factory.get(method).pay(...)`.
6. **Trade-offs:** + OCP; − registration must happen at start-up (done in `container.ts`).

### 1.4 `PriceCalculatorFactory` — [pricing/pricing.ts](../backend/src/pricing/pricing.ts)
Builds the strategy + decorator chain from configuration (order: base → weekend → fee → tax). Keeps the assembly rule ("tax is last") out of services.

### 1.5 `createSeatLockingStrategy` — [concurrency/SeatLockingStrategy.ts](../backend/src/concurrency/SeatLockingStrategy.ts)
Factory function returning `OptimisticSeatLockingStrategy` or `PessimisticSeatLockingStrategy` from `SEAT_LOCK_STRATEGY`, so the mechanism is a deployment decision and tests can run both.

### 1.6 Frontend `PaymentFormFactory` — [frontend/src/patterns/paymentForms.ts](../frontend/src/patterns/paymentForms.ts)
`static get(method)` / `static all()` over a registry of `PaymentFormStrategy` objects; `CheckoutPage` renders whichever strategy is returned (fields, validation, payload builder).

---

## 2. Builder — `BookingBuilder` ([domain/Booking.ts](../backend/src/domain/Booking.ts))
1. **Problem:** a booking draft has many required parts (user, show, ≥1 seat with prices, subtotal/total/breakdown, hold expiry, optional idempotency key, reference) that become available at different points inside the hold transaction.
2. **Why:** a telescoping constructor with 9 positional arguments is error-prone; the builder assembles step by step and validates the whole in `build()` before any SQL runs.
3. **Participants:** `BookingBuilder`, `BookingDraft`, `BookingService` (director), `PgBookingRepository.createHeader/addLines`.
4. **Implementation (from `BookingService.createHold`):**
   ```ts
   const builder = new BookingBuilder()
     .forUser(user.id).forShow(show.id)
     .withPricing(quote.subtotal, quote.total, quote.lines)
     .withIdempotencyKey(idempotencyKey)
     .holdUntil(expiresAt);
   quote.seatPrices.forEach((s) => builder.withSeat({ showSeatId: s.showSeatId, seatLabel: s.label, category: s.category, price: s.price }));
   return builder.build();
   ```
   `build()` throws on missing user/show/pricing/expiry, zero seats or duplicate seats, and generates `BMS-XXXXXXXX`.
5. **Interaction:** `SeatLockService.hold` calls the `buildDraft(seats)` callback after the seats are validated, so prices are computed only for seats that are actually available.
6. **Trade-offs:** + readable, validated construction; − extra class for one aggregate.

---

## 3. Singleton — `Database` ([db/Database.ts](../backend/src/db/Database.ts))
1. **Problem:** every module needs database access, but a process must share one connection pool; multiple pools would exhaust `max_connections`.
2. **Why genuinely appropriate:** the pool is a process-wide physical resource.
3. **Participants:** `Database` (private constructor, static `getInstance()`, static `close()`).
4. **Implementation:** lazily creates `new pg.Pool({ connectionString, max })` once.
5. **Interaction:** only `container.ts`, `migrate.ts`, `seed.ts` and test helpers call `getInstance()`; services receive the pool indirectly through `UnitOfWorkFactory` (so the singleton does not leak into business code).
6. **Trade-offs:** + one pool; − global state (mitigated: tests can pass their own `pool` via `ContainerOverrides`).

---

## 4. Adapter — `LegacyPayGatewayAdapter` ([payments/gateway/LegacyPayGatewayAdapter.ts](../backend/src/payments/gateway/LegacyPayGatewayAdapter.ts))
1. **Problem:** the (simulated) third-party `LegacyPaySdk` uses paise, instrument codes `CC/UPI/WLT`, response codes `00/05/51` and Node-style callbacks; our code wants rupees, promises and a boolean `approved`.
2. **Why:** we must not change the SDK and must not spread its API through our strategies.
3. **Participants:** target `PaymentGateway`; adaptee `LegacyPaySdk`; adapter `LegacyPayGatewayAdapter`; clients `BasePaymentStrategy` subclasses.
4. **Implementation:**
   ```ts
   charge(request: GatewayChargeRequest): Promise<GatewayResult> {
     const payload = { amount_paise: Math.round(roundMoney(request.amount) * 100),
                       instrument_type: INSTRUMENT_CODES[request.instrumentType], ... };
     return new Promise((resolve, reject) => {
       this.sdk.makeTransaction(payload, (err, response) => {
         if (err || !response) return reject(new GatewayUnavailableError(err?.message ?? 'No response from gateway'));
         resolve(LegacyPayGatewayAdapter.toResult(response));
       });
     });
   }
   ```
5. **Interaction:** strategy → `gateway.charge(...)` → adapter → SDK callback → `GatewayResult`; an SDK error becomes `GatewayUnavailableError`, which rolls the pay transaction back.
6. **Trade-offs:** + swapping providers = new adapter; − one extra translation layer. Verified in [payments.test.ts](../backend/tests/unit/payments.test.ts) ("converts rupees to paise…").

---

## 5. Decorator

### 5.1 Price decorators — [pricing/pricing.ts](../backend/src/pricing/pricing.ts)
1. **Problem:** the final price is the ticket subtotal plus a variable set of charges (weekend surcharge, convenience fee, GST) whose presence and order are configuration.
2. **Why:** each charge is an independent responsibility that wraps the previous quote; decorators compose at runtime without subclass explosion (`WeekendTaxedFeeCalculator`, …).
3. **Participants:** component `PriceCalculator`; concrete component `BasePriceCalculator`; abstract decorator `PriceCalculatorDecorator`; concrete decorators `WeekendSurchargeDecorator`, `ConvenienceFeeDecorator`, `TaxDecorator`.
4. **Implementation:**
   ```ts
   export abstract class PriceCalculatorDecorator implements PriceCalculator {
     constructor(protected readonly inner: PriceCalculator) {}
     calculate(context: PricingContext): PriceQuote {
       const quote = this.inner.calculate(context);
       const extra = this.extraCharge(quote, context);
       if (!extra || extra.amount === 0) return quote;
       const amount = roundMoney(extra.amount);
       return { ...quote, lines: [...quote.lines, { label: extra.label, amount }], total: roundMoney(quote.total + amount) };
     }
     protected abstract extraCharge(quote: PriceQuote, context: PricingContext): PriceLine | null;
   }
   ```
5. **Interaction:** `BookingService` calls `pricing.calculate(...)` once; each decorator appends a line to the breakdown stored in `bookings.price_breakdown`.
6. **Trade-offs:** + new charges without editing existing code, itemised receipts for free; − order sensitivity (handled by the factory).

### 5.2 Unit-of-Work fault-injection decorator (tests)
`ContainerOverrides.wrapUnitOfWork` ([container.ts](../backend/src/container.ts)) lets a test wrap the real `UnitOfWorkFactory`. [bookings.test.ts](../backend/tests/integration/bookings.test.ts) decorates `bookings.save` to throw after the payment row was inserted and seats marked BOOKED, proving the whole pay transaction rolls back — without any test-only branches in production code.

---

## 6. Facade — `PaymentService` ([payments/PaymentService.ts](../backend/src/payments/PaymentService.ts))
Offers two coarse operations (`charge`, `refund`) over factory + strategies + gateway + logging. `BookingService` depends only on this facade.

---

## 7. Strategy

### 7.1 Seat-locking strategy (concurrency) — [concurrency/SeatLockingStrategy.ts](../backend/src/concurrency/SeatLockingStrategy.ts)
1. **Problem:** two valid concurrency-control mechanisms exist with different performance characteristics (pessimistic row locks for hot seats, optimistic version CAS for low contention).
2. **Why:** interchangeable algorithms behind one interface; selectable by configuration; both verifiable by the same tests.
3. **Participants:** `SeatLockingStrategy`, `AbstractSeatLockingStrategy`, `PessimisticSeatLockingStrategy`, `OptimisticSeatLockingStrategy`, context `SeatLockService`.
4. **Implementation:**
   ```ts
   // Pessimistic
   protected loadCandidates(uow, showId, seatIds) { return uow.showSeats.findByShowAndSeatIds(showId, seatIds, { forUpdate: true }); }
   async claim(uow, seats, bookingId, expiresAt) { await uow.showSeats.lockSeats(seats.map((s) => s.id), bookingId, expiresAt); }
   // Optimistic
   async claim(uow, seats, bookingId, expiresAt) {
     const updated = new Set(await uow.showSeats.lockSeatsIfUnchanged(sorted.map((s) => ({ id: s.id, version: s.version })), bookingId, expiresAt));
     if (updated.size !== seats.length) throw new SeatUnavailableError(...);
   }
   ```
5. **Interaction:** `SeatLockService.hold`: `reserveCandidates` → re-claim expired → `createHeader` → `claim` → `addLines`.
6. **Trade-offs:** pessimistic: losers wait briefly then fail cleanly, no wasted work; optimistic: no waiting on reads, but losers do some wasted work and rely on the version check. Details in [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md).

### 7.2 Seat pricing strategy
`SeatPricingStrategy` with `CategoryPricingStrategy` (1.0 / 1.5 / 2.2) and `FlatPricingStrategy`, chosen by `PRICING_STRATEGY`. Used both by the price calculator and by `SeatAvailabilityService` to display per-seat prices — one rule, two consumers.

### 7.3 Payment method strategy — [payments/PaymentStrategies.ts](../backend/src/payments/PaymentStrategies.ts)
`CardPaymentStrategy`, `UpiPaymentStrategy`, `WalletPaymentStrategy` implement `PaymentProcessor` + `RefundProcessor`, each with its own validation, tokenisation and masking. Selected per request by `PaymentStrategyFactory`.

### 7.4 Notification channel strategy — [notifications/NotificationService.ts](../backend/src/notifications/NotificationService.ts)
`NotificationChannel` with `EmailChannel` and `SmsChannel`; `NotificationService` loops over the injected list, so adding push notifications is one class.

### 7.5 Frontend seat-selection strategy — [frontend/src/patterns/seatSelectionStrategies.ts](../frontend/src/patterns/seatSelectionStrategies.ts)
1. **Problem:** users want either to pick seats one by one or to grab N adjacent seats with one click.
2. **Participants:** `SeatSelectionStrategy`, `ManualSelectionStrategy`, `ContiguousBlockStrategy`, context `SeatSelectionPage`, presentational `SeatMap`.
3. **Implementation:** `onSeatClick(clicked, { seatMap, selected, quantity, maxSeats }): number[]`; the block strategy slides left to find `quantity` contiguous free seats of the same category and never spans a booked seat.
4. **Trade-offs:** `SeatMap` stays dumb (renders + reports clicks); behaviour is unit-tested in isolation ([patterns.test.ts](../frontend/tests/unit/patterns.test.ts)).

### 7.6 Frontend payment-form strategy
Each `PaymentFormStrategy` declares `fields`, `validate`, `toDetails` and a `hint`; `CheckoutPage` is generic over them. Client validation is UX only — the backend strategy re-validates.

---

## 8. Observer

### 8.1 Booking events — [notifications/BookingEventPublisher.ts](../backend/src/notifications/BookingEventPublisher.ts)
1. **Problem:** confirming, failing, expiring or cancelling a booking must trigger side effects (e-mail, SMS, audit log, future analytics) that must not couple to, slow down, or break the booking transaction.
2. **Why:** publisher/subscriber decouples the booking workflow from any number of reactions.
3. **Participants:** subject `BookingEventPublisher`; observer interface `BookingEventListener`; concrete observers `NotificationService`, `AuditLogListener`; event `BookingEvent`; publishers `BookingService`, `HoldExpiryJob`.
4. **Implementation:**
   ```ts
   async publish(event: BookingEvent): Promise<void> {
     const targets = this.subscriptions.filter((s) => !s.types || s.types.has(event.type));
     await Promise.all(targets.map(async ({ listener }) => {
       try { await listener.handle(event); }
       catch (err) { logger.error('listener.failed', { listener: listener.name, event: event.type, error: (err as Error).message }); }
     }));
   }
   ```
5. **Interaction:** `BookingService.pay` returns an outcome from the transaction and publishes **after COMMIT** — so notifications never describe rolled-back work; a failing listener is logged and isolated. Subscriptions are wired in `container.ts`; `subscribe` supports type filters and returns an unsubscribe function.
6. **Trade-offs:** + open for new reactions; − in-process and not durable (a crash between commit and publish loses a notification — an outbox table is listed as future work).

### 8.2 Frontend seat availability — [Observable.ts](../frontend/src/patterns/Observable.ts), [SeatAvailabilityPoller.ts](../frontend/src/patterns/SeatAvailabilityPoller.ts)
`Observable<T>` (subject with replay-on-subscribe) → `SeatAvailabilityPoller` polls `GET /shows/:id/seats` every 5 s, deduplicates concurrent refreshes, keeps the last good map on errors and stops on 404. React components subscribe through `useObservable` ([hooks.ts](../frontend/src/state/hooks.ts)). After a 409 the page calls `poller.refresh()`, and all observers (grid, legend, selection pruning) update together.

---

## 9. Template Method
- `AbstractSeatLockingStrategy.reserveCandidates` fixes *load → existence check → availability check*; subclasses supply `loadCandidates` and `claim`.
- `BasePaymentStrategy.pay` fixes *amount check → validate → tokenise → gateway.charge → map result*; subclasses supply `validate`, `tokenise`, `mask`.
- `PriceCalculatorDecorator.calculate` fixes *delegate → compute extra → append line*; subclasses supply `extraCharge`.

Benefit: invariants (e.g. "never charge with invalid details", "never claim a seat that wasn't validated") cannot be skipped by a new subclass.

---

## 10. Repository and Unit of Work
- **Repository:** persistence ports in [interfaces.ts](../backend/src/repositories/interfaces.ts), PostgreSQL adapters in [repositories/pg](../backend/src/repositories/pg). Services never see SQL.
- **Unit of Work:** `UnitOfWorkFactory.transaction(work)` hands `work` a set of repositories bound to one transactional connection ([PgUnitOfWork.ts](../backend/src/repositories/pg/PgUnitOfWork.ts)); commit/rollback/retry live in `TransactionManager`. This is what makes "lock seats + insert booking + insert lines" atomic.

---

## 11. Patterns deliberately not used

| Pattern | Why not |
|---|---|
| State pattern (one class per booking state) | Booking has five states with simple guarded transitions; explicit methods with guards on the aggregate are clearer and keep the state in one column-mapped field. |
| Command / CQRS bus | One process, synchronous use cases; a bus would add indirection without benefit. Read models (`BookingSummary`, `ShowListing`) give a light read/write split already. |
| Abstract Factory | No families of related products vary together. |
| Proxy | No remote objects or lazy loading needed; repositories already isolate access. |
| ORM Active Record | Hides the exact SQL; concurrency control here depends on precise `FOR UPDATE`, `ORDER BY` and conditional `UPDATE` statements. |
| DI container library | Manual wiring in one `container.ts` is ~100 lines, fully typed and transparent for evaluation. |
| More Singletons (config, logger) | Plain module exports suffice; only the pool needs controlled single instantiation. |
