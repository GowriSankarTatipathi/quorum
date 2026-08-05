import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryCacheStore } from './cache.js';
import { AllProvidersFailedError, LlmError } from './errors.js';
import { FixtureProvider, type RecordedCompletion } from './providers/fixture.js';
import type { LlmProvider } from './providers/types.js';
import { LlmRouter, resolveCandidateModels } from './router.js';
import type {
  LlmCallTelemetry,
  LlmTelemetrySink,
  ProviderFailureTelemetry,
  SchemaViolationTelemetry,
} from './telemetry.js';
import type { LlmAgentId, ModelId } from './models.js';

const Schema = z.object({ answer: z.string(), score: z.number() });

class RecordingTelemetry implements LlmTelemetrySink {
  readonly calls: LlmCallTelemetry[] = [];
  readonly violations: SchemaViolationTelemetry[] = [];
  readonly failures: ProviderFailureTelemetry[] = [];
  readonly fallbacks: { from: string; to: string; reason: string }[] = [];
  cacheHits = 0;
  readonly tokens: string[] = [];

  recordCall(t: LlmCallTelemetry) {
    this.calls.push(t);
  }
  recordSchemaViolation(t: SchemaViolationTelemetry) {
    this.violations.push(t);
  }
  recordProviderFailure(t: ProviderFailureTelemetry) {
    this.failures.push(t);
  }
  recordFallback(_agent: string, from: string, to: string, reason: string) {
    this.fallbacks.push({ from, to, reason });
  }
  recordCacheHit() {
    this.cacheHits += 1;
  }
  onToken(_agent: string, text: string) {
    this.tokens.push(text);
  }
}

const ok = (text: string, times?: number): RecordedCompletion => ({
  match: () => true,
  respond: { kind: 'text', text },
  ...(times === undefined ? {} : { times }),
});

const fail = (error: LlmError, times?: number): RecordedCompletion => ({
  match: () => true,
  respond: { kind: 'error', error },
  ...(times === undefined ? {} : { times }),
});

const transient = () =>
  new LlmError('RATE_LIMITED', 'slow down', 'anthropic', 'claude-sonnet-4-5-20250929', { status: 429 });
const permanent = () =>
  new LlmError('AUTH', 'bad key', 'anthropic', 'claude-sonnet-4-5-20250929', { status: 401 });

function makeRouter(
  recordings: RecordedCompletion[],
  over: Partial<ConstructorParameters<typeof LlmRouter>[0]> = {},
) {
  const provider = new FixtureProvider(recordings);
  const telemetry = new RecordingTelemetry();
  const candidates = over.candidates ?? resolveCandidateModels({}, { fixture: provider });
  const router = new LlmRouter({
    providers: { fixture: provider },
    telemetry,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    candidates,
    ...over,
  });
  return { router, provider, telemetry };
}

const call = (router: LlmRouter) =>
  router.call(
    {
      agent: 'reasoning',
      promptVersion: 'reasoning.v4',
      system: 'system',
      user: 'user',
    },
    Schema,
  );

describe('resolveCandidateModels', () => {
  const dummyProvider = {} as LlmProvider;

  it('an override replaces the primary model', () => {
    const resolved = resolveCandidateModels(
      { reasoning: 'claude-haiku-4-5-20251001' },
      { fixture: dummyProvider }
    );
    // Overridden primary disables the default fallback.
    expect(resolved.reasoning).toEqual(['claude-haiku-4-5-20251001']);
  });



  it('an empty candidate list raises at construction', () => {
    // If we have no providers, we have no candidates for reasoning.
    expect(() =>
      resolveCandidateModels(
        { reasoning: 'claude-opus-4-5-20251101' },
        {}
      )
    ).toThrow(/No models available for agent 'planner'/);
  });

  it('de-duplicates models, preserving order', () => {
    // Override reasoning to 'claude-haiku-4-5-20251001' which is also its fallback
    const resolved = resolveCandidateModels(
      { reasoning: 'claude-haiku-4-5-20251001' },
      { anthropic: dummyProvider }
    );
    expect(resolved.reasoning).toEqual(['claude-haiku-4-5-20251001']);
  });

  it('no override leaves MODEL_POLICY behaviour unchanged', () => {
    const resolved = resolveCandidateModels({}, { anthropic: dummyProvider });
    expect(resolved.reasoning).toEqual(['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']);
  });
});

describe('happy path', () => {
  it('returns validated data with cost and model attribution', async () => {
    const { router, telemetry } = makeRouter([ok('{"answer":"yes","score":1}')]);
    const result = await call(router);

    expect(result.data).toEqual({ answer: 'yes', score: 1 });
    expect(result.model).toBe('claude-sonnet-4-5-20250929');
    expect(result.cached).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.cost.usd).toBeGreaterThan(0);
    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]?.promptVersion).toBe('reasoning.v4');
  });

  it('recovers JSON wrapped in a markdown fence', async () => {
    const { router } = makeRouter([ok('```json\n{"answer":"yes","score":2}\n```')]);
    expect((await call(router)).data.score).toBe(2);
  });

  it('streams token deltas to telemetry when a sink wants them', async () => {
    const { router, telemetry } = makeRouter([ok('{"answer":"streamed","score":3}')]);
    await call(router);
    expect(telemetry.tokens.length).toBeGreaterThan(0);
    expect(telemetry.tokens.join('')).toBe('{"answer":"streamed","score":3}');
  });
});

describe('retry and fallback', () => {
  it('retries a transient failure against the same model before giving up on it', async () => {
    const { router, provider } = makeRouter([
      fail(transient(), 1),
      ok('{"answer":"ok","score":1}'),
    ]);
    const result = await call(router);
    expect(result.data.answer).toBe('ok');
    expect(provider.calls).toHaveLength(2);
    expect(result.fallbackUsed).toBe(false);
  });

  it('does NOT retry a permanent failure — three auth errors only delay the truth', async () => {
    const { router, provider, telemetry } = makeRouter([fail(permanent())]);
    await expect(call(router)).rejects.toBeInstanceOf(AllProvidersFailedError);
    // One attempt per model, no retries: primary then fallback.
    expect(provider.calls).toHaveLength(2);
    expect(telemetry.failures.every((f) => f.errorClass === 'AUTH')).toBe(true);
  });

  it('falls back to the other provider once retries are exhausted', async () => {
    const { router, telemetry } = makeRouter([
      fail(transient(), 3),
      ok('{"answer":"fallback","score":9}'),
    ]);
    const result = await call(router);
    expect(result.data.answer).toBe('fallback');
    expect(result.fallbackUsed).toBe(true);
    expect(telemetry.fallbacks).toHaveLength(1);
    expect(telemetry.fallbacks[0]?.to).toBe('claude-haiku-4-5-20251001');
  });

  it('throws AllProvidersFailedError listing every model it tried', async () => {
    const { router } = makeRouter([fail(transient())]);
    await expect(call(router)).rejects.toMatchObject({
      name: 'AllProvidersFailedError',
    });
    try {
      await call(router);
    } catch (error) {
      const attempts = (error as AllProvidersFailedError).attempts;
      expect(attempts.map((a) => a.model)).toContain('claude-sonnet-4-5-20250929');
      expect(attempts.map((a) => a.model)).toContain('claude-haiku-4-5-20251001');
    }
  });
});

describe('schema validation at the boundary', () => {
  it('treats a structurally wrong response as a violation and switches provider', async () => {
    const { router, telemetry } = makeRouter([
      ok('{"answer":"yes"}', 3),
      ok('{"answer":"yes","score":5}'),
    ]);
    const result = await call(router);
    expect(result.data.score).toBe(5);
    expect(telemetry.violations.length).toBeGreaterThan(0);
    expect(telemetry.violations[0]?.issues.join()).toMatch(/score/);
  });

  it('bills a schema-violating response, because it still consumed tokens', async () => {
    const { router, telemetry } = makeRouter([
      ok('{"answer":"yes"}', 1),
      ok('{"answer":"yes","score":1}'),
    ]);
    await call(router);
    const violating = telemetry.calls.find((c) => c.schemaViolation);
    expect(violating).toBeDefined();
    expect(violating?.cost.usd).toBeGreaterThan(0);
  });

  it('reports non-JSON output as a violation with the raw text kept for debugging', async () => {
    const { router, telemetry } = makeRouter([
      ok('I refuse to answer.', 4),
      ok('{"answer":"ok","score":1}'),
    ]);
    await call(router);
    expect(telemetry.violations[0]?.rawExcerpt).toContain('I refuse');
  });
});

describe('caching', () => {
  it('serves an identical deterministic call from cache at zero cost', async () => {
    const cache = new MemoryCacheStore();
    const { router, provider, telemetry } = makeRouter([ok('{"answer":"cached","score":1}')], {
      cache,
    });
    await call(router);
    const second = await call(router);

    expect(second.cached).toBe(true);
    expect(second.cost.usd).toBe(0);
    expect(provider.calls).toHaveLength(1);
    expect(telemetry.cacheHits).toBe(1);
  });

  it('does not cache sampled calls, so Critic diversity survives', async () => {
    const cache = new MemoryCacheStore();
    const provider = new FixtureProvider([ok('{"answer":"a","score":1}')]);
    const candidates = resolveCandidateModels({}, { fixture: provider });
    const router = new LlmRouter({ providers: { fixture: provider }, cache, candidates });
    const input = {
      agent: 'critic' as const,
      promptVersion: 'critic.v4',
      system: 's',
      user: 'u',
    };
    await router.call(input, Schema);
    await router.call(input, Schema);
    expect(provider.calls).toHaveLength(2);
  });

  it('ignores a cached value that no longer satisfies the schema', async () => {
    const cache = new MemoryCacheStore();
    const { router, provider } = makeRouter([ok('{"answer":"fresh","score":7}')], { cache });
    const key = (await cache.get('x')) ?? null;
    expect(key).toBeNull();

    // Simulate a schema change by seeding the cache with a now-invalid shape.
    const { cacheKey } = await import('./cache.js');
    const staleKey = await cacheKey('reasoning', {
      model: 'claude-sonnet-4-5-20250929',
      system: 'system',
      user: 'user',
      maxTokens: 4096,
      temperature: 0,
      json: true,
      timeoutMs: 60_000,
    });
    await cache.set(staleKey, JSON.stringify({ answer: 'stale' }), 60);

    const result = await call(router);
    expect(result.data.answer).toBe('fresh');
    expect(provider.calls).toHaveLength(1);
  });
});

describe('provider configuration', () => {
  it('reports CONFIG (not AUTH) when no provider is configured for a model', async () => {
    // Deliberately passing invalid candidates (no provider) to test LlmRouter directly.
    const router = new LlmRouter({ providers: {}, candidates: { reasoning: ['claude-sonnet-4-5-20250929'] } as Record<LlmAgentId, ModelId[]> });
    try {
      await call(router);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AllProvidersFailedError);
      const attempts = (error as AllProvidersFailedError).attempts;
      expect(attempts.every((a) => a.errorClass === 'CONFIG')).toBe(true);
    }
  });

  it('routes to the vendor that owns the model when no fixture is present', async () => {
    const seen: string[] = [];
    const stub = (name: 'anthropic'): LlmProvider => ({
      name,
      complete: (request) => {
        seen.push(`${name}:${request.model}`);
        return Promise.resolve({
          text: '{"answer":"ok","score":1}',
          usage: { inputTokens: 10, outputTokens: 5 },
          model: request.model,
          stopReason: 'end_turn',
          latencyMs: 1,
        });
      },
    });
    const providers = { anthropic: stub('anthropic') };
    const candidates = resolveCandidateModels({}, providers);
    const router = new LlmRouter({ providers, candidates });
    await call(router);
    expect(seen).toEqual(['anthropic:claude-sonnet-4-5-20250929']);
  });
});

describe('model overrides', () => {
  it('uses the env override as primary instead of MODEL_POLICY', async () => {
    const seen: string[] = [];
    const stub: LlmProvider = {
      name: 'anthropic',
      complete: (request) => {
        seen.push(request.model);
        return Promise.resolve({
          text: '{"answer":"overridden","score":42}',
          usage: { inputTokens: 10, outputTokens: 5 },
          model: request.model,
          stopReason: 'end_turn',
          latencyMs: 1,
        });
      },
    };
    const providers = { anthropic: stub };
    const candidates = resolveCandidateModels({ reasoning: 'claude-haiku-4-5-20251001' }, providers);
    const router = new LlmRouter({ providers, candidates });
    const result = await call(router);
    expect(seen).toEqual(['claude-haiku-4-5-20251001']);
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.data.answer).toBe('overridden');
  });

  it('falls back to MODEL_POLICY.primary when no override is set', async () => {
    const { router } = makeRouter([ok('{"answer":"default","score":1}')]);
    const result = await call(router);
    expect(result.model).toBe('claude-sonnet-4-5-20250929');
  });
});
