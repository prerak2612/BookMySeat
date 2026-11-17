import { z } from 'zod';

/**
 * Typed, validated application configuration.
 * Parsed once at start-up so a misconfiguration fails fast instead of at first use.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgres://bookmyseat@127.0.0.1:5433/bookmyseat'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  JWT_SECRET: z.string().min(1).default('dev-only-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  SEAT_LOCK_STRATEGY: z.enum(['PESSIMISTIC', 'OPTIMISTIC']).default('PESSIMISTIC'),
  SEAT_HOLD_MINUTES: z.coerce.number().positive().default(5),
  MAX_SEATS_PER_BOOKING: z.coerce.number().int().positive().default(10),
  CANCELLATION_CUTOFF_MINUTES: z.coerce.number().int().nonnegative().default(120),
  PRICING_STRATEGY: z.enum(['CATEGORY', 'FLAT']).default('CATEGORY'),
  CONVENIENCE_FEE_PER_SEAT: z.coerce.number().nonnegative().default(30),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0.18),
  WEEKEND_SURCHARGE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  HOLD_EXPIRY_JOB_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  HOLD_EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['silent', 'error', 'info', 'debug']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}

export const config: AppConfig = loadConfig();
