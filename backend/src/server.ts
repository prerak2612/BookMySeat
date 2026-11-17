import { createApp } from './app.js';
import { logger } from './common/logger.js';
import { createContainer } from './container.js';
import { Database } from './db/Database.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  const container = createContainer();
  await runMigrations(container.pool, { quiet: true });
  const app = createApp(container);
  const server = app.listen(container.config.PORT, () => {
    logger.info('server.started', {
      port: container.config.PORT,
      seatLockStrategy: container.seatLockService.strategy.name,
      holdMinutes: container.config.SEAT_HOLD_MINUTES,
    });
  });
  if (container.config.HOLD_EXPIRY_JOB_ENABLED) container.holdExpiryJob.start(container.config.HOLD_EXPIRY_JOB_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info('server.stopping', { signal });
    container.holdExpiryJob.stop();
    server.close();
    await Database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
