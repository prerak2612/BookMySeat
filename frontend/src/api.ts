export type ApiMovie = {
  id: number; title: string; description: string; durationMinutes: number; language: string; genre: string; certificate: string; posterUrl: string | null;
};
export type ApiShow = {
  id: number; theatreName: string; screenName: string; startTime: string; basePrice: number; availableSeats: number; totalSeats: number;
};
export type ApiSeat = { showSeatId: number; label: string; row: string; number: number; status: 'AVAILABLE' | 'LOCKED' | 'BOOKED'; price: number };
export type ApiSeatMap = { rows: { row: string; seats: ApiSeat[] }[] };
type Envelope<T> = { success: true; data: T } | { success: false; error: { message: string } };

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || !body.success) throw new Error(body.success ? 'Request failed' : body.error.message);
  return body.data;
}

export const api = {
  movies: () => request<ApiMovie[]>('/movies'),
  cities: () => request<string[]>('/cities'),
  shows: (movieId: number, city: string) => request<ApiShow[]>(`/movies/${movieId}/shows?city=${encodeURIComponent(city)}`),
  seats: (showId: number) => request<ApiSeatMap>(`/shows/${showId}/seats`),
  login: (email: string, password: string) => request<{ token: string; user: { name: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  hold: (showId: number, seatIds: number[], token: string) => request<{ reference: string; holdSecondsRemaining: number }>('/bookings', { method: 'POST', headers: { 'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }, body: JSON.stringify({ showId, seatIds }) }, token),
};
