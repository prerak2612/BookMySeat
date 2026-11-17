import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/globalSetup.ts'],
    // Integration/concurrency suites share one test database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://bookmyseat@127.0.0.1:5433/bookmyseat_test',
      JWT_SECRET: 'test-secret',
      BCRYPT_ROUNDS: '4',
      DB_POOL_MAX: '25',
      HOLD_EXPIRY_JOB_ENABLED: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
