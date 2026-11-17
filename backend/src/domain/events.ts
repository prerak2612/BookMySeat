/** Domain events published (after commit) by the booking workflow and consumed by observers. */
export type BookingEventType = 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'PAYMENT_FAILED' | 'BOOKING_EXPIRED';

export interface BookingEvent {
  type: BookingEventType;
  occurredAt: Date;
  bookingId: number;
  bookingReference: string;
  userId: number;
  showId: number;
  seatLabels: string[];
  amount: number;
  reason?: string;
}
