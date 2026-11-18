import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { Alert, formatDuration, Poster, Spinner } from '../components/common';
import { useAsync } from '../state/hooks';

export function MoviesPage() {
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('');
  const { data: movies, loading, error, reload } = useAsync(() => api.movies.list(), []);

  // Filter options come from the catalogue; filtering is client-side for instant feedback.
  const genres = useMemo(() => [...new Set((movies ?? []).map((m) => m.genre))].sort(), [movies]);
  const languages = useMemo(() => [...new Set((movies ?? []).map((m) => m.language))].sort(), [movies]);
  const visible = (movies ?? []).filter(
    (m) => (!q || m.title.toLowerCase().includes(q.toLowerCase())) && (!genre || m.genre === genre) && (!language || m.language === language),
  );

  return (
    <>
      <section className="hero">
        <h1>Now showing</h1>
        <div className="filters">
          <input placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search movies" />
          <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            <option value="">All languages</option>
            {languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
      </section>
      {loading && <Spinner />}
      {error && (
        <Alert kind="error" onRetry={reload}>
          {error}
        </Alert>
      )}
      {!loading && !error && visible.length === 0 && <Alert>No movies match your filters.</Alert>}
      <div className="movie-grid">
        {visible.map((m) => (
          <Link key={m.id} to={`/movies/${m.id}`} className="movie-card" data-testid="movie-card">
            <Poster title={m.title} genre={m.genre} />
            <div className="movie-card-body">
              <h3>{m.title}</h3>
              <p className="muted small">
                {m.certificate} · {m.language} · {formatDuration(m.durationMinutes)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
