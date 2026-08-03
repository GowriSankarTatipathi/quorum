import pino, { type Logger } from 'pino';
import { env } from './env.js';

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker', env: env.NODE_ENV, workerId: process.env.FLY_MACHINE_ID ?? 'local' },
  redact: {
    paths: ['apiKey', '*.apiKey', 'password', '*.password', 'cookies', '*.cookies'],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});
