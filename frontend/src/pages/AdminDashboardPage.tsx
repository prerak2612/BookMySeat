import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api/endpoints';
import { describeError } from '../api/httpClient';
import { Alert, formatDateTime, formatMoney, Spinner, StatusBadge } from '../components/common';
import { useAsync } from '../state/hooks';

type Tab = 'overview' | 'movies' | 'theatres' | 'shows' | 'bookings';

/** Admin dashboard: metrics + catalogue management (movies, theatres/screens, shows) + bookings. */
export function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['movies', 'Movies'],
    ['theatres', 'Theatres & screens'],
    ['shows', 'Schedule show'],
    ['bookings', 'Bookings'],
  ];
  return (
    <>
      <h1>Admin dashboard</h1>
      <div className="day-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`day-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'movies' && <MoviesAdmin />}
      {tab === 'theatres' && <TheatresAdmin />}
      {tab === 'shows' && <ShowsAdmin />}
      {tab === 'bookings' && <BookingsAdmin />}
    </>
  );
}

function Overview() {
  const { data, loading, error, reload } = useAsync(() => api.admin.stats(), []);
  if (loading) return <Spinner />;
  if (error || !data) return <Alert kind="error" onRetry={reload}>{error}</Alert>;
  const tiles: [string, string | number][] = [
    ['Revenue', formatMoney(data.revenue)],
    ['Refunded', formatMoney(data.refunded)],
    ['Confirmed bookings', data.bookingsByStatus.CONFIRMED ?? 0],
    ['Upcoming shows', data.totals.upcomingShows],
    ['Active movies', data.totals.movies],
    ['Theatres / screens', `${data.totals.theatres} / ${data.totals.screens}`],
    ['Users', data.totals.users],
  ];
  return (
    <>
      <div className="stat-grid">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat card">
            <span className="muted small">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Bookings by status</h3>
        <p>
          {Object.entries(data.bookingsByStatus).map(([s, n]) => (
            <span key={s} className="chip">
              {s}: {n}
            </span>
          ))}
        </p>
        <h3>Top movies by revenue</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Movie</th>
              <th className="num">Bookings</th>
              <th className="num">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.topMovies.map((m) => (
              <tr key={m.movieId}>
                <td>{m.title}</td>
                <td className="num">{m.confirmedBookings}</td>
                <td className="num">{formatMoney(m.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Small helper for admin forms: submit state + result message. */
function useSubmit() {
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: 'success', text: await fn() });
    } catch (err) {
      setMsg({ kind: 'error', text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };
  return { msg, busy, run };
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

function MoviesAdmin() {
  const movies = useAsync(() => api.movies.list({ includeInactive: true }), []);
  const { msg, busy, run } = useSubmit();
  const blank = { title: '', description: '', durationMinutes: '120', language: 'English', genre: 'Drama', certificate: 'UA', releaseDate: new Date().toISOString().slice(0, 10) };
  const [f, setF] = useState(blank);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const m = await api.movies.create({ ...f, durationMinutes: Number(f.durationMinutes), posterUrl: null });
      setF(blank);
      movies.reload();
      return `Created "${m.title}"`;
    });
  };

  return (
    <div className="admin-grid">
      <form className="card" onSubmit={submit}>
        <h3>Add movie</h3>
        <Field label="Title">
          <input name="title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
        </Field>
        <Field label="Description">
          <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} />
        </Field>
        <div className="two-col">
          <Field label="Duration (min)">
            <input type="number" min={1} max={600} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} />
          </Field>
          <Field label="Certificate">
            <select value={f.certificate} onChange={(e) => setF({ ...f, certificate: e.target.value })}>
              {['U', 'UA', 'A', 'S'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <input value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} />
          </Field>
          <Field label="Genre">
            <input value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })} />
          </Field>
        </div>
        <Field label="Release date">
          <input type="date" value={f.releaseDate} onChange={(e) => setF({ ...f, releaseDate: e.target.value })} />
        </Field>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <button className="btn btn-primary" disabled={busy}>
          Create movie
        </button>
      </form>
      <div className="card">
        <h3>Catalogue</h3>
        {movies.loading && <Spinner />}
        <table className="table">
          <tbody>
            {movies.data?.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.title} <span className="muted small">{m.genre}</span>
                </td>
                <td className="num">
                  {m.isActive ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => void run(async () => (await api.movies.deactivate(m.id), movies.reload(), `Deactivated "${m.title}"`))}>
                      Deactivate
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => void run(async () => (await api.movies.update(m.id, { isActive: true }), movies.reload(), `Re-activated "${m.title}"`))}>
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TheatresAdmin() {
  const theatres = useAsync(() => api.theatres.list(), []);
  const t = useSubmit();
  const s = useSubmit();
  const [tf, setTf] = useState({ name: '', city: '', address: '' });
  const [sf, setSf] = useState({ theatreId: '', name: '', preset: 'MEDIUM' });

  return (
    <div className="admin-grid">
      <div>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void t.run(async () => {
              const created = await api.theatres.create(tf);
              setTf({ name: '', city: '', address: '' });
              theatres.reload();
              return `Created ${created.name}`;
            });
          }}
        >
          <h3>Add theatre</h3>
          <Field label="Name">
            <input value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} />
          </Field>
          <Field label="City">
            <input value={tf.city} onChange={(e) => setTf({ ...tf, city: e.target.value })} />
          </Field>
          <Field label="Address">
            <input value={tf.address} onChange={(e) => setTf({ ...tf, address: e.target.value })} />
          </Field>
          {t.msg && <Alert kind={t.msg.kind}>{t.msg.text}</Alert>}
          <button className="btn btn-primary" disabled={t.busy}>
            Create theatre
          </button>
        </form>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void s.run(async () => {
              await api.theatres.addScreen(Number(sf.theatreId), sf.name, { preset: sf.preset });
              theatres.reload();
              return `Screen ${sf.name} created`;
            });
          }}
        >
          <h3>Add screen</h3>
          <Field label="Theatre">
            <select value={sf.theatreId} onChange={(e) => setSf({ ...sf, theatreId: e.target.value })}>
              <option value="">Select…</option>
              {theatres.data?.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name} ({th.city})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Screen name">
            <input value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} />
          </Field>
          <Field label="Layout">
            <select value={sf.preset} onChange={(e) => setSf({ ...sf, preset: e.target.value })}>
              <option value="SMALL">Small · 5 rows × 10 (50 seats)</option>
              <option value="MEDIUM">Medium · 8 rows × 12 (96 seats)</option>
              <option value="LARGE">Large · 10 rows × 16 (160 seats)</option>
            </select>
          </Field>
          {s.msg && <Alert kind={s.msg.kind}>{s.msg.text}</Alert>}
          <button className="btn btn-primary" disabled={s.busy || !sf.theatreId}>
            Create screen
          </button>
        </form>
      </div>
      <div className="card">
        <h3>Theatres</h3>
        {theatres.data?.map((th) => (
          <div key={th.id} className="theatre-row">
            <div>
              <strong>{th.name}</strong>
              <div className="muted small">
                {th.city} · {th.address}
              </div>
            </div>
            <div className="chips">
              {th.screens.map((sc) => (
                <span key={sc.id} className="chip">
                  {sc.name} · {sc.capacity} seats
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShowsAdmin() {
  const movies = useAsync(() => api.movies.list(), []);
  const theatres = useAsync(() => api.theatres.list(), []);
  const { msg, busy, run } = useSubmit();
  const [f, setF] = useState({ movieId: '', screenId: '', startTime: '', basePrice: '250' });
  const screens = (theatres.data ?? []).flatMap((t) => t.screens.map((s) => ({ ...s, label: `${t.name} (${t.city}) · ${s.name}` })));

  return (
    <form
      className="card narrow"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.shows.create({ movieId: Number(f.movieId), screenId: Number(f.screenId), startTime: new Date(f.startTime).toISOString(), basePrice: Number(f.basePrice) });
          return 'Show scheduled - seat inventory generated';
        });
      }}
    >
      <h3>Schedule a show</h3>
      <p className="muted small">The server computes the end time (runtime + 15 min cleaning) and rejects overlaps on the same screen.</p>
      <Field label="Movie">
        <select value={f.movieId} onChange={(e) => setF({ ...f, movieId: e.target.value })}>
          <option value="">Select…</option>
          {movies.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Screen">
        <select value={f.screenId} onChange={(e) => setF({ ...f, screenId: e.target.value })}>
          <option value="">Select…</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="two-col">
        <Field label="Start time">
          <input type="datetime-local" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
        </Field>
        <Field label="Base price (₹)">
          <input type="number" min={1} value={f.basePrice} onChange={(e) => setF({ ...f, basePrice: e.target.value })} />
        </Field>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn btn-primary" disabled={busy || !f.movieId || !f.screenId || !f.startTime}>
        Schedule show
      </button>
    </form>
  );
}

function BookingsAdmin() {
  const [status, setStatus] = useState('');
  const { data, loading, error } = useAsync(() => api.admin.bookings(status || undefined), [status]);
  return (
    <div className="card">
      <div className="row-between">
        <h3>Recent bookings</h3>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      <table className="table">
        <thead>
          <tr>
            <th>Reference</th>
            <th>User</th>
            <th>Show</th>
            <th>Seats</th>
            <th className="num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((b) => (
            <tr key={b.id}>
              <td>{b.reference}</td>
              <td>{b.userEmail}</td>
              <td>
                {b.movieTitle}
                <div className="muted small">
                  {b.theatreName} · {formatDateTime(b.showStartTime)}
                </div>
              </td>
              <td>{b.seats.map((s) => s.label).join(', ')}</td>
              <td className="num">{formatMoney(b.totalAmount)}</td>
              <td>
                <StatusBadge status={b.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
