# Setup and Execution

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22+ (developed on 22.13.1) | npm comes with it |
| PostgreSQL | 14+ with the `btree_gist` contrib extension | developed on Homebrew PostgreSQL 18; `btree_gist` ships with standard builds |
| Google Chrome | any recent | only for the Playwright E2E tests (or use Playwright's Chromium) |

Repository layout: `backend/` (Express + TypeScript API), `frontend/` (React + Vite), `scripts/db.sh` (local database helper), `docs/`.

## 2. Database

### Option A: isolated local cluster (recommended)

```bash
./scripts/db.sh start     # first run: initdb into ./.pgdata, then start on port 5433
./scripts/db.sh status
./scripts/db.sh stop
```

The script:

- creates a private cluster in `./.pgdata` (git-ignored), owned by the role `bookmyseat` with **trust** authentication;
- starts it on **port 5433** with `max_connections=200`, so it never conflicts with a system PostgreSQL on 5432;
- creates the databases `bookmyseat` (development) and `bookmyseat_test` (automated tests).

It needs `initdb`, `pg_ctl`, `psql` and `createdb` on `PATH` (Homebrew's `postgresql@18` provides them). The defaults in the code match this setup, so no configuration is needed.

### Option B: an existing PostgreSQL server

Create two databases and point the app at them:

```bash
export DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/bookmyseat
export TEST_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/bookmyseat_test
```

The user needs permission to `CREATE EXTENSION btree_gist`, or a superuser can pre-create it. `--reset` drops and recreates the `public` schema.

## 3. Install, migrate, seed

```bash
npm run install:all                     # npm install in backend/ and frontend/
npm --prefix backend run migrate        # apply SQL migrations (idempotent)
npm run db:reset                        # DROP schema → migrate → seed demo data
```

The seed ([`backend/src/db/seed.ts`](../backend/src/db/seed.ts)) is relative to the current date, so there are always upcoming shows:

- 3 users;
- 6 movies;
- 4 theatres in Mumbai, Bengaluru and Delhi, with 7 screens;
- shows for the next 5 days at 10:00, 14:00, 18:30 and 22:00 (126 shows when seeded at ~15:00).

Running `npm run seed` on an already seeded database is a no-op.

Demo accounts:

| Role | E-mail | Password |
|---|---|---|
| Admin | `admin@bookmyseat.dev` | `Admin@123` |
| Customer | `alice@example.com` | `Password1` |
| Customer | `bob@example.com` | `Password1` |

## 4. Run the application

Two terminals:

```bash
npm run dev:backend      # http://localhost:4000/api (tsx watch; runs pending migrations on start)
npm run dev:frontend     # http://localhost:5173 (Vite; proxies /api → :4000)
```

Open <http://localhost:5173>, sign in as Alice, choose a movie and a showtime, select seats, hold them, then pay with card `4111 1111 1111 1111` (any future expiry, any 3-digit CVV). To manage the catalogue, sign in as the admin and open **Admin**.

Health check: `curl http://localhost:4000/api/health`. It reports the active seat-locking strategy.

`npm --prefix backend start` runs the server without watch mode.

## 5. Configuration

The backend reads environment variables through a validated schema ([`backend/src/config/env.ts`](../backend/src/config/env.ts)). An invalid value aborts start-up with a clear message. **There is no dotenv loader**: `backend/.env.example` documents the variables, but you must export them or prefix the command, e.g. `SEAT_LOCK_STRATEGY=OPTIMISTIC npm run dev:backend`.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` (test uses a ~1 ms simulated gateway latency, otherwise 300 ms) |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | `postgres://bookmyseat@127.0.0.1:5433/bookmyseat` | connection string |
| `DB_POOL_MAX` | `20` | pool size |
| `JWT_SECRET` | `dev-only-secret-change-me` | **set in production** |
| `JWT_EXPIRES_IN` | `8h` | token lifetime |
| `BCRYPT_ROUNDS` | `10` | 4–15 |
| `SEAT_LOCK_STRATEGY` | `PESSIMISTIC` | `PESSIMISTIC` (`SELECT … FOR UPDATE`) or `OPTIMISTIC` (version compare-and-set) |
| `SEAT_HOLD_MINUTES` | `5` | seat hold duration |
| `MAX_SEATS_PER_BOOKING` | `10` | |
| `CANCELLATION_CUTOFF_MINUTES` | `120` | confirmed bookings cancellable until this long before the show |
| `PRICING_STRATEGY` | `CATEGORY` | `CATEGORY` (1.0 / 1.5 / 2.2 multipliers) or `FLAT` |
| `CONVENIENCE_FEE_PER_SEAT` | `30` | ₹ per seat |
| `TAX_RATE` | `0.18` | GST |
| `WEEKEND_SURCHARGE_RATE` | `0.10` | Sat/Sun shows |
| `HOLD_EXPIRY_JOB_ENABLED` | `true` | background sweeper |
| `HOLD_EXPIRY_JOB_INTERVAL_MS` | `30000` | sweeper interval |
| `CORS_ORIGIN` | `http://localhost:5173` | comma-separated list |
| `LOG_LEVEL` | `info` | `silent` / `error` / `info` / `debug` (JSON lines) |
| `TEST_DATABASE_URL` | `postgres://bookmyseat@127.0.0.1:5433/bookmyseat_test` | used by the test suites only |

Frontend: `VITE_API_URL` (default `/api`), `VITE_API_PROXY` (dev proxy target, default `http://localhost:4000`).

## 6. Tests

```bash
npm test                                  # backend 109 + frontend unit 21
npm --prefix backend run test:unit
npm --prefix backend run test:integration
npm --prefix backend run test:concurrency # 50-request races, both strategies
npm --prefix frontend test
npm run typecheck
npm run test:e2e                          # Playwright; needs `npm run db:reset` first
PW_CHANNEL=chromium npm run test:e2e      # if Google Chrome is not installed (npx playwright install chromium)
```

See [TESTING.md](TESTING.md) for what each suite covers and the observed results.

## 7. Concurrency demonstration

```bash
npm run db:reset && npm run dev:backend   # terminal 1
npm run demo:concurrency                  # terminal 2: 50 users, same seat
npm run demo:concurrency -- --users 100 --pay
API_URL=http://localhost:4000/api npm run demo:concurrency
```

Expected output: `1 × 201 CREATED`, `N−1 × 409 SEAT_UNAVAILABLE`, `PASS`. Restart the backend with `SEAT_LOCK_STRATEGY=OPTIMISTIC` and re-run to show the second strategy. The exit code is 0 on success, 1 otherwise. Details are in [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md).

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` on 4000 or 5173 | Another instance is running. Stop it, or change the port: `PORT=4100 npm run dev:backend` and `VITE_API_PROXY=http://localhost:4100 npm run dev:frontend`. Find the process with `lsof -iTCP:4000 -sTCP:LISTEN`. |
| `fe_sendauth: no password supplied` on port 5432 | A system PostgreSQL that requires a password is on 5432. Use `./scripts/db.sh start` (port 5433, trust auth), or set `DATABASE_URL` with credentials. |
| `Migration 001_initial_schema.sql failed: … extension "btree_gist" …` | Install the PostgreSQL contrib package, or have a superuser run `CREATE EXTENSION btree_gist;` in both databases. |
| `Invalid configuration: …` at start-up | An env var has an invalid value; the message names it. |
| E2E: `browserType.launch: Chromium distribution 'chrome' is not found` | Install Chrome, or run `npx playwright install chromium` and use `PW_CHANNEL=chromium`. |
| E2E finds no showtimes | The seeded shows have passed. Run `npm run db:reset`. |
| `npm install` in `frontend/` fails with `404 … csstype-3.2.4.tgz` | The registry returned 404 for that tarball during development; `frontend/package.json` pins it with `"overrides": { "csstype": "3.1.3" }`. Keep the override, or remove it once the registry serves the file. |
| Tests fail with connection errors | Start the DB (`./scripts/db.sh start`) and check that `bookmyseat_test` exists (`db.sh` creates it). |
| Seat stays "held" after closing the browser | Expected. The hold expires after `SEAT_HOLD_MINUTES`. It is shown as available as soon as it expires, and the sweeper cleans it up within `HOLD_EXPIRY_JOB_INTERVAL_MS`. |
