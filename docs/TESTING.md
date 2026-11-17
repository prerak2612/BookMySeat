# Testing

## 1. Strategy

```
                 ┌──────────────┐
                 │  E2E (4)     │  Playwright + real Chrome → Vite → Express → PostgreSQL
               ┌─┴──────────────┴─┐
               │ Concurrency (16) │  50 simultaneous HTTP requests, DB invariants checked
             ┌─┴──────────────────┴─┐
             │  Integration (31)    │  real HTTP server + real PostgreSQL test DB
           ┌─┴──────────────────────┴─┐
           │  Unit (62 backend,        │  domain, patterns, services with fakes,
           │        21 frontend)       │  components with Testing Library
           └───────────────────────────┘
```

Principles:

- **Real database for anything involving persistence or concurrency.** Locking behaviour cannot be mocked meaningfully, so integration and concurrency tests run against a real PostgreSQL database (`bookmyseat_test`).
- **Real concurrency.** Concurrency tests open real sockets: `Promise.all` of `fetch` calls against an Express server listening on an ephemeral port. The 50 requests are handled on separate pooled connections (`DB_POOL_MAX=25` in tests).
- **Assert on the database, not only on HTTP.** After each race the tests query the tables directly (`dbInvariants()`, row counts, seat status).
- **Deterministic time.** A `FixedClock` is injected through the composition root, so hold expiry and cancellation cut-offs are tested without sleeping.
- **Fault injection through DI.** A fake `PaymentGateway`, the deterministic failure inputs of `LegacyPaySdk`, and the `wrapUnitOfWork` decorator hook in [`container.ts`](../backend/src/container.ts) simulate gateway outages and DB failures in the middle of a transaction.
- **Never trust the frontend.** The backend tests call the API directly, with invalid, duplicate and unauthorised inputs.

## 2. Tooling

| Layer | Tools |
|---|---|
| Backend runner | Vitest 5 (`backend/vitest.config.ts`): `fileParallelism: false` because the suites share one DB; test env vars set in the config |
| HTTP | Node's built-in `fetch` against `app.listen(0)`; no supertest needed (`tests/helpers/testApp.ts`) |
| Database | PostgreSQL test DB `bookmyseat_test`, rebuilt once per run by `tests/helpers/globalSetup.ts` (`runMigrations({ reset: true })`) and truncated before each test (`resetDatabase()`) |
| Fixtures | `createUsers()` (direct inserts, one shared bcrypt hash at cost 4, signed JWTs); `createShowFixture()` (movie + theatre + SMALL 50-seat screen + show, created through the real services) |
| Frontend unit | Vitest + jsdom + Testing Library (`@testing-library/react`, `user-event`, `jest-dom`); explicit `cleanup` in `tests/unit/setup.ts` |
| E2E | Playwright 1.65 driving the locally installed **Google Chrome** (`channel: 'chrome'`, overridable with `PW_CHANNEL`); `webServer` starts or reuses the backend (4000) and Vite (5173) |

## 3. Test inventory

### Backend: `backend/tests` (9 files, 109 tests)

| File | Tests | Covers |
|---|---|---|
| `unit/domain.test.ts` | 15 | `ShowSeat` state machine (lock/book/release, expired locks, illegal transitions); `Booking` aggregate (confirm, expiry, failure deactivates lines, cancel with/without refund, cut-off); `BookingBuilder` validation; `User` polymorphism via `UserFactory`; `Show.isBookableAt` |
| `unit/pricing.test.ts` | 6 | Category vs flat strategy (LSP); base calculator; decorator stacking order (fee → GST); weekend surcharge only Sat/Sun; `PriceCalculatorFactory` chain |
| `unit/payments.test.ts` | 11 | Adapter: rupees→paise, instrument codes, decline mapping, outage → `GatewayUnavailableError`, refund; strategies: approve, decline resolves (not rejects), per-field validation, expired card, UPI/wallet formats, non-positive amount; substitutability against a fake gateway; factory registry; `PaymentService` delegation |
| `unit/seat-locking.test.ts` | 8 | Pessimistic: `forUpdate: true` + unconditional claim; unavailable and nonexistent seats; Optimistic: no lock + version CAS payload, lost-race error; strategy factory; `SeatLockService.hold` order header → claim → lines; expired-lock reclaim; `assertStillHeld` |
| `unit/services.test.ts` | 13 | `MovieService` with an in-memory repository; `AuthService` with fake hasher/token service; `BookingService` input rules (duplicates rejected before any transaction, max seats, 23505 → `SEAT_UNAVAILABLE` mapping); Observer: type filtering, unsubscribe, failing listener isolation, `NotificationService` per-channel delivery; `SeatLayoutFactory` |
| `unit/validation.test.ts` | 9 | zod schemas (register, hold, payment, show, movie, screen, Idempotency-Key); config validation fails fast; retryable SQLSTATE classification |
| `integration/auth-catalog.test.ts` | 14 | Register/login/me; case-insensitive duplicate e-mail (409); field-level 400s; generic 401; bad tokens; malformed JSON; movie CRUD + admin authorisation + soft delete + `includeInactive` only for admins; 404/400 ids; search; theatre + custom screen layout; duplicate row labels; show scheduling + inventory generation; **overlap 409 via exclusion constraint**; show in the past 422; unknown routes |
| `integration/bookings.test.ts` | 17 | Full hold → pay → CONFIRMED with exact pricing (₹826 for A1 + E1) and seat-map counts; declined card → 402, seats released, notifications; UPI and wallet declines; **gateway outage rollback**; invalid payment details; pay twice (409) and idempotent replay; hold key reuse (422); expired hold (410); expired locks displayed as available; cancel with refund; abandon a pending hold; cut-off window (422); show already started (422); ownership (403 for others, 200 for admin); hold validation matrix (400/404/422/401); admin stats; **DB failure after charge rolls back everything** |
| `concurrency/booking-concurrency.test.ts` | 16 | Six race tests × 2 strategies (same seat ×50, same seat to payment ×50, 40 different seats, overlapping windows, duplicate idempotent holds, concurrent payments); expired-lock reclaim race; concurrent sweepers; DB-level guarantees (partial unique index, CHECK) |

### Frontend: `frontend/tests` (3 unit files, 21 tests; 1 E2E file, 4 tests)

| File | Tests | Covers |
|---|---|---|
| `unit/SeatMap.test.tsx` | 5 | Four seat states distinguishable (class, `data-state`, `aria-label`, `aria-pressed`); locked/booked disabled; click callback; category sections + legend counts; disabled while submitting; server status beats local selection |
| `unit/patterns.test.ts` | 14 | Manual and contiguous-block selection strategies; `pruneUnavailable`; `Observable` replay/unsubscribe; `SeatAvailabilityPoller` interval notifications to multiple observers, request de-duplication, keeps last map on error; `PaymentFormFactory` validation/normalisation; `HttpClient` envelope unwrapping, headers, `ApiError` mapping, 401 handler, network errors; `describeError` |
| `unit/AuthPage.test.tsx` | 2 | Client-side validation blocks the API call; server error message rendered |
| `e2e/booking-journey.spec.ts` | 4 | (1) register → browse → pick 2 seats → hold → card validation → pay → confirmation → history → notification visible → cancel with refund; (2) **two browser contexts pick the same seat: the loser sees the 409 and a refreshed map showing the seat locked**; (3) UPI decline releases seats and offers re-selection; (4) admin dashboard blocked for customers, visible for the admin |

## 4. Running the tests

Prerequisite: PostgreSQL running (`./scripts/db.sh start`). The test DB URL defaults to `postgres://bookmyseat@127.0.0.1:5433/bookmyseat_test` (override with `TEST_DATABASE_URL`).

```bash
npm test                                   # backend (all) + frontend unit
npm --prefix backend test                  # 109 backend tests
npm --prefix backend run test:unit
npm --prefix backend run test:integration
npm --prefix backend run test:concurrency
npm --prefix frontend test                 # 21 frontend unit tests
npm run typecheck                          # tsc for both packages

# E2E: needs the dev database migrated and seeded
npm run db:reset
npm run test:e2e                           # starts/reuses backend :4000 and Vite :5173
PW_CHANNEL=chromium npm run test:e2e       # use Playwright's bundled Chromium instead of Chrome
```

All backend suites need the database; the unit tests do not touch it, but `globalSetup` migrates the test DB once per run.

## 5. Actual results (observed in this development session)

| Suite | Result |
|---|---|
| Backend: `npm --prefix backend test` | **9 files, 109 tests passed** (~3.6 s) |
| Backend concurrency suite | **16/16 passed on 3 consecutive runs** |
| Frontend unit: `npm --prefix frontend test` | **3 files, 21 tests passed** |
| Playwright E2E (Chrome, headless) | **4/4 passed** (~9.3 s) |
| Type checks (`tsc`, both packages) | clean |
| Live demo (`npm run demo:concurrency -- --users 50 --pay`) | 1 × 201, 49 × 409, 70 ms, winner's payment CONFIRMED |

## 6. Defects found by tests and fixed

- **E2E seat-conflict test caught a real UX bug.** When Bob lost the race, the page refreshed the seat map, and the "your selected seats were removed" notice from the selection-pruning effect **overwrote** the server's 409 message. Fix in `SeatSelectionPage`: the prune notice is only shown if no more specific message is already displayed (`setConflict(c => c ?? …)`). A related clean-up moved a state update out of a `setState` updater.
- **Admin E2E** had an ambiguous locator: "Revenue" appears in both a stat tile and a table header.
- **Test-fixture mistakes**, corrected in the tests (the system behaved correctly):
  - the expired-lock race expected 20 conflicts from 20 contenders (should be 19 + 1 winner);
  - the duplicate e-mail test registered the first user with a 1-character name, which itself failed validation;
  - a UPI handle `x@ok` was below the 2-character minimum;
  - test user props lacked `role`.
- **Frontend setup:** Testing Library's auto-cleanup needs Vitest globals, so it was added explicitly to stop DOM leaking between tests.
- **Integration rollback test redesigned:** the first version failed *before* the gateway call and so did not prove rollback *after* a charge. It was replaced by the `wrapUnitOfWork` fault-injection test.

## 7. Requirement → test traceability

| Requirement | Tests |
|---|---|
| Register / log in | auth-catalog › Authentication API (6); AuthService unit; AuthPage unit; E2E journey |
| Browse movies / details | auth-catalog › Movie API; E2E journey |
| Theatres, screens, seat layouts | auth-catalog › theatre/screen tests; SeatLayoutFactory unit |
| Shows for a movie, no overlaps | auth-catalog › `schedules shows, … rejects overlapping shows (409)` |
| Seat layout & real-time availability | bookings › seat-map counts; `expired locks are shown as AVAILABLE`; SeatMap unit; poller unit; E2E conflict |
| Select multiple seats | bookings › two-seat hold; selection strategy units; E2E journey |
| Temporary seat lock + expiry | bookings › expired hold 410; concurrency › reclaim race, sweeper |
| Confirm booking / payment simulation | bookings › hold → pay; payments unit; E2E |
| Payment failure | bookings › declined card / UPI / wallet; E2E decline |
| Booking confirmation & notifications | bookings › notifications asserted; E2E notification visible |
| Booking history | bookings › history; E2E |
| Cancellation + refund + cut-off | bookings › cancel with refund, abandon hold, cut-off 422; domain unit |
| Admin operations & authorisation | auth-catalog › admin vs customer; bookings › admin stats; E2E admin |
| **Concurrency: same seat** | concurrency › ×50 hold, ×50 hold+pay (both strategies) |
| Different seats in parallel | concurrency › 40 different seats |
| Duplicate requests | concurrency › idempotent holds, concurrent payments; bookings › pay replay, key reuse |
| Transaction rollback | bookings › gateway outage, DB failure after charge; concurrency › losers leave no booking rows |
| DB-level protection | concurrency › partial unique index, CHECK constraint |
| Validation & error handling | validation unit; auth-catalog 400/401/404; bookings validation matrix; HttpClient unit |

## 8. Known gaps

- There is no load test beyond 50 concurrent requests per seat (plus 40 concurrent different seats). Throughput and latency under sustained load were not measured.
- E2E tests run against the **seeded development database** and leave their bookings behind; they register fresh users each run, so they are repeatable, but they depend on upcoming shows existing (re-run `npm run db:reset` if the seed shows have passed).
- No coverage threshold or coverage report is configured.
- The poller's 5 s interval means the E2E conflict test has a small theoretical timing window (the loser's selection could be pruned by a poll before it clicks "Hold"). It did not flake in the observed runs.
- The payment gateway is simulated; real-gateway behaviour (timeouts, webhooks) is out of scope. See CONCURRENCY_DESIGN §6.
