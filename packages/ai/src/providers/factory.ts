import type { LlmConfig } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { FixtureProvider, type RecordedCompletion } from './fixture.js';
import { OpenAiProvider } from './openai.js';
import type { LlmProvider } from './types.js';

export type ProviderSet = Partial<Record<'anthropic' | 'openai' | 'fixture', LlmProvider>>;

export interface CreateProvidersOptions {
  /** Supplied in recorded mode. Ignored entirely when running live. */
  recordings?: RecordedCompletion[];
}

/**
 * Build the provider set from configuration.
 *
 * This is the seam that makes the LLM swappable: everything downstream depends on the
 * `LlmProvider` port, and nothing else in the system knows or asks which implementation it
 * received. The mode is derived from configuration rather than from a flag threaded
 * through call sites, so a run cannot half-switch.
 */
export function createProviders(
  config: LlmConfig,
  options: CreateProvidersOptions = {},
): ProviderSet {
  if (config.mode === 'recorded') {
    return { fixture: new FixtureProvider(options.recordings ?? []) };
  }

  const providers: ProviderSet = {};
  if (config.anthropic) {
    providers.anthropic = new AnthropicProvider(config.anthropic.apiKey, config.anthropic.baseUrl);
  }
  if (config.openai) {
    providers.openai = new OpenAiProvider(config.openai.apiKey, config.openai.baseUrl);
  }

  if (Object.keys(providers).length === 0) {
    // Unreachable via loadLlmConfig, which refuses to report `live` with no key — but a
    // hand-built config could get here, and silently degrading to no provider would
    // surface as a confusing failure much later.
    throw new Error('Live LLM mode requires at least one provider key.');
  }
  return providers;
}

/** True when this process is talking to a vendor rather than replaying recordings. */
export const isLive = (config: LlmConfig): boolean => config.mode === 'live';
