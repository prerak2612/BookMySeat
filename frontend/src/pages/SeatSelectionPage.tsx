import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, newIdempotencyKey } from '../api/endpoints';
import { ApiError, describeError } from '../api/httpClient';
import type { SeatView } from '../api/types';
import { Alert, formatDateTime, formatMoney, Spinner } from '../components/common';
import { SeatMap } from '../components/SeatMap';
import { SeatAvailabilityPoller } from '../patterns/SeatAvailabilityPoller';
import { pruneUnavailable, SELECTION_STRATEGIES } from '../patterns/seatSelectionStrategies';
import { useAuth } from '../state/AuthContext';
import { useObservable } from '../state/hooks';

const MAX_SEATS = 10;

export function SeatSelectionPage() {
  const showId = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // Observer: one poller per show; the page subscribes to its state.
  const poller = useMemo(() => new SeatAvailabilityPoller(showId, api.shows.seats, 5000), [showId]);
  useEffect(() => {
    poller.start();
    return () => poller.stop();
  }, [poller]);
  const { seatMap, loading, error, lastUpdated } = useObservable(poller);

  const [strategyId, setStrategyId] = useState(SELECTION_STRATEGIES[0]!.id);
  const strategy = SELECTION_STRATEGIES.find((s) => s.id === strategyId)!;
  const [quantity, setQuantity] = useState(2);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const holdKey = useRef<string | null>(null); // same key for retries of the same selection

  // When fresh availability arrives, silently drop seats that others took meanwhile.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (!seatMap) return;
    const prev = selectedRef.current;
    const next = pruneUnavailable(prev, seatMap);
    if (next.length !== prev.length) {
      setSelected(next);
      // Keep a more specific message (e.g. the server's 409) if one is already shown.
      setConflict((c) => c ?? 'Some of your selected seats were just taken by someone else and have been removed.');
    }
  }, [seatMap]);

  useEffect(() => {
    holdKey.current = null; // a different selection is a different request
  }, [selected]);

  const seatsById = useMemo(() => new Map((seatMap?.rows ?? []).flatMap((r) => r.seats).map((s) => [s.seatId, s])), [seatMap]);
  const chosen = selected.map((id) => seatsById.get(id)).filter((s): s is SeatView => !!s);
  const subtotal = chosen.reduce((sum, s) => sum + s.price, 0);

  const onSeatClick = (seat: SeatView) => {
    if (!seatMap) return;
    setConflict(null);
    setSelected(strategy.onSeatClick(seat, { seatMap, selected, quantity, maxSeats: MAX_SEATS }));
  };

  const proceed = async () => {
    if (!user) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setSubmitting(true);
    setConflict(null);
    holdKey.current ??= newIdempotencyKey('hold');
    try {
      const booking = await api.bookings.hold(showId, selected, holdKey.current);
      navigate(`/checkout/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        // Lost the race: the server is the source of truth. Refresh and let the user re-pick.
        setConflict(`${err.message}. The seat map has been refreshed - please choose again.`);
        await poller.refresh();
      } else {
        setConflict(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !seatMap) return <Spinner label="Loading seat layout…" />;
  if (!seatMap) return <Alert kind="error">{error ?? 'Show not found'}</Alert>;
  const { show } = seatMap;

  return (
    <div className="seat-page">
      <section className="card">
        <div className="row-between">
          <div>
            <h1 className="h2">{show.movieTitle}</h1>
            <p className="muted">
              {show.theatreName}, {show.city} · {show.screenName} · {formatDateTime(show.startTime)}
            </p>
          </div>
          <div className="selection-tools">
            <label className="inline-field">
              Mode
              <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} aria-label="Selection mode">
                {SELECTION_STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {strategyId === 'block' && (
              <label className="inline-field">
                Seats
                <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="Number of seats">
                  {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        {error && <Alert kind="warning">Live updates paused: {error}</Alert>}
        <SeatMap seatMap={seatMap} selected={selected} onSeatClick={onSeatClick} disabled={submitting} />
        <p className="muted small center">
          Availability refreshes every 5 seconds{lastUpdated ? ` · last update ${lastUpdated.toLocaleTimeString()}` : ''}
        </p>
      </section>

      <aside className="card sticky-summary">
        <h3>Your selection</h3>
        {conflict && <Alert kind="error">{conflict}</Alert>}
        {chosen.length === 0 ? (
          <p className="muted">Select up to {MAX_SEATS} seats.</p>
        ) : (
          <>
            <p data-testid="selected-seats">
              {chosen
                .map((s) => s.label)
                .sort()
                .join(', ')}
            </p>
            <p>
              Tickets: <strong>{formatMoney(subtotal)}</strong>
              <br />
              <span className="muted small">Fees and taxes are calculated by the server on the next step.</span>
            </p>
          </>
        )}
        <button className="btn btn-primary btn-block" disabled={chosen.length === 0 || submitting} onClick={proceed}>
          {submitting ? 'Locking seats…' : user ? `Hold ${chosen.length || ''} seat${chosen.length === 1 ? '' : 's'} & continue` : 'Sign in to continue'}
        </button>
        <p className="muted small">Seats are held for you for a few minutes while you pay.</p>
      </aside>
    </div>
  );
}
