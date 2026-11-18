import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { ShowListing } from '../api/types';
import { Alert, formatDuration, formatMoney, formatTime, Poster, Spinner } from '../components/common';
import { useAsync } from '../state/hooks';

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/** Movie details + theatre/show selection (grouped by day, city and theatre). */
export function MovieDetailsPage() {
  const movieId = Number(useParams().id);
  const movie = useAsync(() => api.movies.get(movieId), [movieId]);
  const shows = useAsync(() => api.movies.shows(movieId), [movieId]);
  const [city, setCity] = useState('');
  const [day, setDay] = useState<string | null>(null);

  const all = shows.data ?? [];
  const cities = useMemo(() => [...new Set(all.map((s) => s.city))].sort(), [all]);
  const days = useMemo(() => [...new Set(all.filter((s) => !city || s.city === city).map((s) => dayKey(s.startTime)))].sort(), [all, city]);
  const activeDay = day && days.includes(day) ? day : days[0];
  const byTheatre = useMemo(() => {
    const map = new Map<string, ShowListing[]>();
    for (const s of all.filter((s) => (!city || s.city === city) && dayKey(s.startTime) === activeDay)) {
      const key = `${s.theatreName}|${s.city}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [all, city, activeDay]);

  if (movie.loading) return <Spinner />;
  if (movie.error || !movie.data) return <Alert kind="error">{movie.error ?? 'Movie not found'}</Alert>;
  const m = movie.data;

  return (
    <>
      <section className="movie-hero">
        <Poster title={m.title} genre={m.genre} size="lg" />
        <div>
          <h1>{m.title}</h1>
          <p className="chips">
            <span className="chip">{m.certificate}</span>
            <span className="chip">{m.genre}</span>
            <span className="chip">{m.language}</span>
            <span className="chip">{formatDuration(m.durationMinutes)}</span>
          </p>
          <p>{m.description}</p>
          <p className="muted small">Released {new Date(m.releaseDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Choose a show</h2>
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {shows.loading && <Spinner label="Loading shows…" />}
        {shows.error && (
          <Alert kind="error" onRetry={shows.reload}>
            {shows.error}
          </Alert>
        )}
        {!shows.loading && all.length === 0 && <Alert>No upcoming shows for this movie.</Alert>}
        {days.length > 0 && (
          <div className="day-tabs" role="tablist">
            {days.map((d) => (
              <button key={d} role="tab" aria-selected={d === activeDay} className={`day-tab ${d === activeDay ? 'active' : ''}`} onClick={() => setDay(d)}>
                {dayLabel(d)}
              </button>
            ))}
          </div>
        )}
        {byTheatre.map(([key, list]) => {
          const [theatre, theatreCity] = key.split('|');
          return (
            <div key={key} className="theatre-row">
              <div>
                <strong>{theatre}</strong>
                <div className="muted small">{theatreCity}</div>
              </div>
              <div className="showtimes">
                {list.map((s) => {
                  const soldOut = s.availableSeats === 0;
                  const fewLeft = s.availableSeats / s.totalSeats < 0.2;
                  return (
                    <Link
                      key={s.id}
                      to={soldOut ? '#' : `/shows/${s.id}`}
                      className={`showtime ${soldOut ? 'sold-out' : fewLeft ? 'few-left' : ''}`}
                      aria-disabled={soldOut}
                      data-testid="showtime"
                      title={`${s.screenName} · from ${formatMoney(s.basePrice)} · ${s.availableSeats}/${s.totalSeats} seats free`}
                    >
                      {formatTime(s.startTime)}
                      <small>{soldOut ? 'Sold out' : `${s.screenName} · ${s.availableSeats} left`}</small>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
