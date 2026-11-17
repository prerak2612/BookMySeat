# REST API Documentation

- **Base URL:** `http://localhost:4000/api`. Through the frontend dev server the same API is available at `http://localhost:5173/api` via the Vite proxy.
- **Content type:** `application/json`, with a 100 kB body limit.
- **Route table (source of truth):** [`backend/src/http/routes.ts`](../backend/src/http/routes.ts)
- **Validation:** zod schemas in [`backend/src/http/validators/schemas.ts`](../backend/src/http/validators/schemas.ts)

Every route follows the same pipeline: `[authenticate] → [role check] → validate(params/query/body) → controller → service`. Errors from any stage go to one centralised handler (`errorHandler` in [`middleware/index.ts`](../backend/src/http/middleware/index.ts)).

---

## 1. Conventions

### 1.1 Response envelope

Success:

```json
{ "success": true, "data": { "...": "..." } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "SEAT_UNAVAILABLE",
    "message": "One or more selected seats are no longer available",
    "details": { "seatIds": [449] }
  }
}
```

`details` is optional. For `VALIDATION_ERROR` it is an array of `{ "path": "email", "message": "Invalid email address" }`.

### 1.2 Authentication

- `POST /auth/login` or `POST /auth/register` returns a **JWT** (HS256, signed with `JWT_SECRET`, default lifetime `8h` from `JWT_EXPIRES_IN`). Claims: `sub` = user id, `role`.
- Send it as `Authorization: Bearer <token>`.
- On every request the token is resolved to a live user (`AuthService.authenticate`), so a deleted user is rejected immediately.
- Roles: `CUSTOMER` (self-registration) and `ADMIN` (seeded). "Admin" routes are guarded by `requireCatalogManager`, which calls the polymorphic `user.canManageCatalog()`.

### 1.3 Idempotency

`POST /bookings` and `POST /bookings/:id/payments` accept an optional header:

```
Idempotency-Key: hold-3f9c1e0a7b2d4c55
```

Rules: 8–100 characters from `[A-Za-z0-9_-]`, otherwise `400 VALIDATION_ERROR`.

- **Hold:** keys are scoped per user. A repeat of the same key returns the original booking with **200** instead of 201. If the key is reused with a different show or seat count, the response is `422 IDEMPOTENCY_KEY_REUSED`.
- **Payment:** keys are scoped per booking. A repeat returns the original outcome: the confirmed booking (200), or `402 PAYMENT_FAILED` if the original payment was declined. The card is never charged twice.

The frontend generates a key per user action and reuses it after network errors.

### 1.4 Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod schema failure, duplicate seat ids in request, invalid payment details (`details` lists problems) |
| 400 | `MALFORMED_JSON` | body is not valid JSON |
| 400 | `INVALID_INPUT` | PostgreSQL 22P02 (malformed value) |
| 400 | `CONSTRAINT_VIOLATION` | PostgreSQL CHECK violation (23514) reaching the edge |
| 401 | `UNAUTHORIZED` | missing, invalid or expired token; wrong credentials ("Invalid email or password") |
| 402 | `PAYMENT_FAILED` | gateway declined the payment; `details.booking` holds the now-`FAILED` booking |
| 403 | `FORBIDDEN` | customer calling an admin route, or accessing another user's booking |
| 404 | `NOT_FOUND` | unknown movie, show, theatre, screen, booking, or seat id not in the show |
| 404 | `ROUTE_NOT_FOUND` | no such route |
| 409 | `CONFLICT` | invalid state transition (already paid, already cancelled), duplicate e-mail, refund rejected |
| 409 | `SEAT_UNAVAILABLE` | one or more seats are locked or booked by someone else (`details.seatIds`) |
| 409 | `DUPLICATE` | other unique-constraint violation (23505) |
| 409 | `SHOW_OVERLAP` | exclusion constraint: overlapping show on the same screen (23P01) |
| 409 | `REFERENCE_CONFLICT` | foreign-key violation (23503) |
| 409 | `CONCURRENT_UPDATE` | deadlock or serialization failure still failing after 3 automatic retries |
| 410 | `HOLD_EXPIRED` | seat hold expired, or its seats were reclaimed, before payment |
| 422 | `TOO_MANY_SEATS` | more than `MAX_SEATS_PER_BOOKING` (default 10) seats |
| 422 | `SHOW_NOT_BOOKABLE` | show cancelled or already started |
| 422 | `SHOW_IN_PAST` | admin scheduling a show in the past |
| 422 | `SCREEN_HAS_NO_SEATS` | admin scheduling on an empty screen |
| 422 | `CANCELLATION_WINDOW_CLOSED` | cancelling less than `CANCELLATION_CUTOFF_MINUTES` (default 120) before the show |
| 422 | `IDEMPOTENCY_KEY_REUSED` | hold key reused for a different request |
| 500 | `INTERNAL_ERROR` | unexpected failure, e.g. payment gateway outage. The transaction is rolled back and nothing is persisted. |

### 1.5 Payment simulation

Payments go through `CardPaymentStrategy` / `UpiPaymentStrategy` / `WalletPaymentStrategy` → `LegacyPayGatewayAdapter` → simulated `LegacyPaySdk`:

| Method | `details` | Outcome |
|---|---|---|
| CARD | `cardNumber` 16 digits (spaces allowed), `expiry` MM/YY (not expired), `cvv` 3 digits, `cardHolder` ≥ 2 chars | `4111111111111111` → approved |
| CARD | `4000000000000002` | declined → **402 PAYMENT_FAILED**, booking `FAILED`, seats released |
| CARD | `4000000000009999` | gateway unavailable → **500 INTERNAL_ERROR**, full ROLLBACK: hold still `PENDING` and seats still `LOCKED`, so a retry is possible |
| UPI | `upiId` like `name@bank` | approved; a handle starting with `fail` → 402 |
| WALLET | `walletId` 3–40 chars `[A-Za-z0-9_-]` | approved; an id starting with `empty` → 402 (insufficient balance) |

### 1.6 Pricing

For each seat, the ticket price is `base_price × category multiplier` (REGULAR 1.0, PREMIUM 1.5, RECLINER 2.2) when `PRICING_STRATEGY=CATEGORY`. With `FLAT`, every seat costs `base_price`. The total then adds, in this order:

1. a weekend surcharge (10% of tickets, Saturday/Sunday shows only),
2. a convenience fee of ₹30 per seat,
3. 18% GST on everything above.

All prices are computed by the server. Client-side estimates are informational only.

---

## 2. Endpoints

### 2.1 Health

#### `GET /health`

Public. Checks the database connection.

```bash
curl http://localhost:4000/api/health
```

```json
{ "success": true, "data": { "status": "ok", "seatLockStrategy": "PESSIMISTIC", "time": "2026-11-17T09:39:09.112Z" } }
```

### 2.2 Authentication

#### `POST /auth/register`

Public. Creates a `CUSTOMER`.

| Field | Rule |
|---|---|
| name | string, trimmed, 2–100 |
| email | valid e-mail, trimmed and lower-cased |
| password | 8–72 chars, at least one letter and one digit |

```bash
curl -X POST http://localhost:4000/api/auth/register -H 'content-type: application/json' \
  -d '{"name":"Riya Patel","email":"riya@example.com","password":"Secret123"}'
```

**201**

```json
{ "success": true, "data": {
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 4, "name": "Riya Patel", "email": "riya@example.com", "role": "CUSTOMER", "createdAt": "2026-11-17T09:40:00.000Z" } } }
```

Errors: `400 VALIDATION_ERROR`, `409 CONFLICT` (e-mail already registered, case-insensitive).

#### `POST /auth/login`

Public. Body: `email` (valid e-mail), `password` (non-empty).

```bash
curl -X POST http://localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"Password1"}'
```

**200**: same shape as register. Errors: `400`, `401 UNAUTHORIZED` (one generic message for unknown e-mail and wrong password).

#### `GET /auth/me`

Bearer token required. **200**: `{ id, name, email, role, createdAt }`. Errors: `401`.

### 2.3 Movies

#### `GET /movies`

Public; the token is optional. Query parameters (all optional):

| Param | Rule |
|---|---|
| `q` | ≤ 100 chars; case-insensitive title substring |
| `genre` | ≤ 50; case-insensitive exact |
| `language` | ≤ 50; case-insensitive exact |
| `includeInactive` | `true` / `false`. Only honoured for admins; ignored for anyone else |

```bash
curl 'http://localhost:4000/api/movies?genre=drama'
```

**200**

```json
{ "success": true, "data": [ {
  "id": 1, "title": "The Last Monsoon",
  "description": "A fisherman and his estranged daughter race to save their coastal village before the season's final storm.",
  "durationMinutes": 148, "language": "Hindi", "genre": "Drama", "certificate": "UA",
  "releaseDate": "2026-11-14", "posterUrl": null, "isActive": true } ] }
```

#### `GET /movies/:id`

Public. `:id` must be a positive integer (`400` otherwise). **200**: one movie object. **404** `NOT_FOUND`.

#### `GET /movies/:id/shows`

Public. Lists upcoming `SCHEDULED` shows that start after now.

| Query | Rule |
|---|---|
| `date` | `YYYY-MM-DD`; restricts to that calendar day (server-local time) |
| `city` | ≤ 100; case-insensitive |
| `theatreId` | positive integer |

```bash
curl 'http://localhost:4000/api/movies/1/shows?city=Bengaluru'
```

**200** (`ShowListing[]`; `availableSeats` counts expired locks as available):

```json
{ "success": true, "data": [ {
  "id": 9, "movieId": 1,
  "startTime": "2026-11-17T13:00:00.000Z", "endTime": "2026-11-17T15:43:00.000Z",
  "basePrice": 260, "status": "SCHEDULED",
  "screenId": 5, "screenName": "Silver", "theatreId": 3, "theatreName": "Garden City Screens", "city": "Bengaluru",
  "availableSeats": 50, "totalSeats": 50 } ] }
```

Errors: `400`, `404` (unknown movie).

#### `POST /movies` (admin)

| Field | Rule |
|---|---|
| title | 1–200 |
| description | ≤ 5000, default `""` |
| durationMinutes | integer 1–600 |
| language, genre | 1–50 |
| certificate | `U` / `UA` / `A` / `S`, default `UA` |
| releaseDate | `YYYY-MM-DD` |
| posterUrl | URL or `null` (default `null`) |
| isActive | boolean, optional (default true) |

```bash
curl -X POST http://localhost:4000/api/movies -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"title":"Inception","durationMinutes":148,"language":"English","genre":"Sci-Fi","releaseDate":"2010-07-16"}'
```

**201**: the movie. Errors: `400`, `401`, `403`.

#### `PATCH /movies/:id` (admin)

Partial update; any subset of the `POST` fields, at least one required. **200**: the updated movie. Errors: `400`, `401`, `403`, `404`.

#### `DELETE /movies/:id` (admin)

**Soft delete**: sets `isActive=false`, so history is preserved. **200**: the movie with `isActive: false`. Re-activate with `PATCH {"isActive": true}`.

### 2.4 Theatres and screens

#### `GET /cities`

Public. **200**: `["Bengaluru", "Delhi", "Mumbai"]`

#### `GET /theatres`

Public. Query: `city` (optional, case-insensitive).

**200**

```json
{ "success": true, "data": [ {
  "id": 3, "name": "Garden City Screens", "city": "Bengaluru", "address": "MG Road",
  "screens": [ { "id": 4, "theatreId": 3, "name": "Gold", "capacity": 96 },
               { "id": 5, "theatreId": 3, "name": "Silver", "capacity": 50 } ] } ] }
```

#### `GET /theatres/:id`

Public. **200**: one theatre (same shape). **404**.

#### `POST /theatres` (admin)

Body: `name` (2–150), `city` (2–100), `address` (2–300). **201**: the theatre with `screens: []`. Errors: `400`, `401`, `403`, `409 DUPLICATE` (same name in the same city).

#### `POST /theatres/:id/screens` (admin)

Creates a screen and all its seats in one transaction (`SeatLayoutFactory`). Body:

```json
{ "name": "IMAX", "layout": { "preset": "LARGE" } }
```

or an explicit layout:

```json
{ "name": "IMAX", "layout": { "rows": [
  { "label": "A", "seats": 12, "category": "REGULAR" },
  { "label": "B", "seats": 10, "category": "RECLINER" } ] } }
```

Validation:

- `name`: 1–50.
- Presets:

  | Preset | Layout | Seats |
  |---|---|---|
  | `SMALL` | rows A–E × 10; D = PREMIUM, E = RECLINER | 50 |
  | `MEDIUM` | rows A–H × 12; F–G = PREMIUM, H = RECLINER | 96 |
  | `LARGE` | rows A–J × 16; G–I = PREMIUM, J = RECLINER | 160 |

- Explicit rows: 1–30 rows, each `label` 1–3 letters (upper-cased; must be unique), `seats` 1–40, `category` REGULAR/PREMIUM/RECLINER.

**201**

```json
{ "success": true, "data": { "id": 8, "theatreId": 5, "name": "IMAX", "capacity": 9,
  "seats": [ { "id": 401, "row": "A", "number": 1, "label": "A1", "category": "REGULAR" } ] } }
```

Errors: `400` (incl. duplicate row labels), `401`, `403`, `404` (theatre), `409 DUPLICATE` (screen name exists in theatre).

#### `GET /screens/:id`

Public. **200**: screen with `seats[]` (same shape as above). **404**.

### 2.5 Shows and seat availability

#### `GET /shows/:id`

Public. **200** (`ShowDetails` = `ShowListing` plus movie and theatre fields):

```json
{ "success": true, "data": {
  "id": 9, "movieId": 1, "startTime": "2026-11-17T13:00:00.000Z", "endTime": "2026-11-17T15:43:00.000Z",
  "basePrice": 260, "status": "SCHEDULED", "screenId": 5, "screenName": "Silver",
  "theatreId": 3, "theatreName": "Garden City Screens", "city": "Bengaluru",
  "availableSeats": 48, "totalSeats": 50,
  "movieTitle": "The Last Monsoon", "movieLanguage": "Hindi", "movieCertificate": "UA",
  "durationMinutes": 148, "theatreAddress": "MG Road" } }
```

#### `GET /shows/:id/seats`

Public. Real-time seat map. `status` is the **effective** status: a lock whose `lock_expires_at` has passed is reported as `AVAILABLE` even before the sweeper runs. This view is informational. The booking endpoint re-validates every seat under lock.

```json
{ "success": true, "data": {
  "show": { "...": "ShowDetails as above" },
  "rows": [ { "row": "A", "seats": [
      { "seatId": 449, "showSeatId": 401, "row": "A", "number": 1, "label": "A1", "category": "REGULAR", "status": "LOCKED", "price": 260 },
      { "seatId": 450, "showSeatId": 402, "row": "A", "number": 2, "label": "A2", "category": "REGULAR", "status": "AVAILABLE", "price": 260 } ] } ],
  "summary": { "AVAILABLE": 48, "LOCKED": 2, "BOOKED": 0 },
  "categoryPrices": { "REGULAR": 260, "PREMIUM": 390, "RECLINER": 572 },
  "serverTime": "2026-11-17T09:39:10.000Z" } }
```

Errors: `400`, `404`.

#### `POST /shows` (admin)

| Field | Rule |
|---|---|
| movieId | positive integer, an **active** movie |
| screenId | positive integer, screen with ≥ 1 seat |
| startTime | ISO-8601 with offset, e.g. `2026-12-01T18:30:00+05:30`; must be in the future |
| basePrice | number > 0 and ≤ 10000 |

`endTime` is computed: start + runtime + 15 min cleaning buffer. One `AVAILABLE` `show_seats` row is generated per seat in the same transaction.

```bash
curl -X POST http://localhost:4000/api/shows -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"movieId":1,"screenId":5,"startTime":"2026-12-01T18:30:00+05:30","basePrice":250}'
```

**201**

```json
{ "success": true, "data": { "id": 127, "movieId": 1, "screenId": 5,
  "startTime": "2026-12-01T13:00:00.000Z", "endTime": "2026-12-01T15:43:00.000Z", "basePrice": 250, "status": "SCHEDULED" } }
```

Errors: `400`, `401`, `403`, `404` (movie inactive or unknown, screen unknown), `409 SHOW_OVERLAP`, `422 SHOW_IN_PAST` / `SCREEN_HAS_NO_SEATS`.

### 2.6 Bookings: lock → pay → confirm → cancel

All booking endpoints require a Bearer token. The response object is a **BookingView**:

```json
{
  "id": 12, "reference": "BMS-RHGYQLS3", "userId": 2, "userEmail": "alice@example.com",
  "status": "PENDING", "totalAmount": 684.4, "subtotal": 520,
  "priceBreakdown": [ { "label": "Tickets (2)", "amount": 520 },
                      { "label": "Convenience fee", "amount": 60 },
                      { "label": "GST (18%)", "amount": 104.4 } ],
  "expiresAt": "2026-11-17T09:44:10.000Z", "confirmedAt": null, "cancelledAt": null,
  "createdAt": "2026-11-17T09:39:10.000Z",
  "showId": 9, "showStartTime": "2026-11-17T13:00:00.000Z",
  "movieId": 1, "movieTitle": "The Last Monsoon", "theatreName": "Garden City Screens", "city": "Bengaluru", "screenName": "Silver",
  "seats": [ { "showSeatId": 401, "label": "A1", "category": "REGULAR", "price": 260 },
             { "showSeatId": 402, "label": "A2", "category": "REGULAR", "price": 260 } ],
  "paymentStatus": null, "paymentMethod": null, "transactionRef": null,
  "cancellable": true, "holdSecondsRemaining": 299
}
```

`cancellable` and `holdSecondsRemaining` are computed by the server from its clock, so clients do not depend on their own clock.

#### `POST /bookings`: lock seats (create a PENDING hold)

Body:

| Field | Rule |
|---|---|
| showId | positive integer |
| seatIds | array of **physical seat ids** (`seatId` from the seat map), 1–50 entries, positive integers, no duplicates; at most `MAX_SEATS_PER_BOOKING` (10) |

Optional header: `Idempotency-Key`.

Inside one transaction:

1. Row-lock (or version-check) the seats.
2. Reclaim expired holds.
3. Price the seats.
4. Insert the booking.
5. Set the seats to `LOCKED` with `lock_expires_at = now + SEAT_HOLD_MINUTES` (default 5).

```bash
curl -X POST http://localhost:4000/api/bookings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'Idempotency-Key: hold-0001-abcdef' -d '{"showId":9,"seatIds":[449,450]}'
```

| Status | Meaning |
|---|---|
| 201 | hold created (BookingView, `status: PENDING`) |
| 200 | idempotent replay of the same key (same BookingView) |
| 400 | validation, duplicate seat ids |
| 401 | no token |
| 404 | unknown show, or a seat id that does not belong to the show |
| 409 `SEAT_UNAVAILABLE` | lost the race / seat already locked or booked (`details.seatIds`) |
| 422 | `TOO_MANY_SEATS`, `SHOW_NOT_BOOKABLE`, `IDEMPOTENCY_KEY_REUSED` |

#### `POST /bookings/:id/payments`: pay and confirm

Body:

| Field | Rule |
|---|---|
| method | `CARD` / `UPI` / `WALLET` |
| details | object of string → string (≤ 100 chars each); validated per method by the payment strategy (see §1.5) |

Optional header: `Idempotency-Key`.

```bash
curl -X POST http://localhost:4000/api/bookings/12/payments -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'Idempotency-Key: pay-0001-abcdef' \
  -d '{"method":"CARD","details":{"cardNumber":"4111111111111111","expiry":"12/30","cvv":"123","cardHolder":"Alice Sharma"}}'
```

**200**: BookingView with `status: "CONFIRMED"`, `paymentStatus: "SUCCESS"`, `paymentMethod: "CARD"`, `transactionRef: "LPMWKI36DC0001"`, `confirmedAt` set, seats now `BOOKED`. Notifications (EMAIL + SMS) are created after commit.

| Status | Meaning |
|---|---|
| 200 | confirmed (or idempotent replay of a successful payment) |
| 400 | invalid body or invalid payment details (e.g. `["cardNumber must be 16 digits", ...]`); nothing changes |
| 402 `PAYMENT_FAILED` | declined. `details.booking` is the BookingView with `status: FAILED`, `paymentStatus: FAILED`; seats are released |
| 403 | booking belongs to someone else |
| 404 | unknown booking |
| 409 `CONFLICT` | already paid ("This booking has already been paid for"), or booking cancelled/failed |
| 410 `HOLD_EXPIRED` | hold expired or seats were reclaimed; booking becomes `EXPIRED` |
| 500 `INTERNAL_ERROR` | gateway outage or DB failure; **rolled back**, hold intact, safe to retry |

#### `POST /bookings/:id/cancel`

No body.

- **PENDING:** the hold is released and the booking becomes `CANCELLED`. No refund is involved.
- **CONFIRMED:** allowed only if the show starts ≥ `CANCELLATION_CUTOFF_MINUTES` (120) from now. The payment is refunded through the same strategy (`paymentStatus: REFUNDED`), the seats become `AVAILABLE`, and the booking becomes `CANCELLED`.

**200**: BookingView. Errors:

- `403`, `404`
- `409 CONFLICT`: already cancelled, expired or failed; refund rejected by the gateway
- `422 CANCELLATION_WINDOW_CLOSED`

#### `GET /bookings`

Booking history of the caller, newest first. **200**: `BookingView[]`.

#### `GET /bookings/:id`

**200**: BookingView. The owner or an admin may read it; others get `403`.

#### `GET /notifications`

The caller's notifications, newest first (max 50).

```json
{ "success": true, "data": [ { "id": 7, "userId": 2, "bookingId": 12, "type": "BOOKING_CONFIRMED", "channel": "EMAIL",
  "subject": "Booking confirmed - BMS-RHGYQLS3",
  "message": "Your seats A1, A2 are confirmed. Amount paid: Rs 684.40.", "createdAt": "2026-11-17T09:39:12.000Z" } ] }
```

### 2.7 Admin

#### `GET /admin/stats` (admin)

**200**

```json
{ "success": true, "data": {
  "totals": { "movies": 6, "theatres": 4, "screens": 7, "upcomingShows": 126, "users": 3 },
  "bookingsByStatus": { "CONFIRMED": 1, "CANCELLED": 1 },
  "revenue": 684.4, "refunded": 0,
  "topMovies": [ { "movieId": 1, "title": "The Last Monsoon", "confirmedBookings": 1, "revenue": 684.4 } ] } }
```

`revenue` = sum of payments with status `SUCCESS`; `refunded` = sum of payments with status `REFUNDED`.

#### `GET /admin/bookings` (admin)

Query: `status` (one of the booking statuses, optional) and `limit` (1–500, default 100). **200**: `BookingView[]` across all users.

---

## 3. End-to-end example (shell)

```bash
API=http://localhost:4000/api
TOKEN=$(curl -s -X POST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"Password1"}' | jq -r .data.token)
SHOW=$(curl -s $API/movies/1/shows | jq '.data[0].id')
SEAT=$(curl -s $API/shows/$SHOW/seats | jq '[.data.rows[].seats[] | select(.status=="AVAILABLE")][0].seatId')
BID=$(curl -s -X POST $API/bookings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"showId\":$SHOW,\"seatIds\":[$SEAT]}" | jq .data.id)
curl -s -X POST $API/bookings/$BID/payments -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"method":"UPI","details":{"upiId":"alice@okbank"}}' | jq '.data | {status, paymentStatus, transactionRef}'
curl -s -X POST $API/bookings/$BID/cancel -H "authorization: Bearer $TOKEN" | jq '.data | {status, paymentStatus}'
```

This flow was exercised against the running server during development. Observed results:

- hold → `PENDING`, ₹684.40 for two seats;
- replay with the same key → `200`;
- a second hold on the same seat → `409 SEAT_UNAVAILABLE`;
- UPI payment → `CONFIRMED / SUCCESS`;
- cancel → `CANCELLED / REFUNDED`;
- a customer calling `/admin/stats` → `403 FORBIDDEN`.
