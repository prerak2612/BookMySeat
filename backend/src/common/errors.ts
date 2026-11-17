/**
 * Application error hierarchy.
 *
 * Inheritance + polymorphism: every subclass carries its own HTTP status and machine-readable
 * code, so the centralized error handler can treat all of them uniformly through the base type
 * (Liskov Substitution - any AppError can stand in for another).
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toJSON(): { code: string; message: string; details?: unknown } {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to perform this action', details?: unknown) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(resource: string, id?: string | number) {
    super(id === undefined ? `${resource} not found` : `${resource} with id ${id} not found`);
  }
}

export class ConflictError extends AppError {
  readonly statusCode: number = 409;
  readonly code: string = 'CONFLICT';
}

/** Raised when one or more requested seats are no longer available (lost the race). */
export class SeatUnavailableError extends ConflictError {
  override readonly code = 'SEAT_UNAVAILABLE';
  constructor(seatIds: number[]) {
    super('One or more selected seats are no longer available', { seatIds });
  }
}

/** Raised when a seat hold has expired before payment completed. */
export class HoldExpiredError extends ConflictError {
  override readonly statusCode = 410;
  override readonly code = 'HOLD_EXPIRED';
  constructor(bookingId: number) {
    super('Your seat hold has expired. Please select seats again.', { bookingId });
  }
}

export class BusinessRuleError extends AppError {
  readonly statusCode = 422;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

export class PaymentFailedError extends AppError {
  readonly statusCode = 402;
  readonly code = 'PAYMENT_FAILED';
}
