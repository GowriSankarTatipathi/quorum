import type { AgentId } from '@quorum/core';

export type Provider = 'anthropic' | 'openai';

export const MODEL_IDS = [
  'claude-opus-4',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'gpt-5.1',
  'gpt-5.1-mini',
  'llama-3.3-70b-versatile',
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export interface ModelDescriptor {
  id: ModelId;
  provider: Provider;
  /** USD per 1M input tokens (list price; override via env for negotiated rates). */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** USD per 1M cached-read input tokens. */
  cachedInputPerMTok: number;
  contextWindow: number;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
}

export const MODELS: Record<ModelId, ModelDescriptor> = {
  'claude-opus-4': {
    id: 'claude-opus-4',
    provider: 'anthropic',
    inputPerMTok: 15,
    outputPerMTok: 75,
    cachedInputPerMTok: 1.5,
    contextWindow: 200_000,
    supportsVision: true,
    supportsStructuredOutput: true,
  },
  'claude-sonnet-4-5': {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
    inputPerMTok: 3,
    outputPerMTok: 15,
    cachedInputPerMTok: 0.3,
    contextWindow: 200_000,
    supportsVision: true,
    supportsStructuredOutput: true,
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 0.1,
    contextWindow: 200_000,
    supportsVision: true,
    supportsStructuredOutput: true,
  },
  'gpt-5.1': {
    id: 'gpt-5.1',
    provider: 'openai',
    inputPerMTok: 5,
    outputPerMTok: 15,
    cachedInputPerMTok: 0.5,
    contextWindow: 200_000,
    supportsVision: true,
    supportsStructuredOutput: true,
  },
  'gpt-5.1-mini': {
    id: 'gpt-5.1-mini',
    provider: 'openai',
    inputPerMTok: 0.6,
    outputPerMTok: 2.4,
    cachedInputPerMTok: 0.06,
    contextWindow: 200_000,
    supportsVision: true,
    supportsStructuredOutput: true,
  },
  'llama-3.3-70b-versatile': {
    id: 'llama-3.3-70b-versatile',
    provider: 'openai',
    inputPerMTok: 0,
    outputPerMTok: 0,
    cachedInputPerMTok: 0,
    contextWindow: 128_000,
    supportsVision: false,
    supportsStructuredOutput: true,
  },
};

export interface ModelSpec {
  primary: ModelId;
  fallback: ModelId;
  maxTokens: number;
  /** Temperature is chosen per ROLE, deliberately: 0 for transcription tasks where
   *  sampling variance is a hallucination opportunity with no upside; higher for the
   *  agents whose job is to generate hypotheses. */
  temperature: number;
  vision: boolean;
  json: boolean;
}

export type LlmAgentId = Exclude<AgentId, 'human'>;

export const MODEL_POLICY: Record<LlmAgentId, ModelSpec> = {
  planner: {
    primary: 'claude-opus-4',
    fallback: 'gpt-5.1',
    maxTokens: 4096,
    temperature: 0.2,
    vision: false,
    json: true,
  },
  browser: {
    primary: 'claude-sonnet-4-5',
    fallback: 'gpt-5.1-mini',
    maxTokens: 1024,
    temperature: 0.0,
    vision: true,
    json: true,
  },
  reasoning: {
    primary: 'claude-sonnet-4-5',
    fallback: 'gpt-5.1',
    maxTokens: 4096,
    temperature: 0.0,
    vision: false,
    json: true,
  },
  verification: {
    primary: 'claude-haiku-4-5',
    fallback: 'gpt-5.1-mini',
    maxTokens: 512,
    temperature: 0.0,
    vision: true,
    json: true,
  },
  critic: {
    primary: 'claude-opus-4',
    fallback: 'gpt-5.1',
    maxTokens: 2048,
    temperature: 0.3,
    vision: false,
    json: true,
  },
  recovery: {
    primary: 'claude-sonnet-4-5',
    fallback: 'gpt-5.1',
    maxTokens: 1024,
    temperature: 0.4,
    vision: false,
    json: true,
  },
  formatter: {
    primary: 'claude-haiku-4-5',
    fallback: 'gpt-5.1-mini',
    maxTokens: 4096,
    temperature: 0.0,
    vision: false,
    json: true,
  },
};

export const providerOf = (model: ModelId): Provider => MODELS[model].provider;
