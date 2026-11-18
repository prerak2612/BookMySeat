import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive a real browser against the real backend + database.
 * Prerequisites: PostgreSQL running and seeded (`npm run db:reset` in backend/).
 * Playwright starts both servers automatically (or reuses already-running ones).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm --prefix ../backend start', url: 'http://localhost:4000/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
