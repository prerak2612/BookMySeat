import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import { describeError } from '../api/httpClient';
import type { Booking } from '../api/types';
import { Alert, formatDateTime, formatMoney, PriceBreakdown, Spinner, StatusBadge } from '../components/common';
import { useAsync } from '../state/hooks';

/** Ticket-style confirmation shown after a successful payment. */
export function ConfirmationPage() {
  const bookingId = Number(useParams().id);
  const { data: b, loading, error } = useAsync(() => api.bookings.get(bookingId), [bookingId]);
  if (loading) return <Spinner />;
  if (error || !b) return <Alert kind="error">{error ?? 'Booking not found'}</Alert>;
  if (b.status !== 'CONFIRMED') {
    return (
      <Alert kind="warning">
        This booking is {b.status.toLowerCase()}. <Link to="/bookings">View my bookings</Link>
      </Alert>
    );
  }
  return (
    <div className="ticket card" data-testid="confirmation">
      <div className="ticket-head">
        <span className="ticket-check" aria-hidden="true">
          ✓
        </span>
        <div>
          <h1 className="h2">Booking confirmed</h1>
          <p className="muted">A confirmation has been sent by email and SMS.</p>
        </div>
      </div>
      <div className="ticket-body">
        <div>
          <h2>{b.movieTitle}</h2>
          <p>
            {b.theatreName}, {b.city} · {b.screenName}
            <br />
            <strong>{formatDateTime(b.showStartTime)}</strong>
          </p>
          <p>
            Seats <strong data-testid="confirmed-seats">{b.seats.map((s) => s.label).join(', ')}</strong>
          </p>
          <PriceBreakdown lines={b.priceBreakdown} total={b.totalAmount} />
        </div>
        <div className="ticket-stub">
          <span className="muted small">Booking reference</span>
          <strong className="reference" data-testid="booking-reference">
            {b.reference}
          </strong>
          <span className="muted small">
            Paid by {b.paymentMethod} · {b.transactionRef}
          </span>
        </div>
      </div>
      <p className="center">
        <Link to="/bookings" className="btn btn-ghost">
          My bookings
        </Link>{' '}
        <Link to="/" className="btn btn-primary">
          Book another movie
        </Link>
      </p>
    </div>
  );
}

/** Booking history + cancellation + notification feed. */
export function BookingHistoryPage() {
  const bookings = useAsync(() => api.bookings.mine(), []);
  const notes = useAsync(() => api.bookings.notifications(), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const cancel = async (b: Booking) => {
    const refund = b.status === 'CONFIRMED' ? ` You will be refunded ${formatMoney(b.totalAmount)}.` : '';
    if (!window.confirm(`Cancel booking ${b.reference}?${refund}`)) return;
    setBusy(b.id);
    setMessage(null);
    try {
      const updated = await api.bookings.cancel(b.id);
      setMessage({ kind: 'success', text: `Booking ${updated.reference} cancelled.${updated.paymentStatus === 'REFUNDED' ? ' Refund initiated.' : ''}` });
      bookings.reload();
      notes.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: describeError(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="history">
      <section>
        <h1>My bookings</h1>
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        {bookings.loading && <Spinner />}
        {bookings.error && (
          <Alert kind="error" onRetry={bookings.reload}>
            {bookings.error}
          </Alert>
        )}
        {bookings.data?.length === 0 && (
          <Alert>
            No bookings yet. <Link to="/">Find a movie</Link>
          </Alert>
        )}
        {bookings.data?.map((b) => (
          <article key={b.id} className="card booking-item" data-testid="booking-item">
            <div className="row-between">
              <div>
                <h3>{b.movieTitle}</h3>
                <p className="muted small">
                  {b.theatreName}, {b.city} · {b.screenName} · {formatDateTime(b.showStartTime)}
                </p>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <p>
              Seats <strong>{b.seats.map((s) => s.label).join(', ')}</strong> · {formatMoney(b.totalAmount)} · <span className="muted">{b.reference}</span>
              {b.paymentStatus === 'REFUNDED' && <span className="badge badge-refunded">Refunded</span>}
            </p>
            <div className="actions">
              {b.status === 'PENDING' && b.holdSecondsRemaining > 0 && (
                <Link className="btn btn-primary btn-sm" to={`/checkout/${b.id}`}>
                  Complete payment
                </Link>
              )}
              {b.status === 'CONFIRMED' && (
                <Link className="btn btn-ghost btn-sm" to={`/bookings/${b.id}/confirmation`}>
                  View ticket
                </Link>
              )}
              {b.cancellable && (
                <button className="btn btn-danger btn-sm" disabled={busy === b.id} onClick={() => cancel(b)}>
                  {busy === b.id ? 'Cancelling…' : b.status === 'PENDING' ? 'Release hold' : 'Cancel booking'}
                </button>
              )}
              {b.status === 'CONFIRMED' && !b.cancellable && <span className="muted small">Cancellation window closed</span>}
            </div>
          </article>
        ))}
      </section>
      <aside className="card">
        <h3>Notifications</h3>
        {notes.data?.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="notes">
          {notes.data
            ?.filter((n) => n.channel === 'EMAIL')
            .map((n) => (
              <li key={n.id}>
                <strong>{n.subject}</strong>
                <p className="small">{n.message}</p>
                <span className="muted small">{formatDateTime(n.createdAt)}</span>
              </li>
            ))}
        </ul>
      </aside>
    </div>
  );
}
