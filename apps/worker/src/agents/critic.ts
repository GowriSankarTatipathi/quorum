import { CritiqueOutputSchema, PROMPT_REGISTRY, type CriticClaimView } from '@quorum/ai';
import { claimRepository, critiqueRepository, type CritiqueRecord } from '@quorum/db';
import { eventPublisher } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';

export interface CriticContext {
  runId: string;
  correlationId: string;
  goal: string;
  expectedEntityCount: number | null;
}

/**
 * Cross-claim review.
 *
 * This is the agent that earns the multi-agent architecture. Each claim it examines is
 * individually correct and individually verified; only something looking at all of them
 * together can see that one price was read on a different billing basis than the rest. No
 * amount of per-claim rigour finds that, which is why a self-check inside the extractor
 * would not be an equivalent design.
 */
export async function runCriticAgent(ctx: CriticContext): Promise<CritiqueRecord[]> {
  const started = Date.now();
  const eventCtx = {
    runId: ctx.runId,
    agent: 'critic' as const,
    correlationId: ctx.correlationId,
  };

  await eventPublisher.emit('agent.started', { agent: 'critic', stepIndex: null }, eventCtx);

  const claims = await claimRepository.listCurrentForRun(ctx.runId);
  if (claims.length === 0) {
    await eventPublisher.emit(
      'agent.finished',
      { agent: 'critic', durationMs: Date.now() - started, confidence: null },
      eventCtx,
    );
    return [];
  }

  const view: CriticClaimView[] = claims.map((claim) => ({
    id: claim.id,
    entity: claim.entity,
    field: claim.field,
    value: claim.value,
    unit: claim.unit,
    confidence: claim.confidence,
    sourceUrl: claim.sourceUrl,
    status: claim.status,
  }));

  const prompt = PROMPT_REGISTRY.critic.build({
    goal: ctx.goal,
    claims: view,
    expectedEntityCount: ctx.expectedEntityCount,
  });

  const router = createRouter(new RunTelemetry(ctx.runId, null, ctx.correlationId));
  const { data } = await router.call(
    {
      agent: 'critic',
      promptVersion: PROMPT_REGISTRY.critic.version,
      system: prompt.system,
      user: prompt.user,
    },
    CritiqueOutputSchema,
  );

  const knownIds = new Set(claims.map((claim) => claim.id));
  const persisted: CritiqueRecord[] = [];

  for (const critique of data.critiques) {
    // Citations are validated against the run's real claims. A critique referencing an id
    // that does not exist is itself a hallucination, and storing it would put an
    // unactionable warning in front of the user.
    const citedIds = critique.claimIds.filter((id) => knownIds.has(id));
    if (critique.claimIds.length > 0 && citedIds.length === 0) continue;

    const record = await critiqueRepository.create({
      runId: ctx.runId,
      kind: critique.kind,
      severity: critique.severity,
      message: critique.message,
      claimIds: citedIds,
      remedy: {
        action: critique.remedy.action,
        params: critique.remedy.params ?? {},
      },
    });
    persisted.push(record);

    await eventPublisher.emit(
      'critique.raised',
      {
        critiqueId: record.id,
        kind: record.kind,
        severity: record.severity,
        message: record.message,
        claimIds: record.claimIds,
      },
      eventCtx,
    );
  }

  await eventPublisher.emit(
    'agent.finished',
    { agent: 'critic', durationMs: Date.now() - started, confidence: null },
    eventCtx,
  );

  return persisted;
}
