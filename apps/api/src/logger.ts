import pino, { type Logger } from 'pino';
import { env } from './env.js';

/**
 * Every log line carries the run/step/correlation identifiers. Debugging a failed run
 * means reconstructing a story that spans a browser action, three LLM calls and a UI
 * event; without a shared id that is archaeology, with one it is a single query.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'apiKey',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});
