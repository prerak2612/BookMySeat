export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
}

export enum SeatCategory {
  REGULAR = 'REGULAR',
  PREMIUM = 'PREMIUM',
  RECLINER = 'RECLINER',
}

export enum ShowStatus {
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
}

/** Seat lifecycle for a particular show: AVAILABLE -> LOCKED -> BOOKED (and back to AVAILABLE). */
export enum ShowSeatStatus {
  AVAILABLE = 'AVAILABLE',
  LOCKED = 'LOCKED',
  BOOKED = 'BOOKED',
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export enum PaymentMethod {
  CARD = 'CARD',
  UPI = 'UPI',
  WALLET = 'WALLET',
}

export enum PaymentStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}
