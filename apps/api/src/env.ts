import { z } from 'zod';
import { SharedEnvSchema } from '@quorum/env';

/**
 * Environment is validated once, at boot, and the process refuses to start if it is
 * wrong. A service that boots with a missing secret and fails on the first request
 * that needs it turns a config error into a production incident.
 */
const EnvSchema = SharedEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
