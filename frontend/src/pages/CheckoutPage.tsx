import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, newIdempotencyKey } from '../api/endpoints';
import { ApiError, describeError } from '../api/httpClient';
import type { Booking, PaymentMethod } from '../api/types';
import { Alert, Countdown, formatDateTime, PriceBreakdown, Spinner, StatusBadge } from '../components/common';
import { PaymentFormFactory } from '../patterns/paymentForms';
import { useAsync, useCountdown } from '../state/hooks';

/** Booking summary + payment simulation for a PENDING hold. */
export function CheckoutPage() {
  const bookingId = Number(useParams().id);
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.bookings.get(bookingId), [bookingId]);
  const [booking, setBooking] = useState<Booking | null>(null);
  useEffect(() => setBooking(data), [data]);

  // Countdown is anchored to the SERVER's remaining seconds (immune to client clock skew).
  const deadline = useMemo(() => (data ? new Date(Date.now() + data.holdSecondsRemaining * 1000) : null), [data]);
  const secondsLeft = useCountdown(deadline);

  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const form = PaymentFormFactory.get(method);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const payKey = useRef<string | null>(null);

  useEffect(() => {
    if (booking?.status === 'CONFIRMED') navigate(`/bookings/${booking.id}/confirmation`, { replace: true });
  }, [booking, navigate]);

  const switchMethod = (m: PaymentMethod) => {
    setMethod(m);
    setValues({});
    setFieldErrors({});
    payKey.current = null;
  };

  const pay = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = form.validate(values);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setPaying(true);
    setMessage(null);
    // Reuse the key if the previous attempt never got an answer (network error) -> safe retry.
    payKey.current ??= newIdempotencyKey('pay');
    try {
      const confirmed = await api.bookings.pay(bookingId, method, form.toDetails(values), payKey.current);
      navigate(`/bookings/${confirmed.id}/confirmation`);
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        setMessage({ kind: 'warning', text: `${err.message} Your payment can be retried safely - you will not be charged twice.` });
        return;
      }
      payKey.current = null;
      if (err instanceof ApiError && err.code === 'PAYMENT_FAILED') {
        setBooking((err.details as { booking: Booking }).booking);
        setMessage({ kind: 'error', text: `Payment failed: ${err.message}. Your seats have been released.` });
      } else if (err instanceof ApiError && err.code === 'HOLD_EXPIRED') {
        setMessage({ kind: 'error', text: err.message });
        reload();
      } else {
        setMessage({ kind: 'error', text: describeError(err) });
      }
    } finally {
      setPaying(false);
    }
  };

  const releaseHold = async () => {
    try {
      await api.bookings.cancel(bookingId);
      navigate(`/shows/${booking!.showId}`);
    } catch (err) {
      setMessage({ kind: 'error', text: describeError(err) });
    }
  };

  if (loading && !booking) return <Spinner />;
  if (error || !booking) return <Alert kind="error">{error ?? 'Booking not found'}</Alert>;

  const expired = booking.status === 'EXPIRED' || (booking.status === 'PENDING' && secondsLeft === 0);
  const payable = booking.status === 'PENDING' && !expired;

  return (
    <div className="checkout">
      <section className="card">
        <div className="row-between">
          <h1 className="h2">Booking summary</h1>
          <StatusBadge status={booking.status} />
        </div>
        <p>
          <strong>{booking.movieTitle}</strong>
          <br />
          <span className="muted">
            {booking.theatreName}, {booking.city} · {booking.screenName}
            <br />
            {formatDateTime(booking.showStartTime)}
          </span>
        </p>
        <p>
          Seats: <strong data-testid="summary-seats">{booking.seats.map((s) => s.label).join(', ')}</strong>
        </p>
        <PriceBreakdown lines={booking.priceBreakdown} total={booking.totalAmount} />
        <p className="muted small">Reference {booking.reference}</p>
      </section>

      <section className="card">
        {payable && (
          <p className="hold-banner">
            Seats held for you for <Countdown seconds={secondsLeft} />
          </p>
        )}
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        {expired && (
          <Alert kind="error">
            Your seat hold has expired. <Link to={`/shows/${booking.showId}`}>Choose seats again</Link>
          </Alert>
        )}
        {booking.status === 'FAILED' && (
          <p>
            <Link className="btn btn-primary" to={`/shows/${booking.showId}`}>
              Choose seats again
            </Link>
          </p>
        )}
        {payable && (
          <form onSubmit={pay} noValidate>
            <h3>Payment (simulated)</h3>
            <div className="method-tabs" role="tablist">
              {PaymentFormFactory.all().map((s) => (
                <button type="button" role="tab" key={s.method} aria-selected={s.method === method} className={`day-tab ${s.method === method ? 'active' : ''}`} onClick={() => switchMethod(s.method)}>
                  {s.label}
                </button>
              ))}
            </div>
            {form.fields.map((f) => (
              <label className="field" key={f.name}>
                <span>{f.label}</span>
                <input
                  name={f.name}
                  placeholder={f.placeholder}
                  inputMode={f.inputMode}
                  type={f.type ?? 'text'}
                  maxLength={f.maxLength}
                  value={values[f.name] ?? ''}
                  aria-invalid={!!fieldErrors[f.name]}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
                {fieldErrors[f.name] && <small className="field-error">{fieldErrors[f.name]}</small>}
              </label>
            ))}
            <p className="muted small">{form.hint}</p>
            <button className="btn btn-primary btn-block" disabled={paying}>
              {paying ? 'Processing payment…' : `Pay ₹${booking.totalAmount.toFixed(2)}`}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={releaseHold} disabled={paying}>
              Release seats
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
