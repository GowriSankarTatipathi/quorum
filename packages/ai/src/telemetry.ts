import type { LlmAgentId, ModelId } from './models.js';
import type { CallCost } from './pricing.js';

export interface LlmCallTelemetry {
  agent: LlmAgentId;
  model: ModelId;
  promptVersion: string;
  cost: CallCost;
  latencyMs: number;
  cached: boolean;
  fallbackUsed: boolean;
  schemaViolation: boolean;
  attempt: number;
}

export interface SchemaViolationTelemetry {
  agent: LlmAgentId;
  model: ModelId;
  promptVersion: string;
  issues: string[];
  rawExcerpt: string;
}

export interface ProviderFailureTelemetry {
  agent: LlmAgentId;
  model: ModelId;
  errorClass: string;
  message: string;
  attempt: number;
}

/**
 * Where the router reports what it did.
 *
 * Declared as a port rather than importing the database or the event bus: @quorum/ai
 * must stay usable from a test with no infrastructure, and the router's correctness
 * should not depend on anything being reachable.
 */
export interface LlmTelemetrySink {
  recordCall(telemetry: LlmCallTelemetry): void | Promise<void>;
  recordSchemaViolation(telemetry: SchemaViolationTelemetry): void | Promise<void>;
  recordProviderFailure(telemetry: ProviderFailureTelemetry): void | Promise<void>;
  recordFallback(
    agent: LlmAgentId,
    from: ModelId,
    to: ModelId,
    reason: string,
  ): void | Promise<void>;
  recordCacheHit(agent: LlmAgentId, savedCost: CallCost): void | Promise<void>;
  onToken?(agent: LlmAgentId, text: string): void;
}

/** Used when a caller does not care — a no-op sink beats making the parameter optional
 *  and re-checking it at eight call sites. */
export const noopTelemetry: LlmTelemetrySink = {
  recordCall: () => undefined,
  recordSchemaViolation: () => undefined,
  recordProviderFailure: () => undefined,
  recordFallback: () => undefined,
  recordCacheHit: () => undefined,
};
