import { logger } from '../common/logger.js';
import type { BookingEvent, BookingEventType } from '../domain/events.js';
import type { NotificationRepository, UserRepository } from '../repositories/interfaces.js';
import type { BookingEventListener } from './BookingEventPublisher.js';

/** Delivery channel strategy (e-mail, SMS, ...). Simulated: messages are logged and stored. */
export interface NotificationChannel {
  readonly name: string;
  send(recipient: { email: string; name: string }, subject: string, message: string): Promise<void>;
}

export class EmailChannel implements NotificationChannel {
  readonly name = 'EMAIL';
  async send(recipient: { email: string }, subject: string): Promise<void> {
    logger.info('email.sent', { to: recipient.email, subject });
  }
}

export class SmsChannel implements NotificationChannel {
  readonly name = 'SMS';
  async send(recipient: { name: string }, subject: string): Promise<void> {
    logger.info('sms.sent', { to: recipient.name, subject });
  }
}

const TEMPLATES: Record<BookingEventType, (e: BookingEvent) => { subject: string; message: string }> = {
  BOOKING_CONFIRMED: (e) => ({
    subject: `Booking confirmed - ${e.bookingReference}`,
    message: `Your seats ${e.seatLabels.join(', ')} are confirmed. Amount paid: Rs ${e.amount.toFixed(2)}.`,
  }),
  BOOKING_CANCELLED: (e) => ({
    subject: `Booking cancelled - ${e.bookingReference}`,
    message: `Booking ${e.bookingReference} for seats ${e.seatLabels.join(', ')} was cancelled.${e.reason ? ` ${e.reason}` : ''}`,
  }),
  PAYMENT_FAILED: (e) => ({
    subject: `Payment failed - ${e.bookingReference}`,
    message: `Payment of Rs ${e.amount.toFixed(2)} failed (${e.reason ?? 'declined'}). Your seats were released.`,
  }),
  BOOKING_EXPIRED: (e) => ({
    subject: `Seat hold expired - ${e.bookingReference}`,
    message: `Your hold on seats ${e.seatLabels.join(', ')} expired before payment was completed.`,
  }),
};

/** Concrete observer: turns booking events into user notifications on every configured channel. */
export class NotificationService implements BookingEventListener {
  readonly name = 'NotificationService';

  constructor(
    private readonly users: UserRepository,
    private readonly notifications: NotificationRepository,
    private readonly channels: NotificationChannel[],
  ) {}

  async handle(event: BookingEvent): Promise<void> {
    const user = await this.users.findById(event.userId);
    if (!user) return;
    const { subject, message } = TEMPLATES[event.type](event);
    for (const channel of this.channels) {
      await channel.send({ email: user.email, name: user.name }, subject, message);
      await this.notifications.create({ userId: user.id, bookingId: event.bookingId, type: event.type, channel: channel.name, subject, message });
    }
  }
}

/** Second observer: structured audit trail of every booking state change. */
export class AuditLogListener implements BookingEventListener {
  readonly name = 'AuditLogListener';
  readonly entries: BookingEvent[] = [];

  async handle(event: BookingEvent): Promise<void> {
    this.entries.push(event);
    if (this.entries.length > 500) this.entries.shift();
    logger.info('audit.booking_event', { type: event.type, bookingId: event.bookingId, userId: event.userId, amount: event.amount });
  }
}
