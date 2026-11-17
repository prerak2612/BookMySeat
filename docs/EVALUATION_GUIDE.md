# Evaluation Guide — BookMySeat

This guide is for the presenters and for evaluator Q&A. It maps each evaluation criterion to concrete artefacts, gives a timed presentation plan and a live demo script, and lists more than 40 viva questions with answers.

---

## 1. Criterion → evidence map

| # | Criterion | Where to look (files / classes / APIs / diagrams) | What to say in one line |
|---|---|---|---|
| 1 | Requirement Analysis | [SRS.md](SRS.md) (FR, NFR, use cases, business rules, edge cases), [use-case.puml](uml/use-case.puml) | Every requirement has an ID, an implementing endpoint and a test. |
| 2 | Class Diagram | [class-diagram.puml](uml/class-diagram.puml), [LLD.md](LLD.md) | The diagram mirrors `backend/src` package by package, with real multiplicities. |
| 3 | Object-Oriented Design | `domain/Booking.ts`, `domain/ShowSeat.ts` (encapsulated state machines), `domain/User.ts` (inheritance and polymorphism), `common/errors.ts` (hierarchy), [LLD.md](LLD.md) | State can only change through guarded methods. |
| 4 | SOLID | [SOLID_PRINCIPLES.md](SOLID_PRINCIPLES.md); `container.ts` (DIP), `repositories/interfaces.ts` (ISP), `concurrency/SeatLockingStrategy.ts` (LSP/OCP) | Both locking strategies pass the *same* concurrency suite, which is LSP proven by tests. |
| 5 | Design Patterns | [DESIGN_PATTERNS.md](DESIGN_PATTERNS.md); Strategy (locking, pricing, payment, selection), Decorator (price), Adapter (LegacyPay), Observer (events, poller), Factory, Builder, Singleton, Template Method | Each pattern solves a problem we actually had. |
| 6 | Sequence & Activity Diagrams | `docs/uml/seq-01 … seq-09`, [activity-booking.puml](uml/activity-booking.puml) | Participants and messages are real class and method names. |
| 7 | API & Interface Design | [API_DOCUMENTATION.md](API_DOCUMENTATION.md), `http/routes.ts`, `http/validators/schemas.ts`, `Idempotency-Key` | Uniform envelope, precise status codes (402/409/410/422 have distinct meanings). |
| 8 | Database Schema | [DATABASE_DESIGN.md](DATABASE_DESIGN.md), `db/migrations/001_initial_schema.sql`, `002_indexes.sql` | The DB itself forbids double booking (partial unique index) and overlapping shows (exclusion constraint). |
| 9 | Error Handling, Validation, Edge Cases | `http/middleware/index.ts` (`errorHandler`), `common/errors.ts`, `tests/integration/bookings.test.ts`, [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md) | Declines commit as FAILED; infrastructure errors roll back; both are tested. |
| 10 | Working Implementation | `npm test` (109 backend + 21 frontend tests), `npm run test:e2e` (4 browser tests), `npm run demo:concurrency` | Live: 50 simultaneous requests produce exactly 1 hold and 49 × 409. |

---

## 2. Presentation plan (≈ 14 minutes)

| Time | Speaker | Content | Show |
|---|---|---|---|
| 0:00–1:00 | Meenaksh | Problem and goals: booking that is correct under concurrency | README architecture diagram |
| 1:00–3:00 | Meenaksh | Requirements & architecture: actors, key business rules, Controller → Service → Repository, composition root | SRS use-case table, ARCHITECTURE layer diagram |
| 3:00–4:30 | Meenaksh | OOD and SOLID: Booking state machine, User polymorphism, DIP via container | `Booking.ts`, SOLID table |
| 4:30–6:30 | Prerak | Database: normalisation, `show_seats` as the lockable inventory, constraints, indexes | ER diagram, `001_initial_schema.sql` |
| 6:30–9:00 | Prerak | **Concurrency**: race condition, FOR UPDATE vs version CAS, unique-index last line of defence, lock ordering, expiry, idempotency | seq-05 diagram, CONCURRENCY timelines |
| 9:00–11:00 | Samarth | Design patterns: Strategy/Decorator/Adapter/Observer/Factory on backend and frontend | class diagram excerpt, DESIGN_PATTERNS |
| 11:00–13:30 | Samarth + Prerak | **Live demo** (see §3) | browser + terminal |
| 13:30–14:00 | All | Testing results and limitations, then hand over to questions | TESTING summary |

---

## 3. Live demonstration script

Before the session, run once:

```bash
./scripts/db.sh start
npm run install:all          # first time only
npm run db:reset             # fresh demo data with shows relative to "now"
npm run dev:backend          # terminal 1 → http://localhost:4000
npm run dev:frontend         # terminal 2 → http://localhost:5173
```

1. **Browse** (Samarth). Open http://localhost:5173, filter by genre, open a movie, switch day tabs and city, and point out the "N left" availability on the showtimes.
2. **Book** (Samarth). Sign in as `alice@example.com / Password1` and pick two seats. Switch the mode to *Select a block of seats together* and show contiguous selection. Click Hold, then on the checkout page show the server-computed price breakdown and the countdown. Pay with card `4111 1111 1111 1111`, `12/30`, `123`, and show the confirmation ticket.
3. **Conflict in the UI** (Samarth). Open a second browser profile (or incognito) as `bob@example.com / Password1` on the same show. Both select the same seat; Alice holds first; Bob clicks Hold and gets the conflict message, and the seat turns "Held by others".
4. **Concurrency at scale** (Prerak). Run `npm run demo:concurrency -- --users 50 --pay` and show the table: `201 × 1`, `409 SEAT_UNAVAILABLE × 49`, then the winner's payment confirmed. Optionally restart the backend with `SEAT_LOCK_STRATEGY=OPTIMISTIC npm run dev:backend` and run it again: same result, different mechanism.
5. **Prove it in the DB** (Prerak). Run in `psql -h 127.0.0.1 -p 5433 -U bookmyseat bookmyseat`:
   ```sql
   SELECT show_seat_id, count(*) FROM booking_seats WHERE is_active GROUP BY 1 HAVING count(*) > 1;  -- 0 rows
   ```
6. **Failure paths** (Meenaksh). Pay with `4000 0000 0000 0002` to get a decline (402, booking FAILED, seats released). Pay with `4000 0000 0000 9999` to simulate a gateway outage (500): the booking is still PENDING and can be retried, which shows rollback.
7. **Cancellation** (Meenaksh). In *My bookings*, cancel the confirmed booking to show the refund and the notification feed (Observer output).
8. **Admin** (Meenaksh). Sign in as `admin@bookmyseat.dev / Admin@123`, show the dashboard metrics, and schedule an overlapping show to show the 409 *Another show is already scheduled*.
9. **Tests** (any). Run `npm test` and show 109 + 21 passing.

---

## 4. Key design decisions (for "why did you…?" questions)

| Decision | Reason | Alternative considered |
|---|---|---|
| PostgreSQL + raw SQL (node-postgres) | Locking semantics (`FOR UPDATE`, partial indexes, exclusion constraints, advisory locks) must be explicit and explainable | ORM: hides the locking SQL we are evaluated on |
| `show_seats` table per show | It is the row we lock; physical `seats` stay immutable | Status column on `seats`: wrong, because a seat is booked per show |
| Hold (PENDING booking) before payment | Users need time to pay; a hold is a time-boxed lock | Book directly at payment: no protection while the user types card details |
| READ COMMITTED + explicit row locks | Precise, cheap and predictable; failures are business errors, not retries | SERIALIZABLE: more aborts and harder to explain which conflict happened |
| Two interchangeable locking strategies | Demonstrates both pessimistic and optimistic control; LSP | Only one: less to compare |
| Lazy expiry plus sweeper | Correctness never depends on a background job running on time | Sweeper only: a seat stays blocked until the job runs |
| Events published after COMMIT | Never notify about something rolled back | Publish inside the transaction: phantom e-mails |
| Payment call inside the confirm transaction | Simple and atomic, and the simulated gateway is fast | Production: payment intent outside the transaction, plus an outbox |
| Idempotency keys on hold and pay | Double-clicks and network retries must not create two bookings or charges | Disable button only: not safe against retries |

---

## 5. Booking workflow every member must be able to explain

1. `GET /shows/:id/seats` → `SeatAvailabilityService` returns the *effective* status (an expired lock is shown as AVAILABLE). This is informational only.
2. `POST /bookings` → `BookingService.createHold` validates the input, takes an advisory lock on the idempotency key, and checks that the show is bookable. Then `SeatLockService.hold`:
   - the strategy runs `reserveCandidates` (`FOR UPDATE` in pessimistic mode),
   - expired holds are reclaimed,
   - the booking header is inserted,
   - the strategy runs `claim`,
   - the line items are inserted (under the partial unique index).
   The whole sequence is one transaction.
3. `POST /bookings/:id/payments` → `lockBookingForUpdate` locks the seats and then the booking. The service then checks idempotency replay, expiry, `assertPayable` and `assertStillHeld`, and calls `PaymentService.charge` (Strategy → Adapter → SDK):
   - **success:** payment SUCCESS, seats BOOKED, booking CONFIRMED;
   - **decline:** payment FAILED, booking FAILED, seats released (committed);
   - **exception:** ROLLBACK.
   After COMMIT the event is published to `NotificationService` and `AuditLogListener`.
4. `POST /bookings/:id/cancel` → locks taken in the same order. `Booking.cancel` enforces the cut-off, a refund is made through the strategy, the seats are released and the event is published.
5. `HoldExpiryJob` → expires PENDING holds past `expires_at` and releases orphaned locks.

---

## 6. Viva questions and answers

### A. Requirements & architecture

1. **What are the actors?** Customer and Admin (Admin can do everything a Customer can, plus catalogue management), plus two system actors: the Hold Expiry Job and the payment gateway.
2. **Why a layered architecture?** Controllers handle HTTP only, services hold business rules and transaction boundaries, and repositories hold SQL. Each layer can be tested and changed independently, e.g. services are unit-tested with in-memory fakes.
3. **Where is dependency injection done?** In `backend/src/container.ts`, using constructor injection with no framework. It is the only file that names concrete classes. Tests override the clock, gateway, locking strategy and Unit of Work.
4. **What is the Unit of Work here?** `UnitOfWork` is a set of repositories bound to one connection. `UnitOfWorkFactory.transaction(fn)` gives `fn` repositories that all run inside the same `BEGIN … COMMIT`.
5. **How is the frontend separated from the backend?** They are separate apps that talk only through the REST API. In development Vite proxies `/api` to port 4000. The frontend is never trusted for availability or pricing.
6. **What happens on an invalid request body?** The Zod schema in the `validate` middleware throws a `ZodError`. The central `errorHandler` turns it into `400 VALIDATION_ERROR` with per-field details.

### B. OOP & SOLID

7. **Show encapsulation.** `Booking` and `ShowSeat` keep their state in `#private` fields and expose transitions (`confirm`, `cancel`, `lock`, `book`, `release`) that validate guards. No code can set `status = 'BOOKED'` directly.
8. **Show inheritance and polymorphism.** `User` is abstract with `Customer`/`Admin` subclasses. `canManageCatalog()` is answered by the subclass, and the admin middleware calls it without checking roles. The `AppError` subclasses each carry their own `statusCode`.
9. **Where is abstraction used?** Interfaces such as `SeatLockingStrategy`, `PaymentGateway`, `PriceCalculator`, `Clock` and the repository ports. Services know *what* a collaborator does, not how.
10. **Composition vs aggregation in your model?** Screen *composes* Seats (they are deleted with it, `ON DELETE CASCADE`) and Booking composes BookingSeats. Theatre *aggregates* Screens conceptually. Show is an *association* between Movie and Screen.
11. **Give an SRP example.** `BookingService` orchestrates; `SeatLockService` owns seat state; `PaymentService` owns money; presenters own response shapes; controllers own HTTP.
12. **Give an OCP example.** Add a payment method by registering a new strategy in `PaymentStrategyFactory`. Add a charge (e.g. a festival discount) as a new `PriceCalculatorDecorator`. In both cases no existing class changes.
13. **How do you prove LSP?** The identical concurrency suite runs against both `PessimisticSeatLockingStrategy` and `OptimisticSeatLockingStrategy` (16 tests in total), and every payment strategy satisfies the same contract against a fake gateway.
14. **Give an ISP example.** `MovieReader` and `MovieWriter` are separate interfaces, and `PaymentProcessor` and `RefundProcessor` are separate. Browsing code depends only on reading.
15. **Give a DIP example.** `BookingService` depends on `UnitOfWorkFactory`, `PaymentService`, `PriceCalculator`, `Clock` and `BookingEventPublisher`, never on `pg` or `Date.now()`.

### C. Design patterns

16. **Why Strategy for seat locking?** There are two valid concurrency-control mechanisms with the same contract. Strategy lets us switch with configuration and compare them under the same tests.
17. **Why Decorator for pricing?** Charges stack (weekend surcharge, then fee, then GST) and their order matters. Decorators compose them without subclass explosion or `if` chains.
18. **What does the Adapter adapt?** `LegacyPaySdk` uses callbacks, paise and numeric codes. `LegacyPayGatewayAdapter` exposes our promise-based, rupee-based `PaymentGateway`, so strategies never see the SDK.
19. **Where is Observer used, and why after commit?** `BookingEventPublisher` notifies `NotificationService` and `AuditLogListener`. Publishing after COMMIT means we never notify about rolled-back work, and listener failures cannot break a booking. On the frontend, `SeatAvailabilityPoller` notifies the seat grid.
20. **Is Singleton justified?** Only for `Database`: a process must share one connection pool or it would exhaust `max_connections`. Everything else is injected.
21. **What does the Builder give you?** `BookingBuilder` assembles a booking from many parts (user, show, seats, pricing, expiry, idempotency key) and validates the whole before any SQL runs.
22. **Where is Template Method?** `BasePaymentStrategy.pay()` fixes the order validate → tokenise → charge → map, and `AbstractSeatLockingStrategy.reserveCandidates()` fixes load → existence check → availability check.

### D. Database

23. **Why is `show_seats` a separate table?** Availability belongs to a seat *for a show*. It is also the exact row we lock, while physical seats stay immutable.
24. **How does the DB itself prevent double booking?** The partial unique index `ux_booking_seats_one_active_per_show_seat ON booking_seats(show_seat_id) WHERE is_active` allows at most one active reservation per show seat even if application code were wrong. There is a test that inserts a duplicate with raw SQL and gets `23505`.
25. **What does the exclusion constraint do?** `EXCLUDE USING gist (screen_id WITH =, tstzrange(start_time,end_time) WITH &&) WHERE status='SCHEDULED'` stops two scheduled shows overlapping on one screen. It needs `btree_gist`.
26. **Why copy price into `booking_seats`?** Historical correctness: if a show's base price changes later, past bookings must keep what was charged. This is intentional, documented denormalisation.
27. **Which indexes, and why?** For example, `ix_show_seats_show_status` for seat maps and counts, the partial `ix_bookings_pending_expiry` for the sweeper, and `ix_bookings_user_created` for history. Each one matches a repository query.
28. **What is in the CHECK on `show_seats`?** It enforces that the columns agree with the status: AVAILABLE has no booking or expiry, LOCKED has both, BOOKED has a booking and no expiry. An impossible state is rejected (tested with `23514`).

### E. Concurrency (expect the most follow-ups here)

29. **What exactly is the race?** "Check that a seat is free, then book it" is two steps. Without control two transactions can both pass the check. This is check-then-act.
30. **How does the pessimistic strategy prevent it?** `SELECT … FOR UPDATE OF ss ORDER BY ss.id` takes exclusive row locks. The second transaction *blocks* until the first commits, then reads the committed row (LOCKED) and fails with `SeatUnavailableError` (409).
31. **And the optimistic one?** It reads without locks, then runs `UPDATE … WHERE id = X AND version = v_read`. Under READ COMMITTED the loser waits for the winner's row lock, PostgreSQL re-evaluates the WHERE against the new row version, the version no longer matches, so 0 rows are updated. We detect the shortfall and roll back.
32. **Why `ORDER BY ss.id`?** So that all transactions acquire row locks in one global order. Two bookings for {A1, A2} and {A2, A1} cannot deadlock. The order across tables is always show_seats, then bookings.
33. **What if a deadlock still happens?** `TransactionManager` retries on `40P01`/`40001` with jitter (up to 3 times). If retries run out, the API returns `409 CONCURRENT_UPDATE`.
34. **What happens to an abandoned hold?** It expires lazily: lock queries treat `lock_expires_at <= now` as available, and the next booker reclaims it in the same transaction (the old booking is marked EXPIRED and its line deactivated). `HoldExpiryJob` also sweeps periodically. Correctness never depends on the job.
35. **Can the original user still pay after their hold was reclaimed?** No. `assertStillHeld` sees the seat now belongs to another booking, so the API returns `410 HOLD_EXPIRED`. This is tested.
36. **How are duplicate requests handled?** For holds, `pg_advisory_xact_lock(hash('hold:user:key'))` serialises same-key requests, the second returns the first booking (200), and `UNIQUE(user_id, idempotency_key)` backs this up. For payments, the booking row lock plus `UNIQUE(booking_id, idempotency_key)` means a replay returns the original result, and `ux_payments_one_success_per_booking` guarantees at most one successful charge.
37. **Why not just rely on the frontend disabling sold seats?** The frontend view is always stale (it polls every 5 s) and clients can be bypassed with curl. The demo script itself bypasses the UI.
38. **What isolation level, and why not SERIALIZABLE?** READ COMMITTED plus explicit locks. It gives exactly the guarantees we need with predictable blocking. SERIALIZABLE would add serialization-failure retries for unrelated predicate conflicts.
39. **What is rolled back on a gateway outage?** Everything in the pay transaction: no payment row is written, the seats stay LOCKED for the user and the booking stays PENDING. The user can retry. This is tested, along with a simulated DB failure *after* the charge and seat update (via the `wrapUnitOfWork` decorator).
40. **How did you test 50 simultaneous requests?** The test starts the real Express server on an ephemeral port, creates 50 users, and fires 50 `fetch` POSTs with `Promise.all` against the real PostgreSQL. It asserts exactly one 201, 49 × 409, a single active line and no orphan bookings. It runs for both strategies and passed 3 consecutive runs.

### F. API, errors, testing

41. **Why 402, 409, 410 and 422?** 402 means payment declined. 409 means a state conflict (seat taken, already paid). 410 means the hold is gone (expired). 422 means a valid request that breaks a business rule (cut-off, too many seats). A client can react differently to each.
42. **What does the error envelope look like?** `{ success: false, error: { code, message, details? } }`, produced in one place (`errorHandler`). Database errors are mapped by SQLSTATE (23505, 23503, 23P01, 23514, 22P02, 40001/40P01).
43. **How do you test time-dependent rules?** Through an injected `Clock`. Tests use `FixedClock.advanceMinutes()` to expire holds or cross the cancellation cut-off without sleeping.
44. **What did your E2E tests catch?** A real UX bug: after a 409, the refreshed seat map triggered a "seats removed" notice that overwrote the server's conflict message. It was fixed in `SeatSelectionPage`.
45. **What is not covered?** Load beyond 50 concurrent requests, multi-instance deployment testing, a real payment provider, and coverage thresholds.

### Difficult follow-ups (with short answers)

- **"Holding row locks during a payment call is bad. Defend it."** It is acceptable here because the gateway is simulated and fast. In production we would mark the booking PAYMENT_IN_PROGRESS, call the provider *outside* the transaction with the idempotency key, and confirm in a second short transaction, or use an outbox. The hold expiry already gives the time bound.
- **"Two server instances?"** It is safe: every lock lives in PostgreSQL, the API is stateless, the sweeper re-checks under lock, and advisory locks are DB-wide.
- **"Clock skew between app and DB?"** All expiry comparisons use the application clock on both write and check paths, so they are consistent with a single clock. With multiple app servers, NTP or the DB `now()` would be used. The client countdown is anchored to server-supplied `holdSecondsRemaining`.
- **"Why is the optimistic version check needed if the unique index exists?"** Defence in depth. The version check catches the race at the `show_seats` row (the source of truth). The index is the last resort if code were wrong. Each is proven independently.
- **"What if the user pays exactly when the hold expires?"** Expiry is `expires_at <= now`, applied consistently. Under the row lock either payment sees a valid hold and confirms (and the reclaimer then sees BOOKED), or the reclaimer wins and payment gets 410. Both cannot happen.

---

## 7. Remaining limitations (state them honestly)

- Payment is simulated (an adapter over a fake SDK). No real provider integration.
- Notifications are simulated (logged and stored), not actually e-mailed or texted.
- Seat availability uses polling every 5 s, not WebSockets/SSE. The server is still authoritative.
- No rate limiting or refresh tokens. The JWT lifetime is 8 h.
- UML diagrams were written by hand to match the code but were not render-checked in the build environment.
