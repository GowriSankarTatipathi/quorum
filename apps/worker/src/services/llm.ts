import {
  LlmRouter,
  MemoryCacheStore,
  createProviders,
  describeLlmConfig,
  loadLlmConfig,
  resolveCandidateModels,
  type LlmConfig,
  type LlmTelemetrySink,
  type ProviderSet,
  type LlmAgentId,
  type ModelId,
} from '@quorum/ai';
import { logger } from '../logger.js';

/**
 * One provider set per process, chosen by configuration rather than by a call-site flag.
 *
 * The key is read from the environment and never defaulted. Recorded mode is deliberately
 * not supported here: it exists so the integration harness can exercise orchestration
 * without a vendor, and a *worker* that accepts jobs it cannot actually run is worse than
 * one that refuses to start.
 */
export const llmConfig: LlmConfig = loadLlmConfig();

let providers: ProviderSet | null = null;
let candidates: Record<LlmAgentId, ModelId[]> | null = null;

function getProviders(): ProviderSet {
  providers ??= createProviders(llmConfig);
  return providers;
}

function getCandidates(): Record<LlmAgentId, ModelId[]> {
  if (!candidates) {
    candidates = resolveCandidateModels(
      llmConfig.modelOverrides,
      getProviders(),
      (model, reason) => logger.warn({ model, reason }, 'Model unavailable due to missing API key'),
    );
  }
  return candidates;
}

// Shared across runs, which is what makes a repeated recipe cheap.
const sharedCache = new MemoryCacheStore();

export function createRouter(telemetry: LlmTelemetrySink): LlmRouter {
  return new LlmRouter({
    providers: getProviders(),
    telemetry,
    cache: sharedCache,
    cacheTtlSeconds: llmConfig.cacheTtlSeconds,
    timeoutMs: llmConfig.timeoutMs,
    retriesPerModel: llmConfig.retriesPerModel,
    candidates: getCandidates(),
  });
}

export function logLlmMode(): void {
  logger.info({ llm: describeLlmConfig(llmConfig) }, llmConfig.reason);
  // Resolve models at boot so a misconfigured worker crashes before accepting a job.
  getCandidates();
}

/** False when no vendor key is configured, which stops the worker joining the pool. */
export const hasLiveProvider = (): boolean => llmConfig.mode === 'live';
