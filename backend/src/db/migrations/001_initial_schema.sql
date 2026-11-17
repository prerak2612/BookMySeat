-- =====================================================================================
-- 001_initial_schema.sql
-- Normalised (3NF) relational schema for BookMySeat.
-- Every invariant that protects money or seats is enforced by the database itself,
-- not only by application code.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- needed for the show-overlap exclusion constraint

CREATE TYPE user_role        AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE seat_category    AS ENUM ('REGULAR', 'PREMIUM', 'RECLINER');
CREATE TYPE show_status      AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE show_seat_status AS ENUM ('AVAILABLE', 'LOCKED', 'BOOKED');
CREATE TYPE booking_status   AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED');
CREATE TYPE payment_method   AS ENUM ('CARD', 'UPI', 'WALLET');
CREATE TYPE payment_status   AS ENUM ('SUCCESS', 'FAILED', 'REFUNDED');

-- ---------------------------------------------------------------- users
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    role          user_role    NOT NULL DEFAULT 'CUSTOMER',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness of e-mail addresses.
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));

-- ---------------------------------------------------------------- movies
CREATE TABLE movies (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    description      TEXT         NOT NULL DEFAULT '',
    duration_minutes INTEGER      NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
    language         VARCHAR(50)  NOT NULL,
    genre            VARCHAR(50)  NOT NULL,
    certificate      VARCHAR(5)   NOT NULL DEFAULT 'UA' CHECK (certificate IN ('U', 'UA', 'A', 'S')),
    release_date     DATE         NOT NULL,
    poster_url       TEXT,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- theatres / screens / seats
CREATE TABLE theatres (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    city       VARCHAR(100) NOT NULL,
    address    VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ux_theatres_name_city UNIQUE (name, city)
);

CREATE TABLE screens (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    theatre_id BIGINT       NOT NULL REFERENCES theatres (id) ON DELETE CASCADE,
    name       VARCHAR(50)  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ux_screens_theatre_name UNIQUE (theatre_id, name)
);

-- Physical seats belong to a screen (composition: deleting a screen deletes its seats).
CREATE TABLE seats (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    screen_id   BIGINT        NOT NULL REFERENCES screens (id) ON DELETE CASCADE,
    row_label   VARCHAR(3)    NOT NULL,
    seat_number INTEGER       NOT NULL CHECK (seat_number > 0),
    category    seat_category NOT NULL DEFAULT 'REGULAR',
    CONSTRAINT ux_seats_position UNIQUE (screen_id, row_label, seat_number)
);

-- ---------------------------------------------------------------- shows
CREATE TABLE shows (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movie_id   BIGINT        NOT NULL REFERENCES movies (id) ON DELETE RESTRICT,
    screen_id  BIGINT        NOT NULL REFERENCES screens (id) ON DELETE RESTRICT,
    start_time TIMESTAMPTZ   NOT NULL,
    end_time   TIMESTAMPTZ   NOT NULL,
    base_price NUMERIC(10,2) NOT NULL CHECK (base_price > 0),
    status     show_status   NOT NULL DEFAULT 'SCHEDULED',
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_shows_time_order CHECK (end_time > start_time),
    -- A screen can never run two scheduled shows whose time ranges overlap.
    CONSTRAINT ex_shows_no_overlap EXCLUDE USING gist (
        screen_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    ) WHERE (status = 'SCHEDULED')
);

-- ---------------------------------------------------------------- bookings
CREATE TABLE bookings (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference       VARCHAR(16)    NOT NULL UNIQUE,
    user_id         BIGINT         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    show_id         BIGINT         NOT NULL REFERENCES shows (id) ON DELETE RESTRICT,
    status          booking_status NOT NULL DEFAULT 'PENDING',
    subtotal        NUMERIC(10,2)  NOT NULL CHECK (subtotal >= 0),
    total_amount    NUMERIC(10,2)  NOT NULL CHECK (total_amount >= 0),
    price_breakdown JSONB          NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key VARCHAR(100),
    expires_at      TIMESTAMPTZ    NOT NULL,          -- end of the temporary seat hold
    confirmed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    -- The same client retry (same user + Idempotency-Key) can never create two bookings.
    CONSTRAINT ux_bookings_idempotency UNIQUE (user_id, idempotency_key),
    CONSTRAINT ck_bookings_confirmed_at CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

-- ---------------------------------------------------------------- show_seats (per-show seat inventory)
-- One row per (show, physical seat). This is the row that is locked during booking.
CREATE TABLE show_seats (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    show_id         BIGINT           NOT NULL REFERENCES shows (id) ON DELETE CASCADE,
    seat_id         BIGINT           NOT NULL REFERENCES seats (id) ON DELETE RESTRICT,
    status          show_seat_status NOT NULL DEFAULT 'AVAILABLE',
    booking_id      BIGINT           REFERENCES bookings (id) ON DELETE SET NULL,
    lock_expires_at TIMESTAMPTZ,
    version         INTEGER          NOT NULL DEFAULT 0,   -- optimistic-locking version counter
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT ux_show_seats_show_seat UNIQUE (show_id, seat_id),
    -- State-machine integrity: the columns must agree with the status.
    CONSTRAINT ck_show_seats_state CHECK (
        (status = 'AVAILABLE' AND booking_id IS NULL     AND lock_expires_at IS NULL) OR
        (status = 'LOCKED'    AND booking_id IS NOT NULL AND lock_expires_at IS NOT NULL) OR
        (status = 'BOOKED'    AND booking_id IS NOT NULL AND lock_expires_at IS NULL)
    )
);

-- ---------------------------------------------------------------- booking_seats (booking line items)
CREATE TABLE booking_seats (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id   BIGINT        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    show_seat_id BIGINT        NOT NULL REFERENCES show_seats (id) ON DELETE RESTRICT,
    price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT ux_booking_seats_line UNIQUE (booking_id, show_seat_id)
);
-- THE double-booking guard of last resort: at most ONE active (pending or confirmed)
-- reservation may exist for any show seat, no matter what the application does.
CREATE UNIQUE INDEX ux_booking_seats_one_active_per_show_seat
    ON booking_seats (show_seat_id) WHERE is_active;

-- ---------------------------------------------------------------- payments
CREATE TABLE payments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id      BIGINT         NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
    amount          NUMERIC(10,2)  NOT NULL CHECK (amount >= 0),
    method          payment_method NOT NULL,
    status          payment_status NOT NULL,
    gateway         VARCHAR(50)    NOT NULL,
    transaction_ref VARCHAR(100),
    failure_reason  VARCHAR(300),
    idempotency_key VARCHAR(100),
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    refunded_at     TIMESTAMPTZ,
    CONSTRAINT ux_payments_idempotency UNIQUE (booking_id, idempotency_key)
);
-- A booking can be successfully charged at most once.
CREATE UNIQUE INDEX ux_payments_one_success_per_booking
    ON payments (booking_id) WHERE status IN ('SUCCESS', 'REFUNDED');

-- ---------------------------------------------------------------- notifications (Observer output)
CREATE TABLE notifications (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    booking_id BIGINT       REFERENCES bookings (id) ON DELETE CASCADE,
    type       VARCHAR(40)  NOT NULL,
    channel    VARCHAR(20)  NOT NULL,
    subject    VARCHAR(200) NOT NULL,
    message    TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
