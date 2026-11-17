import { config } from '../config/env.js';

const LEVELS = { silent: 0, error: 1, info: 2, debug: 3 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[config.LOG_LEVEL] < LEVELS[level]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
