import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { isRetryableDbError } from '../../src/db/TransactionManager.js';
import { loadConfig } from '../../src/config/env.js';
import { HoldBody, IdempotencyKeyHeader, MovieBody, PaymentBody, RegisterBody, ScreenBody, ShowBody } from '../../src/http/validators/schemas.js';

describe('request validation schemas', () => {
  it('RegisterBody normalises e-mail and enforces password strength', () => {
    expect(RegisterBody.parse({ name: ' Ravi ', email: ' RAVI@Mail.com ', password: 'abc12345' })).toEqual({ name: 'Ravi', email: 'ravi@mail.com', password: 'abc12345' });
    expect(() => RegisterBody.parse({ name: 'Ravi', email: 'ravi@mail.com', password: 'abcdefgh' })).toThrow(ZodError);
    expect(() => RegisterBody.parse({ name: 'Ravi', email: 'ravi@mail.com', password: '12345678' })).toThrow(ZodError);
  });

  it('HoldBody requires 1..50 positive integer seat ids', () => {
    expect(HoldBody.parse({ showId: '3', seatIds: [1, 2] })).toEqual({ showId: 3, seatIds: [1, 2] });
    expect(() => HoldBody.parse({ showId: 3, seatIds: [] })).toThrow(ZodError);
    expect(() => HoldBody.parse({ showId: 3, seatIds: [-1] })).toThrow(ZodError);
    expect(() => HoldBody.parse({ showId: 3, seatIds: [1.5] })).toThrow(ZodError);
  });

  it('PaymentBody only accepts supported methods', () => {
    expect(PaymentBody.parse({ method: 'UPI', details: { upiId: 'a@b' } }).method).toBe('UPI');
    expect(() => PaymentBody.parse({ method: 'CASH' })).toThrow(ZodError);
  });

  it('ShowBody requires an ISO timestamp with offset and positive price', () => {
    expect(ShowBody.parse({ movieId: 1, screenId: 2, startTime: '2026-12-01T10:00:00Z', basePrice: 200 }).startTime).toBeInstanceOf(Date);
    expect(() => ShowBody.parse({ movieId: 1, screenId: 2, startTime: 'tomorrow', basePrice: 200 })).toThrow(ZodError);
    expect(() => ShowBody.parse({ movieId: 1, screenId: 2, startTime: '2026-12-01T10:00:00Z', basePrice: 0 })).toThrow(ZodError);
  });

  it('MovieBody applies defaults and validates the release date', () => {
    const m = MovieBody.parse({ title: 'X', durationMinutes: 90, language: 'Hindi', genre: 'Drama', releaseDate: '2026-01-01' });
    expect(m).toMatchObject({ certificate: 'UA', description: '', posterUrl: null });
    expect(() => MovieBody.parse({ ...m, releaseDate: '01/01/2026' })).toThrow(ZodError);
    expect(() => MovieBody.parse({ ...m, durationMinutes: 0 })).toThrow(ZodError);
  });

  it('ScreenBody accepts a preset or explicit rows', () => {
    expect(ScreenBody.parse({ name: 'S1', layout: { preset: 'LARGE' } }).layout).toEqual({ preset: 'LARGE' });
    expect(() => ScreenBody.parse({ name: 'S1', layout: { rows: [{ label: 'A1', seats: 5, category: 'REGULAR' }] } })).toThrow(ZodError);
  });

  it('Idempotency-Key must be 8-100 safe characters', () => {
    expect(IdempotencyKeyHeader.parse(undefined)).toBeUndefined();
    expect(IdempotencyKeyHeader.parse('abc-1234_X')).toBe('abc-1234_X');
    expect(() => IdempotencyKeyHeader.parse('short')).toThrow(ZodError);
    expect(() => IdempotencyKeyHeader.parse('has spaces in it')).toThrow(ZodError);
  });
});

describe('configuration & infrastructure helpers', () => {
  it('rejects invalid configuration at start-up', () => {
    expect(() => loadConfig({ SEAT_LOCK_STRATEGY: 'MAGIC' })).toThrow(/Invalid configuration/);
    expect(loadConfig({ SEAT_HOLD_MINUTES: '2' }).SEAT_HOLD_MINUTES).toBe(2);
  });

  it('classifies retryable PostgreSQL errors', () => {
    expect(isRetryableDbError({ code: '40P01' })).toBe(true);
    expect(isRetryableDbError({ code: '40001' })).toBe(true);
    expect(isRetryableDbError({ code: '23505' })).toBe(false);
    expect(isRetryableDbError(null)).toBe(false);
  });
});
