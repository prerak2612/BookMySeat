import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { BookingStatus } from '../api/types';
import { useAuth } from '../state/AuthContext';

// ---------------------------------------------------------------- formatting

export const formatMoney = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const formatDuration = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

// ---------------------------------------------------------------- layout

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="BookMySeat home">
          <span className="brand-mark">B</span> BookMySeat
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Movies
          </NavLink>
          {user && <NavLink to="/bookings">My bookings</NavLink>}
          {user?.role === 'ADMIN' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="nav-user">
          {user ? (
            <>
              <span className="muted" data-testid="current-user">
                {user.name}
              </span>
              <button className="btn btn-ghost" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <Link className="btn btn-primary" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="footer muted">BookMySeat · Capstone project · Seat state is always validated by the server</footer>
    </div>
  );
}

/** Route guard: redirects anonymous users to /login and non-admins away from admin pages. */
export function RequireAuth({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== 'ADMIN') return <Alert kind="error">Administrator access required.</Alert>;
  return <>{children}</>;
}

// ---------------------------------------------------------------- small presentational pieces

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" /> {label}
    </div>
  );
}

export function Alert({ kind = 'info', children, onRetry }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; onRetry?: () => void }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  FAILED: 'Payment failed',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

/** Generated poster (no external images): deterministic gradient from the title. */
export function Poster({ title, genre, size = 'md' }: { title: string; genre: string; size?: 'md' | 'lg' }) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const style = { background: `linear-gradient(160deg, hsl(${hash} 65% 45%), hsl(${(hash + 50) % 360} 70% 22%))` };
  return (
    <div className={`poster poster-${size}`} style={style} aria-hidden="true">
      <span className="poster-genre">{genre}</span>
      <span className="poster-title">{title}</span>
    </div>
  );
}

export function PriceBreakdown({ lines, total }: { lines: { label: string; amount: number }[]; total: number }) {
  return (
    <table className="price-table">
      <tbody>
        {lines.map((l) => (
          <tr key={l.label}>
            <td>{l.label}</td>
            <td className="num">{formatMoney(l.amount)}</td>
          </tr>
        ))}
        <tr className="price-total">
          <td>Total</td>
          <td className="num" data-testid="total-amount">
            {formatMoney(total)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function Countdown({ seconds }: { seconds: number }) {
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <span className={`countdown ${seconds < 60 ? 'countdown-urgent' : ''}`} data-testid="hold-countdown">
      {mm}:{ss}
    </span>
  );
}
