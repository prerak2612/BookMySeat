# BookMySeat — Movie Ticket Booking System

A full-stack movie ticket booking system built as a **Low-Level Design capstone**. Users browse movies, choose a show, pick seats on a live seat map, hold them temporarily, pay (simulated), receive a confirmation and manage or cancel bookings. Admins manage the catalogue and see dashboard metrics.

The central requirement is **concurrency safety**. When many users try to book the same seat at the same moment, exactly one succeeds. This is enforced by the backend and the database, never by the browser.

```
50 simultaneous POST /bookings for seat A1  (npm run demo:concurrency)
┌───────────────────────────────┬───────┐
│ 201 CREATED (hold acquired)   │ 1     │
│ 409 SEAT_UNAVAILABLE          │ 49    │
└───────────────────────────────┴───────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22, TypeScript (strict), Express 5, Zod, JSON Web Tokens, bcrypt |
| Database | PostgreSQL (tested on 18) via `node-postgres`; plain SQL migrations; `btree_gist` |
| Frontend | React 19, React Router 7, Vite 8, TypeScript |
| Testing | Vitest (unit / integration / concurrency on a real PostgreSQL), Testing Library + jsdom, Playwright (real Chrome) |

## Architecture at a glance

```
 React SPA ──/api──▶ routes → middleware (auth · role · Zod validation)
 (Vite proxy)             │
                          ▼
                     Controllers (thin)  ──▶ Presenters (DTOs)
                          │
                          ▼
                     Services ── BookingService (transaction boundaries)
                          │        ├─ SeatLockService ─▶ SeatLockingStrategy (Pessimistic | Optimistic)
                          │        ├─ PaymentService ─▶ Card/UPI/Wallet strategy ─▶ LegacyPayGatewayAdapter
                          │        ├─ PriceCalculator (Strategy + Decorators)
                          │        └─ BookingEventPublisher ─▶ NotificationService, AuditLogListener
                          ▼
                     UnitOfWork (repository interfaces) ─▶ Pg* repositories ─▶ PostgreSQL
```

Concurrency defence in depth (details in [CONCURRENCY_DESIGN.md](docs/CONCURRENCY_DESIGN.md)):

- **Row locks:** `SELECT … FOR UPDATE` in a global lock order, or an optimistic version compare-and-set (selected by configuration).
- **Database guards:** a partial unique index that allows one active reservation per show seat, and CHECK constraints on seat state.
- **Transactions and retries:** every write runs in a transaction with rollback, and transactions aborted by a deadlock or serialization failure are retried.
- **Idempotency keys** on both seat holds and payments.
- **Hold expiry:** expired holds are reclaimed lazily by the next booker, and a background sweeper cleans up the rest.

## Quick start

Prerequisites: Node.js ≥ 22 and PostgreSQL ≥ 14 with `btree_gist` (bundled with standard PostgreSQL builds).

```bash
./scripts/db.sh start        # isolated PostgreSQL cluster in ./.pgdata on port 5433
npm run install:all          # installs backend + frontend dependencies
npm run db:reset             # migrate + seed demo data
npm run dev:backend          # http://localhost:4000/api
npm run dev:frontend         # http://localhost:5173
```

Demo accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookmyseat.dev` | `Admin@123` |
| Customer | `alice@example.com` | `Password1` |
| Customer | `bob@example.com` | `Password1` |

Simulated payments: card `4111 1111 1111 1111` succeeds, `4000 0000 0000 0002` is declined, and `4000 0000 0000 9999` simulates a gateway outage. A UPI ID starting with `fail` is declined.

To use an existing PostgreSQL server instead of the script, set `DATABASE_URL` and `TEST_DATABASE_URL`. See [SETUP_AND_EXECUTION.md](docs/SETUP_AND_EXECUTION.md).

## Tests

```bash
npm test                     # backend (unit + integration + concurrency) and frontend unit tests
npm --prefix backend run test:concurrency
npm run test:e2e             # Playwright, real browser against real backend + DB (needs seeded DB)
npm run demo:concurrency -- --users 50 --pay   # live demo against a running server
```

Last verified results: backend **109/109** passing (9 files, including **16 concurrency tests** with 50 simultaneous requests, run against both locking strategies), frontend **21/21**, and Playwright E2E **4/4**. See [TESTING.md](docs/TESTING.md).

## Repository layout

```
backend/
  src/
    domain/          entities + state machines (Booking, ShowSeat, User hierarchy, BookingBuilder)
    services/        BookingService, SeatLockService, HoldExpiryJob, Auth/Movie/Theatre/Show services
    concurrency/     SeatLockingStrategy (pessimistic / optimistic)
    repositories/    ports (interfaces.ts) + pg/ implementations + Unit of Work
    payments/        payment strategies, factory, gateway port + LegacyPay adapter
    pricing/         seat pricing strategies + price decorators
    notifications/   Observer: event publisher + listeners
    http/            routes, controllers, middleware, Zod schemas
    db/              Database singleton, TransactionManager, migrations, seed
    container.ts     composition root (dependency injection)
  tests/             unit/ integration/ concurrency/
  scripts/           concurrency-demo.ts
frontend/
  src/               api/ state/ patterns/ components/ pages/ styles/
  tests/             unit/ e2e/
docs/                design documentation + uml/*.puml
scripts/db.sh        local PostgreSQL helper
```

## Documentation

| Document | Contents |
|---|---|
| [SRS.md](docs/SRS.md) | Requirements, actors, use cases, business rules, edge cases |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, modules, dependency injection, request lifecycle |
| [LLD.md](docs/LLD.md) | Classes, attributes, methods, relationships, state machines |
| [UML_DIAGRAMS.md](docs/UML_DIAGRAMS.md) | Use case, class, 9 sequence diagrams, activity diagram |
| [DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | ER model, constraints, normalisation, indexes |
| [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Every endpoint with examples and error codes |
| [CONCURRENCY_DESIGN.md](docs/CONCURRENCY_DESIGN.md) | Locking mechanisms, timelines, guarantees and proofs |
| [SOLID_PRINCIPLES.md](docs/SOLID_PRINCIPLES.md) | Principle → class → code mapping |
| [DESIGN_PATTERNS.md](docs/DESIGN_PATTERNS.md) | Patterns, participants, trade-offs |
| [TESTING.md](docs/TESTING.md) | Strategy, suites, actual results |
| [SETUP_AND_EXECUTION.md](docs/SETUP_AND_EXECUTION.md) | Installation, configuration, troubleshooting |
| [TEAM_CONTRIBUTIONS.md](docs/TEAM_CONTRIBUTIONS.md) | File-wise ownership and suggested commits |
| [EVALUATION_GUIDE.md](docs/EVALUATION_GUIDE.md) | Criteria map, presentation plan, demo script, viva Q&A |

## Team

Meenaksh Singhania (backend architecture & booking management) · Prerak Arya (database & concurrency) · Samarth Shekhar (frontend, integration & design patterns)
