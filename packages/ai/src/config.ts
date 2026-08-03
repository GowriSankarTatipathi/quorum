import { z } from 'zod';
import { MODEL_IDS, type ModelId } from './models.js';

/**
 * LLM configuration, read from the environment and validated once.
 *
 * No secret is ever a default, a fallback or a literal in this repository. A key is
 * present or it is not, and the absence changes which provider is constructed rather than
 * being papered over — a run that silently used a different model than you configured is
 * worse than one that refused to start.
 */
/**
 * An unset variable and one set to the empty string mean the same thing here.
 *
 * `.env.example` ships `ANTHROPIC_API_KEY=` so the file documents the variable without
 * containing a secret, and `FOO=$UNSET` in a shell expands to empty. Rejecting empty would
 * make copying the template a hard crash; treating it as absent falls back to recorded
 * mode, which is the honest interpretation of "no key was provided".
 */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  });

const LlmEnvSchema = z.object({
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),

  /** Per-agent model overrides, so a deployment can retune without a code change. */
  QUORUM_MODEL_PLANNER: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_BROWSER: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_REASONING: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_VERIFICATION: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_CRITIC: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_RECOVERY: z.enum(MODEL_IDS).optional(),
  QUORUM_MODEL_FORMATTER: z.enum(MODEL_IDS).optional(),

  LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(60_000),
  LLM_CACHE_TTL_S: z.coerce.number().int().min(0).default(3_600),
  LLM_RETRIES_PER_MODEL: z.coerce.number().int().min(0).max(5).default(2),

  /**
   * Forces the recorded-response provider even when a key is present. Used by CI, which
   * must never depend on a vendor being up or spend money on a pull request.
   */
  QUORUM_LLM_MODE: z.enum(['auto', 'live', 'recorded']).default('auto'),
});

export type LlmEnv = z.infer<typeof LlmEnvSchema>;

export interface LlmConfig {
  mode: 'live' | 'recorded';
  anthropic: { apiKey: string; baseUrl: string } | null;
  openai: { apiKey: string; baseUrl: string } | null;
  modelOverrides: Partial<Record<string, ModelId>>;
  timeoutMs: number;
  cacheTtlSeconds: number;
  retriesPerModel: number;
  /** Explains, in one sentence, why the mode is what it is. Logged at boot. */
  reason: string;
}

export function loadLlmConfig(source: NodeJS.ProcessEnv = process.env): LlmConfig {
  const parsed = LlmEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid LLM configuration:\n${issues}`);
  }
  const env = parsed.data;

  const anthropic = env.ANTHROPIC_API_KEY
    ? { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL }
    : null;
  const openai = env.OPENAI_API_KEY
    ? { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL }
    : null;

  let mode: 'live' | 'recorded';
  let reason: string;

  if (env.QUORUM_LLM_MODE === 'recorded') {
    mode = 'recorded';
    reason = 'QUORUM_LLM_MODE=recorded — using recorded responses regardless of any key.';
  } else if (env.QUORUM_LLM_MODE === 'live') {
    if (!anthropic && !openai) {
      throw new Error(
        'QUORUM_LLM_MODE=live but no provider key is set. Export ANTHROPIC_API_KEY (or OPENAI_API_KEY) and try again.',
      );
    }
    mode = 'live';
    reason = 'QUORUM_LLM_MODE=live — calling the vendor API.';
  } else if (anthropic || openai) {
    mode = 'live';
    const providers = [anthropic ? 'Anthropic' : null, openai ? 'OpenAI' : null]
      .filter(Boolean);
    const primary = providers[0]!;
    const fallbackNote = providers.length > 1
      ? ` with ${providers[1]!} as fallback`
      : ' (no fallback provider configured)';
    reason = `${primary} key is set — calling the vendor API${fallbackNote}.`;
  } else {
    mode = 'recorded';
    reason =
      'No provider key found — using recorded responses. Export ANTHROPIC_API_KEY or OPENAI_API_KEY to run against a real model.';
  }

  return {
    mode,
    anthropic,
    openai,
    modelOverrides: {
      planner: env.QUORUM_MODEL_PLANNER,
      browser: env.QUORUM_MODEL_BROWSER,
      reasoning: env.QUORUM_MODEL_REASONING,
      verification: env.QUORUM_MODEL_VERIFICATION,
      critic: env.QUORUM_MODEL_CRITIC,
      recovery: env.QUORUM_MODEL_RECOVERY,
      formatter: env.QUORUM_MODEL_FORMATTER,
    },
    timeoutMs: env.LLM_TIMEOUT_MS,
    cacheTtlSeconds: env.LLM_CACHE_TTL_S,
    retriesPerModel: env.LLM_RETRIES_PER_MODEL,
    reason,
  };
}

/** Redacts everything secret. Safe to log at boot and to include in a support bundle. */
export function describeLlmConfig(config: LlmConfig): string {
  const providers = [
    config.anthropic ? `anthropic(${maskKey(config.anthropic.apiKey)})` : null,
    config.openai ? `openai(${maskKey(config.openai.apiKey)})` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `mode=${config.mode} providers=[${providers || 'none'}] timeout=${String(config.timeoutMs)}ms`;
}

function maskKey(key: string): string {
  // Enough to tell two keys apart in a log, never enough to use one.
  return key.length <= 8 ? '****' : `${key.slice(0, 4)}…${key.slice(-2)}`;
}
