import { PROMPT_REGISTRY, VerdictOutputSchema } from '@quorum/ai';
import { shouldVerify, type ClaimStatus } from '@quorum/core';
import { claimRepository, type ClaimRecord } from '@quorum/db';
import { eventPublisher } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';
import { env } from '../env.js';

export interface VerificationContext {
  runId: string;
  stepId: string | null;
  correlationId: string;
  /** Page text the claim was drawn from. */
  sourceRegion: string;
  capturedAt: string;
}

const VERDICT_TO_STATUS: Record<string, ClaimStatus> = {
  CONFIRMED: 'VERIFIED',
  CONTRADICTED: 'CONTRADICTED',
  UNSUPPORTED: 'UNSUPPORTED',
  AMBIGUOUS: 'AMBIGUOUS',
};

/**
 * Independently re-derive a claim from its source.
 *
 * Sampling is risk-weighted rather than exhaustive: everything uncertain plus a fraction
 * of the rest. Verifying every claim would roughly double cost and latency for a marginal
 * gain on values that were already unambiguous — and the sample rate is a workspace
 * setting, because a firm doing regulated filings will happily pay for 100%.
 */
export async function runVerificationAgent(
  claims: readonly ClaimRecord[],
  ctx: VerificationContext,
  random: () => number = Math.random,
): Promise<{ verified: number; contradicted: number; skipped: number }> {
  const started = Date.now();
  const eventCtx = {
    runId: ctx.runId,
    agent: 'verification' as const,
    stepId: ctx.stepId,
    correlationId: ctx.correlationId,
  };

  await eventPublisher.emit('agent.started', { agent: 'verification', stepIndex: null }, eventCtx);

  const router = createRouter(new RunTelemetry(ctx.runId, ctx.stepId, ctx.correlationId));
  let verified = 0;
  let contradicted = 0;
  let skipped = 0;

  for (const claim of claims) {
    if (!shouldVerify(claim.confidence, env.VERIFICATION_SAMPLE_RATE, random())) {
      skipped += 1;
      continue;
    }

    const prompt = PROMPT_REGISTRY.verification.build({
      url: claim.sourceUrl,
      capturedAt: ctx.capturedAt,
      sourceRegion: ctx.sourceRegion,
      field: claim.field,
      claimedValue: claim.value,
      unit: claim.unit,
    });

    const { data, model } = await router.call(
      {
        agent: 'verification',
        promptVersion: PROMPT_REGISTRY.verification.version,
        system: prompt.system,
        user: prompt.user,
      },
      VerdictOutputSchema,
    );

    const status = VERDICT_TO_STATUS[data.verdict] ?? 'UNVERIFIED';
    await claimRepository.recordVerdict({
      claimId: claim.id,
      verdict: status,
      independentReading: data.independentReading,
      rationale: data.rationale,
      confidence: data.confidence,
      model,
    });

    if (status === 'VERIFIED') {
      verified += 1;
      await eventPublisher.emit(
        'claim.verified',
        { claimId: claim.id, verdict: status, confidence: data.confidence },
        eventCtx,
      );
    } else {
      contradicted += 1;
      // A disagreement is the most valuable thing this agent produces, so it is surfaced
      // rather than folded into a summary count.
      await eventPublisher.emit(
        'claim.contradicted',
        {
          claimId: claim.id,
          claimed: claim.value,
          independentReading: data.independentReading,
        },
        eventCtx,
      );
    }
  }

  await eventPublisher.emit(
    'agent.finished',
    { agent: 'verification', durationMs: Date.now() - started, confidence: null },
    eventCtx,
  );

  return { verified, contradicted, skipped };
}
