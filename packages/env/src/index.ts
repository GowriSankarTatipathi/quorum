import { z } from 'zod';

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const SharedEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Redis
  REDIS_URL: z.string().url(),

  // Artifact Storage
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('quorum-artifacts'),
  R2_ENDPOINT: z.string().optional(),
  ARTIFACT_BASE_URL: z.string().default('https://artifacts.quorum.app'),
  ARTIFACT_ROOT: z.string().optional(),
  ARTIFACT_SIGNING_SECRET: z.string().optional(),

  // API
  API_ORIGIN: z.string().url().default('http://localhost:3001'),

  // LLM Config
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),

  QUORUM_MODEL_PLANNER: z.string().optional(),
  QUORUM_MODEL_BROWSER: z.string().optional(),
  QUORUM_MODEL_REASONING: z.string().optional(),
  QUORUM_MODEL_VERIFICATION: z.string().optional(),
  QUORUM_MODEL_CRITIC: z.string().optional(),
  QUORUM_MODEL_RECOVERY: z.string().optional(),
  QUORUM_MODEL_FORMATTER: z.string().optional(),

  LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(60_000),
  LLM_CACHE_TTL_S: z.coerce.number().int().min(0).default(3_600),
  LLM_RETRIES_PER_MODEL: z.coerce.number().int().min(0).max(5).default(2),
  QUORUM_LLM_MODE: z.enum(['auto', 'live', 'recorded']).default('auto'),
});

export type SharedEnv = z.infer<typeof SharedEnvSchema>;
