import { logger } from '../common/logger.js';
import type { BookingEvent, BookingEventType } from '../domain/events.js';

/** Observer contract. */
export interface BookingEventListener {
  readonly name: string;
  handle(event: BookingEvent): Promise<void>;
}

/**
 * Subject of the Observer pattern. The booking workflow publishes events AFTER its transaction
 * commits; listeners (notifications, audit log, ...) react independently. A failing listener is
 * logged and never affects the booking or the other listeners.
 */
export class BookingEventPublisher {
  private readonly subscriptions: { listener: BookingEventListener; types: Set<BookingEventType> | null }[] = [];

  subscribe(listener: BookingEventListener, types?: BookingEventType[]): () => void {
    const entry = { listener, types: types ? new Set(types) : null };
    this.subscriptions.push(entry);
    return () => {
      const i = this.subscriptions.indexOf(entry);
      if (i >= 0) this.subscriptions.splice(i, 1);
    };
  }

  async publish(event: BookingEvent): Promise<void> {
    const targets = this.subscriptions.filter((s) => !s.types || s.types.has(event.type));
    await Promise.all(
      targets.map(async ({ listener }) => {
        try {
          await listener.handle(event);
        } catch (err) {
          logger.error('listener.failed', { listener: listener.name, event: event.type, error: (err as Error).message });
        }
      }),
    );
  }
}
