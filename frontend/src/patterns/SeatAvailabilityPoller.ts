import { ApiError, describeError } from '../api/httpClient';
import type { SeatMap } from '../api/types';
import { Observable } from './Observable';

export interface SeatAvailabilityState {
  seatMap: SeatMap | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

/**
 * Concrete Subject: keeps a show's seat map fresh by polling the API and notifies every observer
 * (seat grid, summary, legend counts) when it changes. The server remains the source of truth -
 * this only keeps the view near-real-time; booking is re-validated by the backend under lock.
 */
export class SeatAvailabilityPoller extends Observable<SeatAvailabilityState> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly showId: number,
    private readonly fetchSeatMap: (showId: number) => Promise<SeatMap>,
    private readonly intervalMs = 5000,
  ) {
    super({ seatMap: null, loading: true, error: null, lastUpdated: null });
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch now (e.g. right after a 409 conflict). Concurrent calls share one request. */
  refresh(): Promise<void> {
    this.inFlight ??= this.fetchSeatMap(this.showId)
      .then((seatMap) => this.emit({ seatMap, loading: false, error: null, lastUpdated: new Date() }))
      .catch((err: unknown) => {
        const fatal = err instanceof ApiError && err.status === 404;
        if (fatal) this.stop();
        this.emit({ ...this.value, loading: false, error: describeError(err) });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
