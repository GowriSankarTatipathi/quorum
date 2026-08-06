import { PROMPT_REGISTRY, ReasoningOutputSchema } from '@quorum/ai';
import { assertGrounded, explainGrounding, type GroundingResult } from '@quorum/core';
import { claimRepository, type ClaimRecord, type CreateClaimInput } from '@quorum/db';
import { eventPublisher } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';
import { logger } from '../logger.js';

export interface ReasoningAgentContext {
  runId: string;
  stepId: string;
  correlationId: string;
  stepObjective: string;
  outputSchema: Record<string, string> | null;
  url: string;
  /** The compressed tree the model reads. */
  pageContent: string;
  /** Page text used for grounding. Wider than what the model saw, on purpose. */
  capturedText: string;
  screenshotKey: string | null;
  domSnapshotKey: string | null;
  /** All claims previously attempted/extracted in this run. */
  existingClaims: { entity: string; field: string; id: string; value: unknown; status: string }[];
}

export interface ReasoningResult {
  claims: ClaimRecord[];
  quarantined: { entity: string; field: string; reason: string }[];
  note: string | null;
}

/**
 * Extract structured claims from a page.
 *
 * The grounding gate is the load-bearing part. Every non-null value must quote text that
 * actually appears in the captured page; a claim whose quote is absent is quarantined
 * rather than stored, because the model did not read what it says it read. The check is
 * deterministic and costs nothing, which is why it runs before anything more expensive.
 */
export async function runReasoningAgent(ctx: ReasoningAgentContext): Promise<ReasoningResult> {
  const started = Date.now();
  const eventCtx = {
    runId: ctx.runId,
    agent: 'reasoning' as const,
    stepId: ctx.stepId,
    correlationId: ctx.correlationId,
  };

  await eventPublisher.emit('agent.started', { agent: 'reasoning', stepIndex: null }, eventCtx);

  // Only tell the model to skip fields that were successfully extracted.
  // If it was just an attempt (null) or was rejected, we want it to try again.
  const successfulFields = ctx.existingClaims.filter(
    (c) => c.value !== null && c.status !== 'UNSUPPORTED' && c.status !== 'CONTRADICTED',
  );

  const prompt = PROMPT_REGISTRY.reasoning.build({
    stepObjective: ctx.stepObjective,
    outputSchema: ctx.outputSchema,
    url: ctx.url,
    knownFields: successfulFields,
    pageContent: ctx.pageContent,
  });

  const router = createRouter(new RunTelemetry(ctx.runId, ctx.stepId, ctx.correlationId));
  const { data, model } = await router.call(
    {
      agent: 'reasoning',
      promptVersion: PROMPT_REGISTRY.reasoning.version,
      system: prompt.system,
      user: prompt.user,
    },
    ReasoningOutputSchema,
  );

  if (data.injectionDetected) {
    await eventPublisher.emit(
      'security.injection_detected',
      { excerpt: data.injectionExcerpt ?? '(no excerpt)', url: ctx.url },
      eventCtx,
    );
  }

  const accepted: CreateClaimInput[] = [];
  const quarantined: ReasoningResult['quarantined'] = [];

  for (const claim of data.claims) {
    const grounding: GroundingResult = assertGrounded({
      value: claim.value,
      sourceText: claim.sourceText,
      captured: ctx.capturedText,
      // The quoted snippet must contain the value itself, not merely exist on the page.
      requireValueInSource: typeof claim.value === 'number',
    });

    if (!grounding.grounded) {
      quarantined.push({
        entity: claim.entity,
        field: claim.field,
        reason: explainGrounding(grounding) ?? 'ungrounded',
      });
      logger.warn(
        { runId: ctx.runId, entity: claim.entity, field: claim.field, reason: grounding.reason },
        'claim failed grounding and was quarantined',
      );
      continue;
    }

    accepted.push({
      stepId: ctx.stepId,
      entity: claim.entity,
      field: claim.field,
      value: claim.value,
      unit: claim.unit,
      sourceUrl: ctx.url,
      sourceText: claim.sourceText,
      screenshotKey: ctx.screenshotKey,
      domSnapshotKey: ctx.domSnapshotKey,
      extractedBy: model,
      promptVersion: PROMPT_REGISTRY.reasoning.version,
      confidence: claim.confidence,
      ambiguity: claim.ambiguity,
      nullReason: claim.nullReason,
    });
  }

  const created: ClaimRecord[] = [];
  const knownMap = new Map(ctx.existingClaims.map((f) => [`${f.entity}:${f.field}`, f.id]));

  for (const claim of accepted) {
    const existingId = knownMap.get(`${claim.entity}:${claim.field}`);
    if (existingId) {
      // It's a corroboration or update; append it by superseding the existing claim.
      // Passing `null` for correctedBy signals this is a model-driven update.
      const updated = await claimRepository.supersede(existingId, claim, null);
      created.push(updated);
      knownMap.set(`${claim.entity}:${claim.field}`, updated.id);
    } else {
      const added = await claimRepository.create(claim);
      created.push(added);
      knownMap.set(`${claim.entity}:${claim.field}`, added.id);
    }
  }

  for (const claim of created) {
    await eventPublisher.emit(
      'claim.created',
      {
        claimId: claim.id,
        entity: claim.entity,
        field: claim.field,
        value: claim.value,
        unit: claim.unit,
        confidence: claim.confidence,
        sourceUrl: claim.sourceUrl,
      },
      eventCtx,
    );
  }

  if (quarantined.length > 0) {
    // A spike here is the direct fabrication signal: a model or prompt change started
    // inventing values, and it is alerted on within minutes rather than days.
    await eventPublisher.emit(
      'error.classified',
      {
        errorClass: 'LLM_HALLUCINATION_SUSPECTED',
        code: 'E_LLM_HALLUCINATION_SUSPECTED',
        humanMessage: `I discarded ${String(quarantined.length)} value${quarantined.length === 1 ? '' : 's'} I could not find on the page.`,
        retryable: true,
        requiresHuman: false,
      },
      eventCtx,
    );
  }

  await eventPublisher.emit(
    'agent.finished',
    { agent: 'reasoning', durationMs: Date.now() - started, confidence: null },
    eventCtx,
  );

  return { claims: created, quarantined, note: data.note };
}
