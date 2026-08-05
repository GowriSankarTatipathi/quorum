import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  /** Browser memory is the binding constraint: ~400 MB per Chromium context, so four
   *  fit a 2 GB machine with headroom. Every other scaling decision follows from this. */
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().min(1).max(16).default(4),
  MAX_RUN_DURATION_MS: z.coerce.number().int().positive().default(900_000),
  DEFAULT_RUN_BUDGET_USD: z.coerce.number().positive().default(0.5),
  MAX_RECOVERY_ATTEMPTS_PER_STEP: z.coerce.number().int().positive().default(4),
  MAX_RECOVERY_ATTEMPTS_PER_RUN: z.coerce.number().int().positive().default(10),
  VERIFICATION_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  APPROVAL_TIMEOUT_S: z.coerce.number().int().positive().default(1_800),

  MAX_PLAN_STEPS: z.coerce.number().int().min(1).max(30).default(20),

  BROWSER_DRIVER: z.enum(['playwright', 'browserbase', 'mock']).default('playwright'),
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MAX_BROWSER_ATTEMPTS_PER_STEP: z.coerce.number().int().min(1).max(20).default(8),
  RESPECT_ROBOTS_TXT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('quorum-artifacts'),
  R2_ENDPOINT: z.string().optional(),
  ARTIFACT_BASE_URL: z.string().default('https://artifacts.quorum.app'),
  ARTIFACT_ROOT: z.string().optional(),
  ARTIFACT_SIGNING_SECRET: z.string().optional(),

  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
