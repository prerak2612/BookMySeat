import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError, HoldExpiredError } from '../../src/common/errors.js';
import { Booking, BookingBuilder, type BookingProps } from '../../src/domain/Booking.js';
import { BookingStatus, SeatCategory, ShowSeatStatus, ShowStatus, UserRole } from '../../src/domain/enums.js';
import { Show } from '../../src/domain/Show.js';
import { ShowSeat } from '../../src/domain/ShowSeat.js';
import { Admin, Customer, UserFactory } from '../../src/domain/User.js';

const NOW = new Date('2026-12-02T10:00:00Z');
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

const seat = (over: Partial<ConstructorParameters<typeof ShowSeat>[0]> = {}) =>
  new ShowSeat({
    id: 1,
    showId: 1,
    seatId: 10,
    rowLabel: 'A',
    seatNumber: 1,
    category: SeatCategory.REGULAR,
    status: ShowSeatStatus.AVAILABLE,
    bookingId: null,
    lockExpiresAt: null,
    version: 0,
    ...over,
  });

const show = (startInMinutes: number) =>
  new Show({ id: 1, movieId: 1, screenId: 1, startTime: minutes(startInMinutes), endTime: minutes(startInMinutes + 150), basePrice: 200, status: ShowStatus.SCHEDULED });

const booking = (over: Partial<BookingProps> = {}) =>
  new Booking({
    id: 7,
    reference: 'BMS-TEST0001',
    userId: 1,
    showId: 1,
    status: BookingStatus.PENDING,
    subtotal: 200,
    totalAmount: 271.4,
    priceBreakdown: [],
    idempotencyKey: null,
    expiresAt: minutes(5),
    confirmedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    seats: [{ showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 200, isActive: true }],
    ...over,
  });

describe('ShowSeat state machine', () => {
  it('AVAILABLE -> LOCKED -> BOOKED -> AVAILABLE', () => {
    const s = seat();
    s.lock(7, minutes(5), NOW);
    expect(s.status).toBe(ShowSeatStatus.LOCKED);
    expect(s.isHeldBy(7, NOW)).toBe(true);
    s.book(7, NOW);
    expect(s.status).toBe(ShowSeatStatus.BOOKED);
    expect(s.lockExpiresAt).toBeNull();
    s.release();
    expect(s.status).toBe(ShowSeatStatus.AVAILABLE);
    expect(s.bookingId).toBeNull();
  });

  it('cannot lock a seat that is validly locked or booked', () => {
    expect(() => seat({ status: ShowSeatStatus.LOCKED, bookingId: 3, lockExpiresAt: minutes(1) }).lock(7, minutes(5), NOW)).toThrow();
    expect(() => seat({ status: ShowSeatStatus.BOOKED, bookingId: 3 }).lock(7, minutes(5), NOW)).toThrow();
  });

  it('treats an expired lock as available and reports it as AVAILABLE', () => {
    const s = seat({ status: ShowSeatStatus.LOCKED, bookingId: 3, lockExpiresAt: minutes(-1) });
    expect(s.hasExpiredLock(NOW)).toBe(true);
    expect(s.isAvailableAt(NOW)).toBe(true);
    expect(s.effectiveStatus(NOW)).toBe(ShowSeatStatus.AVAILABLE);
    expect(s.isHeldBy(3, NOW)).toBe(false);
  });

  it('cannot book a seat held by another booking', () => {
    const s = seat({ status: ShowSeatStatus.LOCKED, bookingId: 3, lockExpiresAt: minutes(5) });
    expect(() => s.book(7, NOW)).toThrow(/not held/);
  });
});

describe('Booking aggregate', () => {
  it('confirms a valid pending hold', () => {
    const b = booking();
    b.confirm(NOW);
    expect(b.status).toBe(BookingStatus.CONFIRMED);
    expect(b.confirmedAt).toEqual(NOW);
  });

  it('refuses to confirm an expired hold or an already confirmed booking', () => {
    expect(() => booking({ expiresAt: minutes(-1) }).confirm(NOW)).toThrow(HoldExpiredError);
    expect(() => booking({ status: BookingStatus.CONFIRMED, confirmedAt: NOW }).confirm(NOW)).toThrow(ConflictError);
    expect(() => booking({ status: BookingStatus.FAILED }).confirm(NOW)).toThrow(ConflictError);
  });

  it('terminal transitions deactivate the reservation lines', () => {
    const b = booking();
    b.markPaymentFailed();
    expect(b.status).toBe(BookingStatus.FAILED);
    expect(b.seats.every((s) => !s.isActive)).toBe(true);
    expect(() => b.expire()).toThrow(/Illegal booking transition/);
  });

  it('pending holds can be abandoned without refund', () => {
    expect(booking().cancel(NOW, show(600), 120)).toEqual({ refundRequired: false });
  });

  it('confirmed bookings can be cancelled until the cut-off, with refund', () => {
    const b = booking({ status: BookingStatus.CONFIRMED, confirmedAt: NOW });
    expect(b.isCancellable(NOW, show(120), 120)).toBe(true);
    expect(b.cancel(NOW, show(120), 120)).toEqual({ refundRequired: true });
    expect(b.status).toBe(BookingStatus.CANCELLED);
  });

  it('confirmed bookings inside the cut-off window cannot be cancelled', () => {
    const b = booking({ status: BookingStatus.CONFIRMED, confirmedAt: NOW });
    expect(b.isCancellable(NOW, show(119), 120)).toBe(false);
    expect(() => b.cancel(NOW, show(119), 120)).toThrow(BusinessRuleError);
    expect(b.status).toBe(BookingStatus.CONFIRMED);
  });
});

describe('BookingBuilder', () => {
  const base = () =>
    new BookingBuilder()
      .forUser(1)
      .forShow(2)
      .withPricing(200, 236, [{ label: 'Tickets (1)', amount: 200 }])
      .holdUntil(minutes(5));

  it('builds a complete draft with a generated reference', () => {
    const draft = base().withSeat({ showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 200 }).withIdempotencyKey('k-123456').build();
    expect(draft.reference).toMatch(/^BMS-[A-Z2-9]{8}$/);
    expect(draft).toMatchObject({ userId: 1, showId: 2, totalAmount: 236, idempotencyKey: 'k-123456' });
  });

  it('rejects incomplete or inconsistent drafts', () => {
    expect(() => base().build()).toThrow(/at least one seat/);
    const dup = { showSeatId: 1, seatLabel: 'A1', category: 'REGULAR', price: 200 };
    expect(() => base().withSeat(dup).withSeat(dup).build()).toThrow(/duplicate/);
    expect(() => new BookingBuilder().forShow(1).withSeat(dup).build()).toThrow(/user is required/);
  });
});

describe('User hierarchy (polymorphism)', () => {
  const props = { id: 1, name: 'N', email: 'n@x.dev', passwordHash: 'h', role: UserRole.CUSTOMER, createdAt: NOW };

  it('the factory returns the right subclass', () => {
    expect(UserFactory.create({ ...props, role: UserRole.ADMIN })).toBeInstanceOf(Admin);
    expect(UserFactory.create({ ...props, role: UserRole.CUSTOMER })).toBeInstanceOf(Customer);
  });

  it('authorisation is answered by the subclass', () => {
    const admin = new Admin(props);
    const customer = new Customer({ ...props, id: 2 });
    expect(admin.canManageCatalog()).toBe(true);
    expect(customer.canManageCatalog()).toBe(false);
    expect(customer.canAccessBookingOf(2)).toBe(true);
    expect(customer.canAccessBookingOf(99)).toBe(false);
    expect(admin.canAccessBookingOf(99)).toBe(true);
    expect(JSON.stringify(customer.toPublic())).not.toContain('passwordHash');
  });
});

describe('Show', () => {
  it('is bookable only while scheduled and not yet started', () => {
    expect(show(10).isBookableAt(NOW)).toBe(true);
    expect(show(-1).isBookableAt(NOW)).toBe(false);
    expect(() => new Show({ id: 1, movieId: 1, screenId: 1, startTime: NOW, endTime: NOW, basePrice: 1, status: ShowStatus.SCHEDULED })).toThrow();
  });
});
