import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  modelOverrides: Partial<Record<string, ModelId>>;
  timeoutMs: number;
  cacheTtlSeconds: number;
  retriesPerModel: number;
  /** Explains, in one sentence, why the mode is what it is. Logged at boot. */
  reason: string;
  /** Provenance of each resolved configuration value for transparent logging. */
  provenance: string[];
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

  // Manual .env.local parse for provenance tracking.
  const envLocalKeys = new Set<string>();
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        envLocalKeys.add(trimmed.slice(0, idx).trim());
      }
    }
  } catch {
    // Ignore if not present or readable.
  }

  const getSource = (key: string, value: unknown) => {
    if (value === undefined || value === null) return 'schema_default';
    if (envLocalKeys.has(key)) return '.env.local';
    if (source[key] !== undefined) return 'env_inherited';
    return 'schema_default';
  };

  const provenance: string[] = [];
  const track = (key: string, value: unknown, mask = false) => {
    const src = getSource(key, value);
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const displayValue = (value === undefined || value === null) ? 'unset' : (mask ? maskKey(stringValue) : stringValue);
    provenance.push(`${key}=${displayValue} (from ${src})`);
  };

  track('ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY, true);
  track('ANTHROPIC_BASE_URL', env.ANTHROPIC_BASE_URL);
  track('QUORUM_MODEL_PLANNER', env.QUORUM_MODEL_PLANNER);
  track('QUORUM_MODEL_BROWSER', env.QUORUM_MODEL_BROWSER);
  track('QUORUM_MODEL_REASONING', env.QUORUM_MODEL_REASONING);
  track('QUORUM_MODEL_VERIFICATION', env.QUORUM_MODEL_VERIFICATION);
  track('QUORUM_MODEL_CRITIC', env.QUORUM_MODEL_CRITIC);
  track('QUORUM_MODEL_RECOVERY', env.QUORUM_MODEL_RECOVERY);
  track('QUORUM_MODEL_FORMATTER', env.QUORUM_MODEL_FORMATTER);

  const anthropic = env.ANTHROPIC_API_KEY
    ? { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL }
    : null;

  let mode: 'live' | 'recorded';
  let reason: string;

  if (env.QUORUM_LLM_MODE === 'recorded') {
    mode = 'recorded';
    reason = 'QUORUM_LLM_MODE=recorded — using recorded responses regardless of any key.';
  } else if (env.QUORUM_LLM_MODE === 'live') {
    if (!anthropic) {
      throw new Error(
        'QUORUM_LLM_MODE=live but no provider key is set. Export ANTHROPIC_API_KEY and try again.',
      );
    }
    mode = 'live';
    reason = 'QUORUM_LLM_MODE=live — calling the vendor API.';
  } else if (anthropic) {
    mode = 'live';
    reason = 'Anthropic key is set — calling the vendor API.';
  } else {
    mode = 'recorded';
    reason =
      'No provider key found — using recorded responses. Export ANTHROPIC_API_KEY to run against a real model.';
  }

  return {
    mode,
    anthropic,
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
    provenance,
  };
}

/** Redacts everything secret. Safe to log at boot and to include in a support bundle. */
export function describeLlmConfig(config: LlmConfig): string {
  const providers = [
    config.anthropic ? `anthropic(${maskKey(config.anthropic.apiKey)})` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `mode=${config.mode} providers=[${providers || 'none'}] timeout=${String(config.timeoutMs)}ms`;
}

function maskKey(key: string): string {
  // Enough to tell two keys apart in a log, never enough to use one.
  return key.length <= 8 ? '****' : `${key.slice(0, 4)}…${key.slice(-2)}`;
}
