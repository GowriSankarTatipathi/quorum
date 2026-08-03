import { llmCallRepository, runRepository, usdToMicroUsdSafe } from './cost.js';
import type {
  LlmCallTelemetry,
  LlmTelemetrySink,
  ProviderFailureTelemetry,
  SchemaViolationTelemetry,
} from '@quorum/ai';
import type { CallCost } from '@quorum/ai';
import type { AgentId } from '@quorum/core';
import { eventPublisher } from './event-publisher.js';

/**
 * Binds the router's telemetry port to persistence and the event stream.
 *
 * Two destinations because they answer different questions: the `LlmCall` row is how we
 * bisect a quality regression to a prompt version weeks later, and the event is how the
 * user watches cost accrue while the run is happening.
 */
export class RunTelemetry implements LlmTelemetrySink {
  constructor(
    private readonly runId: string,
    private readonly stepId: string | null = null,
    private readonly correlationId: string | null = null,
  ) {}

  async recordCall(telemetry: LlmCallTelemetry): Promise<void> {
    const costMicroUsd = usdToMicroUsdSafe(telemetry.cost.usd);

    await llmCallRepository.record({
      runId: this.runId,
      stepId: this.stepId,
      agent: telemetry.agent,
      model: telemetry.model,
      promptVersion: telemetry.promptVersion,
      inputTokens: telemetry.cost.inputTokens,
      outputTokens: telemetry.cost.outputTokens,
      cachedTokens: telemetry.cost.cachedInputTokens,
      costMicroUsd,
      latencyMs: telemetry.latencyMs,
      cached: telemetry.cached,
      fallbackUsed: telemetry.fallbackUsed,
      schemaViolation: telemetry.schemaViolation,
    });

    await runRepository.addSpend(
      this.runId,
      costMicroUsd,
      telemetry.cost.inputTokens,
      telemetry.cost.outputTokens,
    );

    await eventPublisher.emit(
      'llm.response',
      {
        agent: telemetry.agent,
        model: telemetry.model,
        latencyMs: telemetry.latencyMs,
        cost: {
          inputTokens: telemetry.cost.inputTokens,
          outputTokens: telemetry.cost.outputTokens,
          usd: telemetry.cost.usd,
        },
        cached: telemetry.cached,
      },
      this.ctx(telemetry.agent),
    );
  }

  async recordSchemaViolation(telemetry: SchemaViolationTelemetry): Promise<void> {
    await eventPublisher.emit(
      'llm.schema_violation',
      { agent: telemetry.agent, model: telemetry.model, issues: telemetry.issues },
      this.ctx(telemetry.agent),
    );
  }

  async recordProviderFailure(telemetry: ProviderFailureTelemetry): Promise<void> {
    await eventPublisher.emit(
      'llm.provider_failed',
      {
        agent: telemetry.agent,
        model: telemetry.model,
        error: `${telemetry.errorClass}: ${telemetry.message}`,
      },
      this.ctx(telemetry.agent),
    );
  }

  async recordFallback(agent: AgentId, from: string, to: string, reason: string): Promise<void> {
    await eventPublisher.emit('llm.fallback_used', { agent, from, to, reason }, this.ctx(agent));
  }

  async recordCacheHit(agent: AgentId, savedCost: CallCost): Promise<void> {
    await eventPublisher.emit('llm.cache_hit', { agent, savedUsd: savedCost.usd }, this.ctx(agent));
  }

  private ctx(agent: AgentId) {
    return {
      runId: this.runId,
      agent,
      stepId: this.stepId,
      correlationId: this.correlationId,
    };
  }
}
