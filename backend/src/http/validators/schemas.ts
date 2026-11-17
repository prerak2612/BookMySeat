/**
 * Request validation schemas (zod). Every external input is validated at the HTTP boundary before
 * it reaches a service; services additionally enforce business rules.
 */
import { z } from 'zod';
import { PaymentMethod, SeatCategory } from '../../domain/enums.js';

const id = z.coerce.number().int().positive();
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const IdParam = z.object({ id });

export const RegisterBody = z.object({
  name: trimmed(2, 100),
  email: z.string().trim().toLowerCase().pipe(z.email({ message: 'Invalid email address' })),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72)
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a digit'),
});

export const LoginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: 'Invalid email address' })),
  password: z.string().min(1, 'Password is required'),
});

export const MovieQuery = z.object({
  q: z.string().trim().max(100).optional(),
  genre: z.string().trim().max(50).optional(),
  language: z.string().trim().max(50).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const MovieBody = z.object({
  title: trimmed(1, 200),
  description: z.string().max(5000).default(''),
  durationMinutes: z.number().int().min(1).max(600),
  language: trimmed(1, 50),
  genre: trimmed(1, 50),
  certificate: z.enum(['U', 'UA', 'A', 'S']).default('UA'),
  releaseDate: isoDate,
  posterUrl: z.url().max(1000).nullable().default(null),
  isActive: z.boolean().optional(),
});

export const MovieUpdateBody = MovieBody.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const TheatreQuery = z.object({ city: z.string().trim().max(100).optional() });

export const TheatreBody = z.object({
  name: trimmed(2, 150),
  city: trimmed(2, 100),
  address: trimmed(2, 300),
});

export const ScreenBody = z.object({
  name: trimmed(1, 50),
  layout: z.union([
    z.object({ preset: z.enum(['SMALL', 'MEDIUM', 'LARGE']) }),
    z.object({
      rows: z
        .array(
          z.object({
            label: z.string().trim().regex(/^[A-Za-z]{1,3}$/, 'Row label must be 1-3 letters'),
            seats: z.number().int().min(1).max(40),
            category: z.enum(SeatCategory),
          }),
        )
        .min(1)
        .max(30),
    }),
  ]),
});

export const ShowQuery = z.object({
  date: isoDate.optional(),
  city: z.string().trim().max(100).optional(),
  theatreId: id.optional(),
});

export const ShowBody = z.object({
  movieId: id,
  screenId: id,
  startTime: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  basePrice: z.number().positive().max(10000),
});

export const HoldBody = z.object({
  showId: id,
  seatIds: z.array(id).min(1, 'Select at least one seat').max(50),
});

export const PaymentBody = z.object({
  method: z.enum(PaymentMethod),
  details: z.record(z.string(), z.string().max(100)).default({}),
});

export const AdminBookingsQuery = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const IdempotencyKeyHeader = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/).optional();
