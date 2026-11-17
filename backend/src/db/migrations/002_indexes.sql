-- =====================================================================================
-- 002_indexes.sql
-- Secondary indexes chosen from the actual query patterns of the repositories.
-- =====================================================================================

-- Movie catalogue: list active movies, filter by genre/language.
CREATE INDEX ix_movies_active_release ON movies (is_active, release_date DESC);
CREATE INDEX ix_movies_genre          ON movies (genre);
CREATE INDEX ix_movies_language       ON movies (language);

-- Theatre browsing by city.
CREATE INDEX ix_theatres_city ON theatres (city);

-- Shows for a movie in a date range (GET /movies/:id/shows).
CREATE INDEX ix_shows_movie_start  ON shows (movie_id, start_time);
CREATE INDEX ix_shows_screen_start ON shows (screen_id, start_time);

-- Seat map for a show + availability counts.
CREATE INDEX ix_show_seats_show_status ON show_seats (show_id, status);
-- Releasing / confirming all seats that a booking holds.
CREATE INDEX ix_show_seats_booking     ON show_seats (booking_id) WHERE booking_id IS NOT NULL;

-- Booking history for a user, newest first.
CREATE INDEX ix_bookings_user_created ON bookings (user_id, created_at DESC);
-- Hold-expiry sweeper: only PENDING bookings are scanned.
CREATE INDEX ix_bookings_pending_expiry ON bookings (expires_at) WHERE status = 'PENDING';
CREATE INDEX ix_bookings_show ON bookings (show_id);

CREATE INDEX ix_booking_seats_booking ON booking_seats (booking_id);
CREATE INDEX ix_payments_booking      ON payments (booking_id);
CREATE INDEX ix_notifications_user    ON notifications (user_id, created_at DESC);
