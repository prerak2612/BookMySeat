/** Typed API facade - components never build URLs themselves. */
import { HttpClient } from './httpClient';
import type {
  AdminStats,
  AuthResult,
  Booking,
  Movie,
  NotificationItem,
  PaymentMethod,
  SeatCategory,
  SeatMap,
  ShowDetails,
  ShowListing,
  Theatre,
  User,
} from './types';

export const TOKEN_KEY = 'bms.token';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const http = new HttpClient(import.meta.env.VITE_API_URL ?? '/api', readToken);

const qs = (params: Record<string, string | number | undefined | boolean>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export const api = {
  auth: {
    login: (email: string, password: string) => http.post<AuthResult>('/auth/login', { email, password }),
    register: (name: string, email: string, password: string) => http.post<AuthResult>('/auth/register', { name, email, password }),
    me: () => http.get<User>('/auth/me'),
  },
  movies: {
    list: (f: { q?: string; genre?: string; language?: string; includeInactive?: boolean } = {}) => http.get<Movie[]>(`/movies${qs(f)}`),
    get: (id: number) => http.get<Movie>(`/movies/${id}`),
    shows: (id: number, f: { date?: string; city?: string } = {}) => http.get<ShowListing[]>(`/movies/${id}/shows${qs(f)}`),
    create: (m: Omit<Movie, 'id' | 'isActive'>) => http.post<Movie>('/movies', m),
    update: (id: number, m: Partial<Movie>) => http.patch<Movie>(`/movies/${id}`, m),
    deactivate: (id: number) => http.delete<Movie>(`/movies/${id}`),
  },
  theatres: {
    list: (city?: string) => http.get<Theatre[]>(`/theatres${qs({ city })}`),
    cities: () => http.get<string[]>('/cities'),
    create: (t: { name: string; city: string; address: string }) => http.post<Theatre>('/theatres', t),
    addScreen: (theatreId: number, name: string, layout: { preset: string } | { rows: { label: string; seats: number; category: SeatCategory }[] }) =>
      http.post(`/theatres/${theatreId}/screens`, { name, layout }),
  },
  shows: {
    get: (id: number) => http.get<ShowDetails>(`/shows/${id}`),
    seats: (id: number) => http.get<SeatMap>(`/shows/${id}/seats`),
    create: (s: { movieId: number; screenId: number; startTime: string; basePrice: number }) => http.post('/shows', s),
  },
  bookings: {
    hold: (showId: number, seatIds: number[], idempotencyKey: string) =>
      http.post<Booking>('/bookings', { showId, seatIds }, { 'Idempotency-Key': idempotencyKey }),
    pay: (id: number, method: PaymentMethod, details: Record<string, string>, idempotencyKey: string) =>
      http.post<Booking>(`/bookings/${id}/payments`, { method, details }, { 'Idempotency-Key': idempotencyKey }),
    cancel: (id: number) => http.post<Booking>(`/bookings/${id}/cancel`),
    get: (id: number) => http.get<Booking>(`/bookings/${id}`),
    mine: () => http.get<Booking[]>('/bookings'),
    notifications: () => http.get<NotificationItem[]>('/notifications'),
  },
  admin: {
    stats: () => http.get<AdminStats>('/admin/stats'),
    bookings: (status?: string) => http.get<Booking[]>(`/admin/bookings${qs({ status, limit: 50 })}`),
  },
};

/** Client-generated idempotency key: a retry of the SAME user action reuses it. */
export function newIdempotencyKey(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rnd}`.slice(0, 64);
}
