# Team Contributions & File Ownership

Team: **Meenaksh Singhania**, **Prerak Arya**, **Samarth Shekhar**

Every file in the repository has **exactly one primary owner**. Ownership means: the owner wrote and can explain the file in the viva, owns its tests, and reviews any change to it. All three members reviewed the integrated application and can walk through the complete booking workflow end to end (see [EVALUATION_GUIDE.md](EVALUATION_GUIDE.md) §5).

Evaluation criteria referenced below: **C1** Requirement Analysis · **C2** Class Diagram · **C3** Object-Oriented Design · **C4** SOLID · **C5** Design Patterns · **C6** Sequence & Activity Diagrams · **C7** API & Interface Design · **C8** Database Schema · **C9** Error Handling, Validation & Edge Cases · **C10** Working Implementation.

## 1. Workload balance

Line counts were measured with `wc -l` on the final repository (generated `package-lock.json` files excluded).

| Member | Area | Source + config files | Source lines | Test files | Test lines | Docs owned |
|---|---|---:|---:|---:|---:|---|
| Meenaksh Singhania | Backend architecture, auth, catalogue, booking lifecycle, REST API, pricing, notifications | 36 | 2,285 | 5 | 687 | README, SRS, ARCHITECTURE, API_DOCUMENTATION, SOLID_PRINCIPLES |
| Prerak Arya | Database, migrations, persistence, seat inventory, locking strategies, transactions, expiry, concurrency testing | 26 | 2,256 | 5 | 779 | DATABASE_DESIGN, CONCURRENCY_DESIGN, TESTING, SETUP_AND_EXECUTION, EVALUATION_GUIDE |
| Samarth Shekhar | Frontend architecture and all pages, frontend patterns, payment module (Strategy/Adapter/Factory), E2E, UML | 34 | 2,788 | 7 | 507 | UML_DIAGRAMS + 12 PlantUML files, DESIGN_PATTERNS, LLD, TEAM_CONTRIBUTIONS |

Why the split is fair:

- **Samarth** has the most source lines. About 300 of them are CSS and DTO type declarations, which are lower in complexity. In return he owns the largest diagram set (12 UML files) and the browser E2E suite.
- **Prerak** owns the hardest code per line: the SQL locking, the optimistic compare-and-set, and lock ordering. He also owns the largest test volume, including the 50-request stress tests.
- **Meenaksh** owns the central orchestration (`BookingService`), the whole HTTP layer and the composition root, plus the most requirement and interface documentation.

---

## 2. MEENAKSH SINGHANIA — Backend Architecture & Booking Management

| File | Functionality implemented | Technical contribution | Criteria |
|---|---|---|---|
| `package.json` | Root convenience scripts (install, db, dev, test, typecheck, demo) | One entry point for the mono-repo | C10 |
| `backend/package.json` | Backend scripts and dependencies | Script design for dev/migrate/seed/test suites | C10 |
| `backend/tsconfig.json` | Strict TypeScript configuration | `strict`, `noImplicitOverride`, unused-code checks | C3, C10 |
| `backend/.env.example` | Documented configuration template | All tunables (lock strategy, hold minutes, cutoff, fees) | C7, C10 |
| `backend/src/config/env.ts` | Typed, validated configuration | Zod-validated env with fail-fast start-up | C9 |
| `backend/src/app.ts` | Express app factory | Side-effect-free app built from the container (testable) | C7, C10 |
| `backend/src/server.ts` | Process entry point | Migrate on boot, start sweeper, graceful shutdown | C10 |
| `backend/src/container.ts` | Composition root | Manual dependency injection; the only place that knows concrete classes; `wrapUnitOfWork` decorator hook | C4 (DIP), C5 |
| `backend/src/common/errors.ts` | Application error hierarchy | Abstract `AppError` with polymorphic `statusCode`/`code`; Seat/Hold/Payment/BusinessRule errors | C3, C9 |
| `backend/src/common/logger.ts` | Structured JSON logger | Level-filtered logging | C10 |
| `backend/src/common/money.ts` | Money rounding | Single rounding rule for all prices | C9 |
| `backend/src/domain/Entity.ts` | Base entity | Identity equality; root of the inheritance tree | C2, C3 |
| `backend/src/domain/enums.ts` | Domain enumerations | Roles, seat categories, seat/booking/payment states | C2, C8 |
| `backend/src/domain/User.ts` | `User` → `Customer`/`Admin`, `UserFactory` | Inheritance + polymorphic authorisation; Factory; encapsulated password hash | C3, C5 |
| `backend/src/domain/Movie.ts` | Movie entity | Invariants, `occupiedMinutes()` for scheduling | C2, C3 |
| `backend/src/domain/Theatre.ts` | Theatre aggregate | Aggregation of screens | C2, C3 |
| `backend/src/domain/Screen.ts` | Screen | Composition of seats, capacity | C2, C3 |
| `backend/src/domain/Seat.ts` | Physical seat | Immutable value-like entity | C2 |
| `backend/src/domain/Show.ts` | Show | Association Movie↔Screen; `isBookableAt`, `minutesUntilStart`, `isWeekend` | C2, C3 |
| `backend/src/domain/Booking.ts` | `Booking` aggregate, `BookingBuilder`, `BookingDraft` | Booking state machine (confirm/fail/expire/cancel with cut-off rule); Builder pattern | C3, C5, C9 |
| `backend/src/domain/events.ts` | Domain event contract | Event types published after commit | C5 |
| `backend/src/services/AuthService.ts` | Register/login/authenticate; `PasswordHasher`, `TokenService` + bcrypt/JWT impls | DIP via small interfaces; no account enumeration | C4, C7, C9 |
| `backend/src/services/MovieService.ts` | Movie catalogue | Depends on `MovieReader`/`MovieWriter` (ISP); soft delete | C4, C10 |
| `backend/src/services/TheatreService.ts` | Theatres and screens | Screen + seats created in one transaction | C10 |
| `backend/src/services/SeatLayoutFactory.ts` | Seat layout generation | Factory for presets and custom row specs, layout rules | C5, C9 |
| `backend/src/services/ShowService.ts` | Show listing/scheduling | End time = runtime + buffer; future-only; overlap mapped to 409 | C9, C10 |
| `backend/src/services/BookingService.ts` | Hold → pay → confirm/fail → cancel; history | Owns transaction boundaries, idempotency, post-commit events, constraint-error mapping | C3, C4, C6, C9, C10 |
| `backend/src/services/AdminService.ts` | Dashboard metrics | Read-only reporting facade | C10 |
| `backend/src/pricing/pricing.ts` | Seat pricing strategies + price decorators + factory | Strategy (Category/Flat), Decorator (weekend, fee, GST), Factory | C4 (OCP), C5 |
| `backend/src/notifications/BookingEventPublisher.ts` | Observer subject | Typed subscriptions, failure isolation | C5 |
| `backend/src/notifications/NotificationService.ts` | Observers: notifications + audit log; e-mail/SMS channels | Concrete observers; channel strategy | C5 |
| `backend/src/http/routes.ts` | REST resource map | Consistent `[auth] → [role] → validation → controller` pipeline | C7 |
| `backend/src/http/controllers/controllers.ts` | Auth/Movie/Theatre/Show/Booking/Admin controllers | Thin controllers (SRP) | C4, C7 |
| `backend/src/http/controllers/presenters.ts` | Entity → DTO mappers | Stable response shapes | C7 |
| `backend/src/http/middleware/index.ts` | Auth, role guard, validation, error handler | Centralised error envelope, SQLSTATE → HTTP mapping | C7, C9 |
| `backend/src/http/validators/schemas.ts` | Zod request schemas | Boundary validation for every endpoint, Idempotency-Key format | C7, C9 |
| `backend/tests/integration/auth-catalog.test.ts` | 14 API tests: auth, movies, theatres, screens, shows | Authorisation, validation, overlap 409, past show 422 | C9, C10 |
| `backend/tests/unit/domain.test.ts` | Domain unit tests | State machines, builder, polymorphism | C3, C9 |
| `backend/tests/unit/services.test.ts` | Service unit tests with in-memory fakes | MovieService, AuthService, BookingService rules, Observer, SeatLayoutFactory | C4, C9 |
| `backend/tests/unit/validation.test.ts` | Schema/config unit tests | Boundary validation and fail-fast config | C9 |
| `backend/tests/unit/pricing.test.ts` | Pricing unit tests | Strategy substitution, decorator stacking, factory | C5 |
| `README.md` | Project overview & quick start | — | C1, C10 |
| `docs/SRS.md` | Requirements specification | FR/NFR/use cases/business rules/edge cases | C1, C9 |
| `docs/ARCHITECTURE.md` | Architecture document | Layering, DI, request lifecycle, extensibility | C3, C4, C7 |
| `docs/API_DOCUMENTATION.md` | Full REST reference | Every endpoint, error code and example | C7, C9 |
| `docs/SOLID_PRINCIPLES.md` | SOLID mapping | Principle → class → code → justification | C4 |

## 3. PRERAK ARYA — Database Architecture & Concurrency Management

| File | Functionality implemented | Technical contribution | Criteria |
|---|---|---|---|
| `.gitignore` | Repository hygiene | Excludes `.pgdata`, builds, reports | C10 |
| `scripts/db.sh` | Isolated local PostgreSQL cluster (port 5433) | Reproducible DB for every team member | C8, C10 |
| `backend/src/db/migrations/001_initial_schema.sql` | Normalised schema | PK/FK/UNIQUE/CHECK; **partial unique index** (one active line per show seat); **exclusion constraint** (no overlapping shows); state CHECK on `show_seats` | C8, C9 |
| `backend/src/db/migrations/002_indexes.sql` | Secondary indexes | Indexes derived from actual query patterns, partial indexes | C8 |
| `backend/src/db/migrate.ts` | Migration runner | Transactional, recorded in `schema_migrations`, advisory-locked, `--reset` | C8, C10 |
| `backend/src/db/seed.ts` | Demo data seeding | Uses the real services, shows relative to "now" | C10 |
| `backend/src/db/Database.ts` | Connection-pool Singleton, `Queryable` | Genuine Singleton use; type parsers for BIGINT/NUMERIC | C5, C8 |
| `backend/src/db/TransactionManager.ts` | BEGIN/COMMIT/ROLLBACK + retry | Isolation level, retry on 40001/40P01 with jitter | C8, C9 |
| `backend/src/common/Clock.ts` | `Clock`, `SystemClock`, `FixedClock` | Time abstraction enabling deterministic expiry tests | C4 (DIP), C9 |
| `backend/src/domain/ShowSeat.ts` | Per-show seat state machine | AVAILABLE→LOCKED→BOOKED, expiry semantics, guarded transitions | C3, C9 |
| `backend/src/repositories/interfaces.ts` | Persistence ports + Unit of Work contract | ISP-split repositories, `LockOptions.forUpdate` | C4, C7 |
| `backend/src/repositories/readModels.ts` | Query-shaped read models | Listing/summary/stat DTOs | C7, C8 |
| `backend/src/repositories/pg/PgUnitOfWork.ts` | UoW factory | All repositories bound to one transaction | C5, C8 |
| `backend/src/repositories/pg/PgUserRepository.ts` | Users persistence | Case-insensitive lookup | C8 |
| `backend/src/repositories/pg/PgMovieRepository.ts` | Movies persistence | Dynamic filtered search, safe partial update | C8 |
| `backend/src/repositories/pg/PgTheatreRepository.ts` | Theatres/screens/seats | Bulk seat insert with `unnest` | C8 |
| `backend/src/repositories/pg/PgShowRepository.ts` | Shows + inventory generation | Availability computed against an injected clock | C8 |
| `backend/src/repositories/pg/PgShowSeatRepository.ts` | Seat inventory | **`SELECT … FOR UPDATE OF ss ORDER BY ss.id`**, version compare-and-set, owner-scoped release, orphan sweep | C8, C9 |
| `backend/src/repositories/pg/PgBookingRepository.ts` | Bookings + lines | Header/lines split, line deactivation, summary read model | C8 |
| `backend/src/repositories/pg/PgSupportRepositories.ts` | Payments, notifications, reporting, advisory locks | `pg_advisory_xact_lock` for idempotency; reporting SQL | C8 |
| `backend/src/concurrency/SeatLockingStrategy.ts` | Pessimistic and optimistic locking strategies | Strategy + Template Method; LSP proven by one shared test suite | C4, C5, C9 |
| `backend/src/services/SeatLockService.ts` | Seat lifecycle inside a transaction | Hold, lazy reclaim of expired locks, confirm, release; global lock ordering | C3, C6, C9 |
| `backend/src/services/HoldExpiryJob.ts` | Background sweeper | Re-checks under lock, non-overlapping runs, orphan-lock release | C9, C10 |
| `backend/src/services/SeatAvailabilityService.ts` | Seat-map read side | Effective status (expired lock shown as available) | C7, C10 |
| `backend/vitest.config.ts` | Test runner configuration | Test DB, sequential files, test env | C10 |
| `backend/tests/helpers/globalSetup.ts` | Test DB schema rebuild | Migrations run once per test run | C10 |
| `backend/tests/helpers/testApp.ts` | Integration harness | Real server on ephemeral port, fixtures, fault-injection option | C10 |
| `backend/tests/concurrency/booking-concurrency.test.ts` | 16 concurrency/stress tests × both strategies | 50 simultaneous requests, overlapping seats, idempotency, double payment, expiry race, DB guards | C8, C9, C10 |
| `backend/tests/integration/bookings.test.ts` | 17 booking transaction tests | Payment success/decline, gateway outage rollback, DB failure rollback, expiry, cut-off, ownership | C9, C10 |
| `backend/tests/unit/seat-locking.test.ts` | Locking unit tests | Strategy behaviour with fake UoW, reclaim, `assertStillHeld` | C5, C9 |
| `backend/scripts/concurrency-demo.ts` | Live concurrency demonstration | N users racing via real HTTP | C10 |
| `docs/DATABASE_DESIGN.md` | Database design document | ERD, constraints, normalisation, indexing | C8 |
| `docs/CONCURRENCY_DESIGN.md` | Concurrency design document | Locking timelines and guarantees → tests | C8, C9 |
| `docs/TESTING.md` | Test strategy & results | Real results and traceability | C9, C10 |
| `docs/SETUP_AND_EXECUTION.md` | Setup guide | DB, migrations, run, test, troubleshoot | C10 |
| `docs/EVALUATION_GUIDE.md` | Evaluation prep | Criteria map, presentation, viva Q&A, demo script | C1–C10 |

## 4. SAMARTH SHEKHAR — Frontend Architecture, Integration & Design Patterns

| File | Functionality implemented | Technical contribution | Criteria |
|---|---|---|---|
| `frontend/package.json` | Frontend scripts/dependencies | Includes `csstype` override for a broken registry tarball | C10 |
| `frontend/tsconfig.json` | Strict TS for React | — | C10 |
| `frontend/vite.config.ts` | Dev server + `/api` proxy + unit test config | Frontend–backend separation on one origin | C7, C10 |
| `frontend/playwright.config.ts` | E2E configuration | Uses installed Chrome; auto-starts/reuses both servers | C10 |
| `frontend/index.html`, `frontend/public/favicon.svg` | App shell and icon | — | C10 |
| `frontend/src/main.tsx` | React bootstrap | StrictMode | C10 |
| `frontend/src/App.tsx` | Route table | Guarded routes (auth/admin) | C7, C10 |
| `frontend/src/api/types.ts` | API DTO types | Typed contract mirroring backend presenters | C7 |
| `frontend/src/api/httpClient.ts` | HTTP gateway + `ApiError` | Envelope unwrapping, network-error mapping, 401 handler | C7, C9 |
| `frontend/src/api/endpoints.ts` | Typed API facade | Idempotency-key generation per user action | C7, C9 |
| `frontend/src/state/AuthContext.tsx` | Global auth state | Context-based state management, token persistence | C10 |
| `frontend/src/state/hooks.ts` | `useObservable`, `useAsync`, `useCountdown` | Observer → React bridge | C5 |
| `frontend/src/patterns/Observable.ts` | Observer subject | Replay-on-subscribe, unsubscribe | C5 |
| `frontend/src/patterns/SeatAvailabilityPoller.ts` | Live seat availability | Polling subject, request de-duplication | C5, C10 |
| `frontend/src/patterns/seatSelectionStrategies.ts` | Manual vs contiguous-block selection | Strategy pattern, prune after refresh | C5 |
| `frontend/src/patterns/paymentForms.ts` | Payment form strategies + factory | Strategy + Factory, client-side validation | C5, C9 |
| `frontend/src/components/common.tsx` | Layout, guards, alerts, badges, poster, price table, countdown | Reusable presentational components | C10 |
| `frontend/src/components/SeatMap.tsx` | Interactive seat layout + legend | 4 visually distinct states (colour + pattern + aria) | C10 |
| `frontend/src/pages/AuthPage.tsx` | Login & registration | UI validation, server error display | C9, C10 |
| `frontend/src/pages/MoviesPage.tsx` | Movie listing with filters | — | C10 |
| `frontend/src/pages/MovieDetailsPage.tsx` | Movie details + theatre/show selection | Day tabs, city filter, availability hints | C10 |
| `frontend/src/pages/SeatSelectionPage.tsx` | Seat selection + hold | 409 handling: refresh + prune; strategy switcher | C9, C10 |
| `frontend/src/pages/CheckoutPage.tsx` | Booking summary + payment simulation | Server-anchored countdown, 402/410/network handling, safe retry | C9, C10 |
| `frontend/src/pages/BookingPages.tsx` | Confirmation ticket, booking history, cancellation, notifications | — | C10 |
| `frontend/src/pages/AdminDashboardPage.tsx` | Admin dashboard | Metrics, movie/theatre/screen/show management, bookings | C10 |
| `frontend/src/styles/styles.css` | Visual design | Responsive layout, seat state styles | C10 |
| `frontend/tests/unit/setup.ts`, `frontend/tests/unit/fixtures.ts` | Test setup and fixtures | — | C10 |
| `frontend/tests/unit/SeatMap.test.tsx` | Seat map component tests | State rendering, disabled seats, legend | C9, C10 |
| `frontend/tests/unit/patterns.test.ts` | Pattern tests | Strategies, Observer/poller, payment forms, HTTP client | C5, C9 |
| `frontend/tests/unit/AuthPage.test.tsx` | Auth UI tests | Validation and error display | C9 |
| `frontend/tests/e2e/booking-journey.spec.ts` | 4 browser E2E tests | Full journey, two-user conflict, payment decline, admin guard | C9, C10 |
| `backend/src/domain/Payment.ts` | Payment entity | Refund transition | C2, C3 |
| `backend/src/payments/PaymentStrategies.ts` | `PaymentProcessor`/`RefundProcessor`, `BasePaymentStrategy`, Card/UPI/Wallet | Strategy + Template Method; ISP | C4, C5, C9 |
| `backend/src/payments/PaymentStrategyFactory.ts` | Strategy registry/factory | OCP via `register()` | C4, C5 |
| `backend/src/payments/PaymentService.ts` | Payment facade | Hides strategies from BookingService | C4, C5 |
| `backend/src/payments/gateway/PaymentGateway.ts` | Gateway port | `GatewayUnavailableError` vs decline distinction | C4, C9 |
| `backend/src/payments/gateway/LegacyPaySdk.ts` | Simulated third-party SDK | Deterministic test instruments | C10 |
| `backend/src/payments/gateway/LegacyPayGatewayAdapter.ts` | Adapter | Callback/paise SDK → promise/rupee port | C5 |
| `backend/tests/unit/payments.test.ts` | Payment unit tests | Adapter mapping, strategies, LSP check against fake gateway | C4, C5 |
| `docs/UML_DIAGRAMS.md` | UML guide | Diagram index, how to render, mapping to code | C2, C6 |
| `docs/uml/use-case.puml` | Use case diagram | — | C1, C6 |
| `docs/uml/class-diagram.puml` | Complete class diagram | — | C2 |
| `docs/uml/seq-01 … seq-09-*.puml` (9 files) | Sequence diagrams | Browsing, show selection, availability, booking, concurrency, conflict, payment success/failure, cancellation | C6 |
| `docs/uml/activity-booking.puml` | Activity diagram | Full booking workflow incl. rollback | C6 |
| `docs/DESIGN_PATTERNS.md` | Design patterns document | Problem → participants → trade-offs | C5 |
| `docs/LLD.md` | Low-level design | Classes, attributes, methods, relationships, state machines | C2, C3 |
| `docs/TEAM_CONTRIBUTIONS.md` | This report | — | — |

Generated files (`backend/package-lock.json`, `frontend/package-lock.json`) belong to the owner of the matching `package.json` (Meenaksh and Samarth respectively).

---

## 5. Suggested Git commits (to be made by each member under their own identity)

The repository currently has **no commits**; nothing in this report claims existing history. Each member should commit **only their own files**, with their own `git config user.name/user.email`, ideally in the order below (dependencies first). The paths are exact.

### Prerak Arya (commit first — schema and persistence are the foundation)

```bash
git add .gitignore scripts/db.sh
git commit -m "chore(db): add isolated local PostgreSQL cluster script and gitignore"

git add backend/src/db/migrations backend/src/db/migrate.ts backend/src/db/Database.ts backend/src/db/TransactionManager.ts
git commit -m "feat(db): normalised schema with partial unique index, exclusion constraint and transactional migration runner"

git add backend/src/common/Clock.ts backend/src/domain/ShowSeat.ts backend/src/repositories
git commit -m "feat(persistence): repository ports, unit of work and PostgreSQL repositories with row-level locking"

git add backend/src/concurrency backend/src/services/SeatLockService.ts backend/src/services/HoldExpiryJob.ts backend/src/services/SeatAvailabilityService.ts
git commit -m "feat(concurrency): pessimistic/optimistic seat locking, lazy reclaim of expired holds and expiry sweeper"

git add backend/vitest.config.ts backend/tests/helpers backend/tests/concurrency backend/tests/unit/seat-locking.test.ts backend/tests/integration/bookings.test.ts
git commit -m "test(concurrency): 50-request stress tests for both strategies, rollback and expiry tests"

git add backend/src/db/seed.ts backend/scripts/concurrency-demo.ts
git commit -m "feat(demo): seed data and live concurrency demo script"

git add docs/DATABASE_DESIGN.md docs/CONCURRENCY_DESIGN.md docs/TESTING.md docs/SETUP_AND_EXECUTION.md docs/EVALUATION_GUIDE.md
git commit -m "docs: database, concurrency, testing, setup and evaluation guides"
```

### Meenaksh Singhania

```bash
git add package.json backend/package.json backend/package-lock.json backend/tsconfig.json backend/.env.example backend/src/config backend/src/common/errors.ts backend/src/common/logger.ts backend/src/common/money.ts
git commit -m "chore(backend): project setup, validated configuration and error hierarchy"

git add backend/src/domain/Entity.ts backend/src/domain/enums.ts backend/src/domain/User.ts backend/src/domain/Movie.ts backend/src/domain/Theatre.ts backend/src/domain/Screen.ts backend/src/domain/Seat.ts backend/src/domain/Show.ts backend/src/domain/Booking.ts backend/src/domain/events.ts
git commit -m "feat(domain): entities, user hierarchy, booking aggregate state machine and BookingBuilder"

git add backend/src/services/AuthService.ts backend/src/services/MovieService.ts backend/src/services/TheatreService.ts backend/src/services/SeatLayoutFactory.ts backend/src/services/ShowService.ts backend/src/services/AdminService.ts
git commit -m "feat(services): authentication, catalogue, screen layouts and show scheduling"

git add backend/src/pricing backend/src/notifications
git commit -m "feat(patterns): pricing strategies with decorators and booking event observers"

git add backend/src/services/BookingService.ts
git commit -m "feat(booking): hold, pay, confirm, cancel with idempotency and post-commit events"

git add backend/src/http backend/src/container.ts backend/src/app.ts backend/src/server.ts
git commit -m "feat(api): REST routes, thin controllers, validation, centralised error handling and DI container"

git add backend/tests/integration/auth-catalog.test.ts backend/tests/unit/domain.test.ts backend/tests/unit/services.test.ts backend/tests/unit/validation.test.ts backend/tests/unit/pricing.test.ts
git commit -m "test(backend): domain, service, validation, pricing and catalogue API tests"

git add README.md docs/SRS.md docs/ARCHITECTURE.md docs/API_DOCUMENTATION.md docs/SOLID_PRINCIPLES.md
git commit -m "docs: README, SRS, architecture, API reference and SOLID mapping"
```

### Samarth Shekhar

```bash
git add backend/src/domain/Payment.ts backend/src/payments backend/tests/unit/payments.test.ts
git commit -m "feat(payments): payment strategies, strategy factory and LegacyPay gateway adapter"

git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/public frontend/src/main.tsx frontend/src/App.tsx frontend/src/api frontend/src/state
git commit -m "feat(frontend): app shell, typed API client, auth state and routing"

git add frontend/src/patterns frontend/src/components frontend/src/styles
git commit -m "feat(frontend): seat map, live availability observer, selection and payment-form strategies"

git add frontend/src/pages
git commit -m "feat(frontend): movie, show, seat selection, checkout, confirmation, history and admin pages"

git add frontend/tests frontend/playwright.config.ts
git commit -m "test(frontend): component, pattern and Playwright end-to-end tests"

git add docs/uml docs/UML_DIAGRAMS.md docs/DESIGN_PATTERNS.md docs/LLD.md docs/TEAM_CONTRIBUTIONS.md
git commit -m "docs: UML diagrams, design patterns, low-level design and contribution report"
```

> If the team prefers pull requests, each member can push the commits above on a personal branch and open a PR into `main`, with the other two members as reviewers. Commit order matters only for a buildable history: Prerak's persistence commits first, then Meenaksh's and Samarth's.
