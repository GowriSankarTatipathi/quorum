import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { MemoryCacheStore, cacheKey, isCacheable, type CacheStore } from './cache.js';
import { AllProvidersFailedError, LlmError, classifyThrown, type LlmErrorClass } from './errors.js';
import { extractJson } from './json.js';
import { MODEL_POLICY, MODELS, providerOf, type LlmAgentId, type ModelId } from './models.js';
import { ZERO_COST, price, type CallCost } from './pricing.js';
import type { CompletionRequest, ImageInput, LlmProvider } from './providers/types.js';
import { noopTelemetry, type LlmTelemetrySink } from './telemetry.js';

export interface RouterOptions {
  providers: Partial<Record<'anthropic' | 'fixture', LlmProvider>>;
  telemetry?: LlmTelemetrySink;
  cache?: CacheStore;
  cacheTtlSeconds?: number;
  /** Retries against the SAME model before switching providers. */
  retriesPerModel?: number;
  timeoutMs?: number;
  /** Pre-resolved candidate models for each agent. */
  candidates: Record<LlmAgentId, ModelId[]>;
  /** Injectable so backoff is deterministic in tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function resolveCandidateModels(
  overrides: Partial<Record<string, ModelId>>,
  providers: Partial<Record<'anthropic' | 'fixture', LlmProvider>>,
  onWarning?: (model: ModelId, reason: string) => void,
): Record<LlmAgentId, ModelId[]> {
  const resolved = {} as Record<LlmAgentId, ModelId[]>;
  const agents = Object.keys(MODEL_POLICY) as LlmAgentId[];

  for (const agent of agents) {
    const spec = MODEL_POLICY[agent];
    const hasOverride = agent in overrides && overrides[agent] !== undefined;
    const primary = overrides[agent] ?? spec.primary;
    const fallback = hasOverride ? primary : spec.fallback;
    const candidates = primary === fallback ? [primary] : [primary, fallback];

    const available: ModelId[] = [];
    for (const model of candidates) {
      if (!providers.fixture && !providers[providerOf(model)]) {
        onWarning?.(
          model,
          `No provider configured for ${providerOf(model)}; set the corresponding API key`,
        );
        continue;
      }
      available.push(model);
    }

    if (available.length === 0) {
      throw new Error(
        `No models available for agent '${agent}'. Please set QUORUM_MODEL_${agent.toUpperCase()} to an available model or configure API keys for the default models.`,
      );
    }

    resolved[agent] = [...new Set(available)];
  }

  return resolved;
}

export interface AgentCallInput {
  agent: LlmAgentId;
  promptVersion: string;
  system: string;
  user: string;
  images?: readonly ImageInput[];
  /** Overrides the policy default; used when a step needs a longer answer. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AgentCallResult<T> {
  data: T;
  model: ModelId;
  cost: CallCost;
  latencyMs: number;
  cached: boolean;
  fallbackUsed: boolean;
  /** Raw model text, retained for debugging a schema violation after the fact. */
  raw: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_CACHE_TTL_S = 3_600;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The single path every agent takes to a model.
 *
 * Responsibilities, in order: cache lookup, per-model retry with jittered exponential
 * backoff, cross-provider fallback, JSON extraction, Zod validation, cost accounting and
 * telemetry. Concentrating these here is what lets each agent be a prompt and a schema
 * rather than a hundred lines of error handling repeated seven times with variations.
 */
export class LlmRouter {
  private readonly telemetry: LlmTelemetrySink;
  private readonly cache: CacheStore;
  private readonly cacheTtlSeconds: number;
  private readonly retriesPerModel: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: RouterOptions) {
    this.telemetry = options.telemetry ?? noopTelemetry;
    this.cache = options.cache ?? new MemoryCacheStore();
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_S;
    this.retriesPerModel = options.retriesPerModel ?? DEFAULT_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  public get candidates(): Record<LlmAgentId, ModelId[]> {
    return this.options.candidates;
  }

  private providerFor(model: ModelId): LlmProvider {
    const fixture = this.options.providers.fixture;
    // A fixture provider, when present, serves every model: that is the whole point of
    // running the pipeline in CI without credentials.
    if (fixture) return fixture;
    const provider = this.options.providers[providerOf(model)];
    if (!provider) {
      throw new LlmError(
        'CONFIG',
        `No provider configured for ${providerOf(model)}; set the corresponding API key`,
        providerOf(model),
        model,
      );
    }
    return provider;
  }

  /**
   * Generic over the SCHEMA rather than over its parsed type.
   *
   * Zod carries separate input and output types, and they differ whenever a field has a
   * `.default()` or a transform. Inferring from the schema keeps the caller on the output
   * side — otherwise a defaulted boolean arrives typed as `boolean | undefined` and every
   * agent has to re-check a field the schema already guaranteed.
   */
  async call<S extends ZodTypeAny>(
    input: AgentCallInput,
    schema: S,
  ): Promise<AgentCallResult<ZodOutput<S>>> {
    const spec = MODEL_POLICY[input.agent];
    const primary = this.options.candidates[input.agent][0]!;
    const request: CompletionRequest = {
      model: primary,
      system: input.system,
      user: input.user,
      images: input.images,
      maxTokens: input.maxTokens ?? spec.maxTokens,
      temperature: spec.temperature,
      json: spec.json,
      timeoutMs: this.timeoutMs,
      signal: input.signal,
      ...(this.telemetry.onToken
        ? { onToken: (text: string) => this.telemetry.onToken?.(input.agent, text) }
        : {}),
    };

    const cacheable = isCacheable(spec.temperature);
    const key = cacheable ? await cacheKey(input.agent, request) : null;

    if (key) {
      const hit = await this.cache.get(key);
      if (hit !== null) {
        const parsed = schema.safeParse(JSON.parse(hit)) as
          { success: true; data: ZodOutput<S> } | { success: false };
        if (parsed.success) {
          await this.telemetry.recordCacheHit(input.agent, ZERO_COST);
          return {
            data: parsed.data,
            model: primary,
            cost: ZERO_COST,
            latencyMs: 0,
            cached: true,
            fallbackUsed: false,
            raw: hit,
          };
        }
        // A cached value that no longer satisfies the schema means the schema changed
        // under it. Falling through to a live call is correct; keeping it would serve
        // stale shapes until the TTL expired.
      }
    }

    const failures: { model: ModelId; errorClass: LlmErrorClass; message: string }[] = [];
    const models = this.options.candidates[input.agent];

    for (const [index, model] of models.entries()) {
      const isFallback = index > 0;
      if (isFallback) {
        const reason = failures.at(-1)?.errorClass ?? 'unknown';
        await this.telemetry.recordFallback(input.agent, primary, model, reason);
      }

      for (let attempt = 0; attempt <= this.retriesPerModel; attempt += 1) {
        try {
          const response = await this.providerFor(model).complete({ ...request, model });
          const cost = price(model, response.usage);

          let parsedJson: unknown;
          try {
            parsedJson = extractJson(response.text);
          } catch (error) {
            await this.reportViolation(input, model, [String(error)], response.text);
            failures.push({
              model,
              errorClass: 'SCHEMA_VIOLATION',
              message: 'response was not valid JSON',
            });
            // A malformed response still consumed tokens, so it is billed.
            await this.telemetry.recordCall({
              agent: input.agent,
              model,
              promptVersion: input.promptVersion,
              cost,
              latencyMs: response.latencyMs,
              cached: false,
              fallbackUsed: isFallback,
              schemaViolation: true,
              attempt,
            });
            continue;
          }

          const validated = schema.safeParse(parsedJson);
          if (!validated.success) {
            const issues = validated.error.issues.map(
              (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
            );
            await this.reportViolation(input, model, issues, response.text);
            failures.push({
              model,
              errorClass: 'SCHEMA_VIOLATION',
              message: issues.join('; '),
            });
            await this.telemetry.recordCall({
              agent: input.agent,
              model,
              promptVersion: input.promptVersion,
              cost,
              latencyMs: response.latencyMs,
              cached: false,
              fallbackUsed: isFallback,
              schemaViolation: true,
              attempt,
            });
            continue;
          }

          await this.telemetry.recordCall({
            agent: input.agent,
            model,
            promptVersion: input.promptVersion,
            cost,
            latencyMs: response.latencyMs,
            cached: false,
            fallbackUsed: isFallback,
            schemaViolation: false,
            attempt,
          });

          if (key) {
            await this.cache.set(key, JSON.stringify(validated.data), this.cacheTtlSeconds);
          }

          return {
            data: validated.data as ZodOutput<S>,
            model,
            cost,
            latencyMs: response.latencyMs,
            cached: false,
            fallbackUsed: isFallback,
            raw: response.text,
          };
        } catch (error) {
          const errorClass = classifyThrown(error);
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ model, errorClass, message });
          await this.telemetry.recordProviderFailure({
            agent: input.agent,
            model,
            errorClass,
            message,
            attempt,
          });

          const transient = error instanceof LlmError ? error.transient : false;
          if (!transient || attempt === this.retriesPerModel) break;

          // When the server says how long to wait, wait that long. Our jitter is a guess
          // at something the vendor already knows, and ignoring `retry-after` is how a
          // fleet turns one rate-limit into a sustained one.
          const serverBackoff =
            error instanceof LlmError && error.retryAfterSeconds !== undefined
              ? Math.min(error.retryAfterSeconds * 1_000, 60_000)
              : null;
          await this.sleep(serverBackoff ?? this.backoffMs(attempt));
        }
      }
    }

    throw new AllProvidersFailedError(input.agent, failures);
  }

  /** Exponential with full jitter: without jitter, every worker that hit the same 429
   *  retries in lockstep and reproduces the burst that caused it. */
  private backoffMs(attempt: number): number {
    const ceiling = Math.min(2_000 * 2 ** attempt, 20_000);
    return Math.floor(this.random() * ceiling);
  }

  private async reportViolation(
    input: AgentCallInput,
    model: ModelId,
    issues: string[],
    raw: string,
  ): Promise<void> {
    await this.telemetry.recordSchemaViolation({
      agent: input.agent,
      model,
      promptVersion: input.promptVersion,
      issues,
      rawExcerpt: raw.slice(0, 500),
    });
  }
}

export const supportsVision = (model: ModelId): boolean => MODELS[model].supportsVision;
