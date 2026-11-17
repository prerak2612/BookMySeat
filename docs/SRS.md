# Software Requirements Specification — BookMySeat

Version 1.0 · Movie Ticket Booking System · Capstone project

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements of **BookMySeat**, a web-based movie ticket booking system. It is the reference for design ([ARCHITECTURE.md](ARCHITECTURE.md), [LLD.md](LLD.md)), implementation and testing ([TESTING.md](TESTING.md)). Every requirement below names the code or endpoint that implements it and, where applicable, the automated test that verifies it.

### 1.2 Scope
BookMySeat lets customers register, browse movies, pick a theatre/show, view a live seat map, temporarily lock seats, pay (simulated), receive a confirmation, review their booking history and cancel eligible bookings. Administrators manage the catalogue (movies, theatres, screens, shows) and view revenue and booking metrics.

The **central quality requirement** is concurrency safety: when many users try to book the same seat at the same moment, exactly one succeeds, no duplicate reservation can ever be persisted, and failed attempts leave no partial state.

Out of scope: real payment processing (a deterministic simulated gateway is used), real e-mail/SMS delivery (channels are simulated and persisted), seat-map editing after a screen is created, multi-currency.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Show | One screening of a movie on a screen at a start time (`shows` table) |
| Seat | A physical seat of a screen (`seats`) |
| Show seat | The per-show inventory row of a seat (`show_seats`); this row is locked during booking |
| Hold / seat lock | A temporary reservation of show seats by a `PENDING` booking, valid until `expires_at` |
| Booking | A reservation of one or more show seats for one show by one user |
| Line item | `booking_seats` row linking a booking to a show seat with its price |
| Idempotency key | Client-supplied `Idempotency-Key` header that makes a retried request return the original result instead of executing twice |
| Cut-off | Minimum minutes before show start at which a confirmed booking may still be cancelled |
| Sweeper | `HoldExpiryJob`, the background job that expires abandoned holds |

### 1.4 References
[API_DOCUMENTATION.md](API_DOCUMENTATION.md) · [DATABASE_DESIGN.md](DATABASE_DESIGN.md) · [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md) · [UML_DIAGRAMS.md](UML_DIAGRAMS.md)

---

## 2. Overall description

### 2.1 Product perspective
A three-tier system: React SPA ([frontend/src](../frontend/src)) → REST API on Node.js/Express ([backend/src](../backend/src)) → PostgreSQL. The database is the single source of truth for seat state; the browser is never trusted for availability.

### 2.2 Actors

| Actor | Type | Description | Main goals |
|---|---|---|---|
| **Customer** | Human, primary | A registered user (`role = CUSTOMER`, class [`Customer`](../backend/src/domain/User.ts)) | Browse, select seats, pay, view history, cancel |
| **Guest** | Human | Anonymous visitor | Browse movies, shows and seat maps; must sign in to book |
| **Admin** | Human | `role = ADMIN` (class [`Admin`](../backend/src/domain/User.ts)); provisioned by seed, never self-registered | Manage movies, theatres, screens, shows; view metrics and all bookings |
| **Hold Expiry Job** | System (timer) | [`HoldExpiryJob`](../backend/src/services/HoldExpiryJob.ts), runs every `HOLD_EXPIRY_JOB_INTERVAL_MS` (default 30 s) | Expire abandoned `PENDING` holds, release seats, notify users |
| **Payment Gateway** | External system | Simulated third-party SDK [`LegacyPaySdk`](../backend/src/payments/gateway/LegacyPaySdk.ts) behind [`LegacyPayGatewayAdapter`](../backend/src/payments/gateway/LegacyPayGatewayAdapter.ts) | Approve/decline charges, process refunds |

### 2.3 Operating environment
Node.js 22, PostgreSQL 14+ (developed on 18) with the `btree_gist` extension, any modern browser. Local cluster helper: [scripts/db.sh](../scripts/db.sh).

### 2.4 Assumptions
- A single application clock is used for all lock-expiry comparisons (injected [`Clock`](../backend/src/common/Clock.ts)); multiple API instances must have synchronised clocks (NTP).
- Server local time zone determines "weekend" for the weekend surcharge.

---

## 3. Functional requirements

Priority: **M** = must, **S** = should, **C** = could. All endpoints are prefixed with `/api`.

### 3.1 Authentication

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-01 | A guest can register with name (2–100 chars), e-mail and password (8–72 chars, ≥1 letter, ≥1 digit). | M | `POST /auth/register` → [`AuthService.register`](../backend/src/services/AuthService.ts), schema `RegisterBody` |
| FR-02 | E-mail addresses are unique case-insensitively and stored lower-cased. | M | `ux_users_email_lower` index; `AuthService.register` pre-check → 409 |
| FR-03 | Self-registration always creates a `CUSTOMER`. | M | `AuthService.register` hard-codes `UserRole.CUSTOMER` |
| FR-04 | A user can log in and receives a JWT (HS256, default 8 h). | M | `POST /auth/login` → `AuthService.login`, [`JwtTokenService`](../backend/src/services/AuthService.ts) |
| FR-05 | Login failures return one generic message for unknown e-mail and wrong password. | M | `AuthService.login` → `UnauthorizedError('Invalid email or password')` |
| FR-06 | Authenticated users can fetch their profile; tokens are re-resolved to a live user on every request. | M | `GET /auth/me`, `authenticate` middleware → `AuthService.authenticate` |
| FR-07 | Passwords are stored only as bcrypt hashes and never returned. | M | [`BcryptPasswordHasher`](../backend/src/services/AuthService.ts), `User.toPublic()` |

### 3.2 Movies

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-10 | Anyone can list active movies, filtered by title substring (`q`), genre and language (case-insensitive). | M | `GET /movies` → [`MovieService.list`](../backend/src/services/MovieService.ts) → `PgMovieRepository.search` |
| FR-11 | Anyone can view a movie's details. | M | `GET /movies/:id` |
| FR-12 | Admins can create and partially update movies. | M | `POST /movies`, `PATCH /movies/:id` |
| FR-13 | Admins can deactivate (soft-delete) a movie; history is preserved. Only admins may list inactive movies. | M | `DELETE /movies/:id` → `MovieService.deactivate`; `MovieController.list` forces `includeInactive=false` for non-admins |

### 3.3 Theatres

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-20 | Anyone can list theatres (optionally by city) with their screens and capacities. | M | `GET /theatres?city=` → [`TheatreService.list`](../backend/src/services/TheatreService.ts) |
| FR-21 | Anyone can list distinct cities. | S | `GET /cities` |
| FR-22 | Admins can create a theatre; (name, city) is unique. | M | `POST /theatres`, constraint `ux_theatres_name_city` |
| FR-23 | Anyone can view one theatre with its screens. | S | `GET /theatres/:id` |

### 3.4 Screens and seat layout

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-30 | Admins can add a screen to a theatre using a preset (`SMALL` 5×10, `MEDIUM` 8×12, `LARGE` 10×16) or explicit rows (label 1–3 letters, 1–40 seats, category). | M | `POST /theatres/:id/screens` → `TheatreService.addScreen` → [`SeatLayoutFactory.create`](../backend/src/services/SeatLayoutFactory.ts) |
| FR-31 | Row labels must be unique per screen (case-insensitive); a screen needs ≥1 row. | M | `SeatLayoutFactory.create` → `ValidationError` |
| FR-32 | A screen and all its seats are created atomically. | M | `TheatreService.addScreen` runs inside `uowFactory.transaction` |
| FR-33 | Anyone can view a screen with its seats. | S | `GET /screens/:id` |
| FR-34 | Seats have categories REGULAR, PREMIUM, RECLINER. | M | enum `seat_category`, [`SeatCategory`](../backend/src/domain/enums.ts) |

### 3.5 Shows

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-40 | Admins can schedule a show for an active movie on a screen with a base price; start must be in the future. | M | `POST /shows` → [`ShowService.create`](../backend/src/services/ShowService.ts) |
| FR-41 | The end time is computed by the server as start + runtime + 15 min cleaning buffer. | M | `Movie.occupiedMinutes()` |
| FR-42 | Two scheduled shows on the same screen may never overlap. | M | DB exclusion constraint `ex_shows_no_overlap` → 409 `SHOW_OVERLAP` |
| FR-43 | Creating a show generates one AVAILABLE show seat per physical seat, atomically with the show. | M | `PgShowRepository.createWithInventory` in a transaction |
| FR-44 | Anyone can list upcoming shows of a movie, optionally by date (`YYYY-MM-DD`), city or theatre, including available/total seat counts. | M | `GET /movies/:id/shows` → `ShowService.listForMovie` |
| FR-45 | Anyone can view show details (movie, theatre, screen, counts). | M | `GET /shows/:id` |

### 3.6 Seat availability

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-50 | Anyone can fetch the seat map of a show: rows, seats with category, price and status, a summary count per status and the price per category. | M | `GET /shows/:id/seats` → [`SeatAvailabilityService.getSeatMap`](../backend/src/services/SeatAvailabilityService.ts) |
| FR-51 | A seat whose lock has expired is reported as AVAILABLE even before the sweeper runs. | M | `ShowSeat.effectiveStatus(now)` |
| FR-52 | The UI refreshes availability every 5 s and immediately after a booking conflict. | S | [`SeatAvailabilityPoller`](../frontend/src/patterns/SeatAvailabilityPoller.ts) |
| FR-53 | Seat states AVAILABLE, SELECTED (client-only), LOCKED and BOOKED are visually distinguishable (colour, pattern, `aria-label`). | M | [`SeatMap.tsx`](../frontend/src/components/SeatMap.tsx) |

### 3.7 Temporary seat locking

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-60 | An authenticated user can lock 1–10 distinct seats of a bookable show; this creates a `PENDING` booking with `expires_at = now + 5 min`. | M | `POST /bookings` → [`BookingService.createHold`](../backend/src/services/BookingService.ts) → [`SeatLockService.hold`](../backend/src/services/SeatLockService.ts) |
| FR-61 | If any requested seat is not available the whole request fails with 409 `SEAT_UNAVAILABLE` and nothing is persisted. | M | `AbstractSeatLockingStrategy.reserveCandidates`, transaction rollback |
| FR-62 | Seats that do not belong to the show → 404. | M | `reserveCandidates` → `NotFoundError` |
| FR-63 | A seat whose previous hold expired can be re-claimed immediately; the stale booking becomes `EXPIRED`. | M | `SeatLockService.reclaimExpiredHolds` |
| FR-64 | The locking mechanism is configurable: `PESSIMISTIC` (SELECT … FOR UPDATE) or `OPTIMISTIC` (version compare-and-set). | S | `SEAT_LOCK_STRATEGY`, [`SeatLockingStrategy.ts`](../backend/src/concurrency/SeatLockingStrategy.ts) |
| FR-65 | Repeating a hold request with the same `Idempotency-Key` returns the original booking (200) instead of creating another. | M | advisory lock + `findByUserAndIdempotencyKey` in `createHold` |
| FR-66 | A user can release their own hold. | M | `POST /bookings/:id/cancel` on a `PENDING` booking |

### 3.8 Booking and payment simulation

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-70 | The booking price is computed server-side: per-seat price by category, weekend surcharge, convenience fee, GST; a breakdown is stored with the booking. | M | [`PriceCalculatorFactory`](../backend/src/pricing/pricing.ts) chain |
| FR-71 | The owner can pay a `PENDING`, unexpired booking by CARD, UPI or WALLET. | M | `POST /bookings/:id/payments` → `BookingService.pay` |
| FR-72 | Payment details are validated per method (card: 16 digits, MM/YY not expired, 3-digit CVV, holder; UPI `name@bank`; wallet id 3–40 chars) → 400. | M | `CardPaymentStrategy`/`UpiPaymentStrategy`/`WalletPaymentStrategy.validate` |
| FR-73 | On approval: payment `SUCCESS`, seats `BOOKED`, booking `CONFIRMED`, all in one transaction. | M | `BookingService.pay` |
| FR-74 | On decline: payment `FAILED` recorded, booking `FAILED`, seats released, HTTP 402 `PAYMENT_FAILED` with the booking in `details`. | M | `BookingService.pay` (`payment_failed` outcome) |
| FR-75 | On a gateway outage or any unexpected error the transaction is rolled back; the hold survives and payment can be retried. | M | `GatewayUnavailableError` propagates → `TransactionManager.run` ROLLBACK |
| FR-76 | Paying an expired hold → 410 `HOLD_EXPIRED`; the booking is marked `EXPIRED` and seats released. | M | `BookingService.pay` (`expired` outcome) |
| FR-77 | Paying an already confirmed booking → 409; repeating with the same `Idempotency-Key` returns the original result. | M | `Booking.assertPayable`, `payments.findByBookingAndKey` |
| FR-78 | A booking is charged successfully at most once. | M | partial unique index `ux_payments_one_success_per_booking` |
| FR-79 | After confirmation the user sees a confirmation page with reference `BMS-XXXXXXXX`, seats, price breakdown and transaction ref. | M | [`ConfirmationPage`](../frontend/src/pages/BookingPages.tsx) |

### 3.9 Cancellation

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-80 | The owner (or an admin) can cancel a `CONFIRMED` booking up to 120 min before the show; the payment is refunded (`REFUNDED`) and seats become AVAILABLE. | M | `BookingService.cancel` → `Booking.cancel` → `PaymentService.refund` |
| FR-81 | Inside the cut-off window → 422 `CANCELLATION_WINDOW_CLOSED`; nothing changes. | M | `Booking.cancel` |
| FR-82 | Cancelling a terminal booking (CANCELLED/EXPIRED/FAILED) → 409. | M | `Booking.cancel` |
| FR-83 | Booking views expose a `cancellable` flag so the UI shows the action only when allowed. | S | `BookingService.decorate` |

### 3.10 History and notifications

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-90 | A user can list their bookings (newest first) with show, seats, amount, status and payment status. | M | `GET /bookings` → `BookingService.listForUser` |
| FR-91 | A user can view one of their bookings; other customers get 403; admins can view any. | M | `GET /bookings/:id`, `User.canAccessBookingOf` |
| FR-92 | Confirmation, cancellation, payment failure and hold expiry each produce an e-mail and an SMS notification (simulated, persisted). | M | [`NotificationService`](../backend/src/notifications/NotificationService.ts) observer |
| FR-93 | A user can list their notifications. | S | `GET /notifications` |

### 3.11 Admin

| ID | Requirement | Pri | Implementation |
|---|---|---|---|
| FR-100 | All catalogue write endpoints and `/admin/*` require an admin; customers get 403, anonymous 401. | M | `authenticate` + `requireCatalogManager` middleware |
| FR-101 | Admins see metrics: active movies, theatres, screens, upcoming shows, users, bookings per status, revenue, refunded amount, top 5 movies by revenue. | M | `GET /admin/stats` → [`AdminService`](../backend/src/services/AdminService.ts) → `PgReportingRepository.stats` |
| FR-102 | Admins can list recent bookings of all users, filterable by status. | M | `GET /admin/bookings?status=&limit=` |
| FR-103 | The admin dashboard UI offers tabs: overview, movies, theatres & screens, schedule show, bookings. | M | [`AdminDashboardPage`](../frontend/src/pages/AdminDashboardPage.tsx) |

---

## 4. Non-functional requirements

| ID | Category | Requirement | How it is met | Verified by |
|---|---|---|---|---|
| NFR-01 | Concurrency safety | Under N simultaneous requests for one seat, exactly one hold succeeds, all others get 409, no duplicate active reservation exists. | Row locks (`FOR UPDATE`) or version CAS; partial unique index `ux_booking_seats_one_active_per_show_seat`; `CHECK ck_show_seats_state`; ordered lock acquisition | [booking-concurrency.test.ts](../backend/tests/concurrency/booking-concurrency.test.ts): 50 concurrent users, both strategies; `npm run demo:concurrency` |
| NFR-02 | Concurrency safety | Overlapping multi-seat requests never deadlock into a 5xx. | Global lock order (show_seats by id → bookings by id); retry on `40P01`/`40001` in `TransactionManager` | "overlapping multi-seat requests never deadlock" test |
| NFR-03 | Reliability | A failure at any step of a write leaves no partial state. | One transaction per use case; `TransactionManager.run` rolls back on any throw | "a DB failure AFTER the charge…" and "gateway outage" tests in [bookings.test.ts](../backend/tests/integration/bookings.test.ts) |
| NFR-04 | Reliability | Duplicate client submissions are harmless. | `Idempotency-Key` for holds (advisory lock) and payments (unique `(booking_id, idempotency_key)`) | "duplicate hold requests…" and "concurrent payment submissions…" tests |
| NFR-05 | Reliability | Abandoned holds never block seats permanently. | Lazy re-claim of expired locks + `HoldExpiryJob` + orphan sweep `releaseOrphanedLocks` | "expired hold is re-claimed by exactly one…", "hold-expiry job … safe to run concurrently" |
| NFR-06 | Security | Passwords hashed with bcrypt; JWT auth; role-based authorisation; ownership checks on bookings. | `BcryptPasswordHasher`, `JwtTokenService`, `requireCatalogManager`, `User.canAccessBookingOf` | auth and ownership tests in [auth-catalog.test.ts](../backend/tests/integration/auth-catalog.test.ts), bookings.test.ts |
| NFR-07 | Security | All input validated at the boundary; SQL is parameterised; JSON body ≤ 100 kB; no user-controlled identifiers in SQL. | zod schemas in [schemas.ts](../backend/src/http/validators/schemas.ts); `$n` parameters; fixed column map in `PgMovieRepository.update` | [validation.test.ts](../backend/tests/unit/validation.test.ts) |
| NFR-08 | Security | Errors never leak internals; 5xx responses return a generic message. | Central `errorHandler` | "DB failure" test asserts `INTERNAL_ERROR` |
| NFR-09 | Performance | Seat-map and listing queries are index-backed; a 50-request race completes in well under a second on a laptop. | Indexes in [002_indexes.sql](../backend/src/db/migrations/002_indexes.sql); bulk inserts via `unnest()`; short transactions | Demo output (~70 ms for 50 requests) |
| NFR-10 | Maintainability | Layered architecture, interfaces for all collaborators, single composition root, strict TypeScript. | [container.ts](../backend/src/container.ts); `tsc --strict` passes | `npm run typecheck` |
| NFR-11 | Scalability | The API is stateless; any number of instances can run because all locks live in PostgreSQL. | No in-process locks used for correctness; advisory/row locks are DB-scoped | Design argument, [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md) |
| NFR-12 | Data consistency | Seat status and holder columns can never disagree; referential integrity enforced. | `ck_show_seats_state` CHECK, FKs with RESTRICT/CASCADE as appropriate | "CHECK constraint rejects inconsistent seat states" test |
| NFR-13 | Availability | The UI degrades gracefully on network errors (keeps last seat map, safe payment retry). | `SeatAvailabilityPoller` keeps last map; `CheckoutPage` reuses idempotency key after `NETWORK_ERROR` | [patterns.test.ts](../frontend/tests/unit/patterns.test.ts) |
| NFR-14 | Usability / accessibility | Seat states are distinguishable without colour (pattern + aria-label); forms show field-level errors. | `SeatMap`, `AuthPage`, `CheckoutPage` | [SeatMap.test.tsx](../frontend/tests/unit/SeatMap.test.tsx), [AuthPage.test.tsx](../frontend/tests/unit/AuthPage.test.tsx) |

---

## 5. Use cases

### UC-01 Register / log in
- **Actor:** Guest
- **Preconditions:** none (register); account exists (login).
- **Main flow:** 1. Guest opens `/register`. 2. Enters name, e-mail, password. 3. UI validates locally. 4. `POST /auth/register`. 5. System stores the bcrypt hash, creates a CUSTOMER, returns token + profile. 6. UI stores the token and redirects to the page the user came from.
- **Alternative flows:** A1 invalid input → 400 with field details (UI shows them). A2 e-mail already registered → 409. A3 login with wrong credentials → 401 generic message. A4 token expired later → any 401 triggers automatic sign-out (`HttpClient.setUnauthorizedHandler`).
- **Postconditions:** user is authenticated; `users` row exists (register).

### UC-02 Browse and select a show
- **Actor:** Guest or Customer
- **Main flow:** 1. Open movie list (`GET /movies`), filter by title/genre/language. 2. Open a movie (`GET /movies/:id`). 3. System lists upcoming shows (`GET /movies/:id/shows`) grouped by day, city and theatre, with seats left. 4. User picks a showtime → seat page (`GET /shows/:id/seats`).
- **Alternative flows:** A1 unknown movie → 404 page message. A2 no upcoming shows → informational message. A3 show sold out → showtime rendered disabled.
- **Postconditions:** none (read-only).

### UC-03 Hold seats
- **Actor:** Customer
- **Preconditions:** signed in; show is SCHEDULED and has not started.
- **Main flow:** 1. User selects seats (manual or contiguous-block strategy). 2. Clicks "Hold N seats". 3. UI sends `POST /bookings` with a fresh `Idempotency-Key`. 4. System, in one transaction: locks the requested show-seat rows, verifies availability, re-claims expired locks, prices the seats, creates a PENDING booking, marks seats LOCKED with `lock_expires_at`, inserts line items. 5. Returns 201 with the booking and `holdSecondsRemaining`. 6. UI navigates to checkout with a countdown.
- **Alternative flows:** A1 seat taken concurrently → 409 `SEAT_UNAVAILABLE`; UI refreshes the map and keeps the server message. A2 duplicate seats / empty list → 400. A3 >10 seats → 422 `TOO_MANY_SEATS`. A4 show started → 422 `SHOW_NOT_BOOKABLE`. A5 same `Idempotency-Key` retried → 200 with the original booking. A6 key reused for a different request → 422 `IDEMPOTENCY_KEY_REUSED`. A7 not signed in → redirect to login.
- **Postconditions (success):** booking PENDING; seats LOCKED by it until `expires_at`; exactly one active line per seat.

### UC-04 Pay — success
- **Actor:** Customer, Payment Gateway
- **Preconditions:** booking PENDING, owned by the user, hold not expired.
- **Main flow:** 1. User chooses CARD/UPI/WALLET and enters details. 2. UI validates (UX only) and sends `POST /bookings/:id/payments` with an `Idempotency-Key`. 3. System locks the booking's seats then the booking, re-checks the hold, validates details, charges through the gateway adapter. 4. On approval: inserts payment SUCCESS, seats → BOOKED, booking → CONFIRMED, COMMIT. 5. Publishes `BOOKING_CONFIRMED` → e-mail + SMS notifications. 6. Returns 200; UI shows the confirmation page.
- **Alternative flows:** A1 invalid details → 400, nothing changes. A2 network error on the client → UI keeps the same key; retry cannot double-charge. A3 duplicate submission with the same key → 200 with original result. A4 booking already confirmed (different key) → 409.
- **Postconditions:** booking CONFIRMED with `confirmed_at`; one SUCCESS payment; seats BOOKED.

### UC-05 Pay — failure
- **Actor:** Customer, Payment Gateway
- **Main flow:** steps 1–3 of UC-04; gateway declines (e.g. card ending `0002`, UPI `fail…`, wallet `empty…`). System inserts payment FAILED, booking → FAILED, seats released, COMMIT, publishes `PAYMENT_FAILED`, returns 402 with the booking. UI shows the reason and "Choose seats again".
- **Alternative flow:** A1 gateway outage (card ending `9999`) → exception → ROLLBACK; 500; booking stays PENDING, seats stay LOCKED; the user may retry.
- **Postconditions:** booking FAILED, seats AVAILABLE (decline) — or unchanged (outage).

### UC-06 Hold expiry
- **Actor:** Hold Expiry Job (also triggered lazily by other requests)
- **Preconditions:** a PENDING booking with `expires_at ≤ now`.
- **Main flow:** 1. Job lists expired PENDING ids. 2. For each, in its own transaction: locks the seats and booking, re-checks it is still expired and PENDING, marks it EXPIRED, releases the seats. 3. Publishes `BOOKING_EXPIRED`. 4. Releases orphaned expired locks whose booking is no longer PENDING.
- **Alternative flows:** A1 user paid/cancelled meanwhile → re-check fails, skip. A2 another user requests the seat before the job runs → the seat is re-claimed lazily and the old booking expired in that transaction (UC-03 step 4). A3 the owner tries to pay → 410 `HOLD_EXPIRED`.
- **Postconditions:** booking EXPIRED; seats AVAILABLE (or re-held by the new user).

### UC-07 Cancel booking
- **Actor:** Customer (owner) or Admin
- **Preconditions:** booking PENDING, or CONFIRMED with ≥120 min until show start.
- **Main flow:** 1. User clicks "Cancel booking" in history and confirms. 2. `POST /bookings/:id/cancel`. 3. System locks seats then booking, applies `Booking.cancel`; if refund required, refunds via the payment strategy and marks payment REFUNDED; releases seats; COMMIT; publishes `BOOKING_CANCELLED`. 4. Returns the updated booking.
- **Alternative flows:** A1 inside cut-off → 422 `CANCELLATION_WINDOW_CLOSED`. A2 already terminal → 409. A3 not owner → 403. A4 refund rejected by gateway → 409, rollback.
- **Postconditions:** booking CANCELLED with `cancelled_at`; seats AVAILABLE; payment REFUNDED (if it was confirmed).

### UC-08 Admin schedules a show
- **Actor:** Admin
- **Preconditions:** signed in as admin; movie active; screen has seats.
- **Main flow:** 1. Admin opens "Schedule show", picks movie, screen, start time, base price. 2. `POST /shows`. 3. System validates start in future, computes end time, inserts show and its seat inventory in one transaction. 4. Returns 201.
- **Alternative flows:** A1 overlap with another show on the screen → 409 `SHOW_OVERLAP`. A2 start in the past → 422 `SHOW_IN_PAST`. A3 inactive/unknown movie or unknown screen → 404. A4 non-admin → 403.
- **Postconditions:** a SCHEDULED show with one AVAILABLE `show_seats` row per seat.

Additional admin use cases (create movie / theatre / screen, deactivate movie, view stats, list bookings) follow the same pattern and are covered by FR-12…FR-33 and FR-100…FR-103.

---

## 6. Business rules

| ID | Rule | Value / source |
|---|---|---|
| BR-01 | A seat hold lasts `SEAT_HOLD_MINUTES`. | 5 min ([env.ts](../backend/src/config/env.ts)) |
| BR-02 | At most `MAX_SEATS_PER_BOOKING` seats per booking; seats must be distinct. | 10 |
| BR-03 | Confirmed bookings may be cancelled only if the show starts in ≥ `CANCELLATION_CUTOFF_MINUTES`. | 120 min |
| BR-04 | Seat price = base price × category multiplier (`CATEGORY` strategy). | REGULAR 1.0, PREMIUM 1.5, RECLINER 2.2 ([pricing.ts](../backend/src/pricing/pricing.ts)) |
| BR-05 | Weekend surcharge on the ticket subtotal for Saturday/Sunday shows. | 10 % |
| BR-06 | Convenience fee per seat. | ₹30 |
| BR-07 | GST applied last, on tickets + surcharge + fee. | 18 % |
| BR-08 | Show end time = start + movie runtime + 15 min cleaning buffer. | `Movie.occupiedMinutes(15)` |
| BR-09 | Scheduled shows on the same screen must not overlap. | `ex_shows_no_overlap` |
| BR-10 | Shows can only be scheduled in the future and booked before they start. | `ShowService.create`, `Show.isBookableAt` |
| BR-11 | Self-registration creates CUSTOMER accounts only. | `AuthService.register` |
| BR-12 | An `Idempotency-Key` is 8–100 chars of `[A-Za-z0-9_-]`; it is scoped per user (holds) or per booking (payments); reusing a hold key for a different show/seat count is rejected. | `IdempotencyKeyHeader`, `assertSameHoldRequest` |
| BR-13 | A booking is successfully charged at most once. | `ux_payments_one_success_per_booking` |
| BR-14 | A declined payment ends the booking (FAILED) and frees its seats; the user starts a new hold to retry. | `BookingService.pay` |
| BR-15 | Movies are never hard-deleted (soft delete via `is_active`). | `MovieService.deactivate` |
| BR-16 | Only the owner or an admin may view, pay for or cancel a booking. | `User.canAccessBookingOf` |

---

## 7. Constraints

- **Technology:** TypeScript (strict) on Node.js 22; Express 5; PostgreSQL with `btree_gist`; React 19 + Vite.
- **Database-enforced correctness:** the double-booking guarantee must hold even if application code is wrong (partial unique index, CHECK, exclusion constraint, FKs).
- **Frontend is never the source of truth** for availability or price; it only displays what the API returns.
- **Payment is simulated** deterministically (see test instruments in [API_DOCUMENTATION.md](API_DOCUMENTATION.md)).
- **Clock:** all expiry logic uses the injected application clock, so instances must share synchronised time.
- **Isolation level:** READ COMMITTED with explicit row locks (see [CONCURRENCY_DESIGN.md](CONCURRENCY_DESIGN.md)).

---

## 8. Edge cases

| # | Input / situation | Expected behaviour | Where handled | Test |
|---|---|---|---|---|
| E1 | 50 users hold the same seat simultaneously | 1 × 201, 49 × 409 `SEAT_UNAVAILABLE`, 1 booking row, no orphans | `SeatLockService.hold`, strategies, unique index | concurrency: "50 users racing for the SAME seat" |
| E2 | 50 users race through hold + payment | exactly 1 CONFIRMED booking, 1 SUCCESS payment, seat BOOKED | same + `BookingService.pay` | concurrency: "…all the way to PAYMENT" |
| E3 | 40 users book 40 different seats at once | all 201 | per-row locks don't block each other | concurrency: "DIFFERENT seats" |
| E4 | Overlapping 3-seat windows in opposite orders | no 5xx, no double allocation | ordered `FOR UPDATE`, deadlock retry | concurrency: "overlapping multi-seat requests" |
| E5 | Same hold sent 10× with one `Idempotency-Key` | 1 × 201, 9 × 200, same booking id | advisory lock in `createHold` | concurrency: "duplicate hold requests" |
| E6 | Pay submitted 10× concurrently | 1 × 200, 9 × 409, 1 payment row | booking row lock, `assertPayable` | concurrency: "concurrent payment submissions" |
| E7 | Expired hold, 20 users race for the seat | 1 winner, old booking EXPIRED, old owner's pay → 410 | `reclaimExpiredHolds` | concurrency: "an expired hold is re-claimed…" |
| E8 | Two sweeper runs at once | each hold expired exactly once | `running` flag + per-booking re-check under lock | concurrency: "hold-expiry job…" |
| E9 | Raw SQL inserts a second active line | DB rejects with 23505 | `ux_booking_seats_one_active_per_show_seat` | concurrency: "partial unique index rejects…" |
| E10 | Raw SQL sets BOOKED without booking_id | DB rejects with 23514 | `ck_show_seats_state` | concurrency: "CHECK constraint rejects…" |
| E11 | Duplicate seat ids in one request | 400 | `BookingService.createHold` | integration "validates hold requests…", unit "rejects duplicate seats" |
| E12 | Seat id not in the show / unknown show | 404 | `reserveCandidates`, `createHold` | integration "validates hold requests…" |
| E13 | 11 seats | 422 `TOO_MANY_SEATS` | `createHold` | integration + unit |
| E14 | Hold on a started show | 422 `SHOW_NOT_BOOKABLE` | `Show.isBookableAt` | integration "refuses booking a show that has already started" |
| E15 | Pay at exactly `expires_at` | 410, booking EXPIRED, seat free | `isHoldExpired` uses `<=` | integration "expired hold…" |
| E16 | Declined card / UPI / wallet | 402, FAILED, seats free | `BookingService.pay` | integration "declined payment…", "UPI and wallet declines…" |
| E17 | Gateway outage | 500, full rollback, retry works | `TransactionManager` | integration "gateway outage…" |
| E18 | DB failure after charge | 500, no payment row, seat still LOCKED, booking PENDING | `TransactionManager` | integration "a DB failure AFTER the charge…" |
| E19 | Malformed card details | 400 with 4 problems | `CardPaymentStrategy.validate` | integration "invalid payment details", unit payments |
| E20 | Cancel 1 h 59 min before show | 422 `CANCELLATION_WINDOW_CLOSED` | `Booking.cancel` | integration "refuses cancellation inside the cut-off", unit domain |
| E21 | Cancel twice | second → 409 | `Booking.cancel` | integration "cancels a confirmed booking…" |
| E22 | Another customer accesses a booking | 403 on view/pay/cancel | `User.canAccessBookingOf` | integration "enforces ownership…" |
| E23 | Overlapping show scheduled | 409 `SHOW_OVERLAP` | exclusion constraint + `PG_ERRORS` map | integration "schedules shows… rejects overlapping" |
| E24 | Show in the past | 422 `SHOW_IN_PAST` | `ShowService.create` | integration "rejects shows in the past" |
| E25 | Invalid id (`/movies/abc`) | 400 | `IdParam` schema | integration "returns 404 … and 400 for invalid ids" |
| E26 | Malformed JSON | 400 `MALFORMED_JSON` | `errorHandler` | integration "rejects malformed JSON" |
| E27 | Missing / tampered token | 401 | `authenticate`, `JwtTokenService.verify` | integration "rejects missing and tampered tokens" |
| E28 | Unknown route | 404 `ROUTE_NOT_FOUND` | `notFoundHandler` | integration "returns 404 for unknown routes" |
| E29 | Seat taken while user is still selecting | selection pruned on next poll, message shown | `pruneUnavailable` | frontend unit "pruneUnavailable…" |
| E30 | Two browsers pick the same seat | loser sees conflict, seat shown LOCKED | `SeatSelectionPage` | e2e "seat conflict…" |
| E31 | Network failure | `NETWORK_ERROR` ApiError, safe retry message | `HttpClient` | frontend unit "turns network failures…" |
