import { createHash } from 'node:crypto';
import { AUTONOMY_MODES, RUN_STATUSES, estimateRun } from '@quorum/core';
import {
  artifactRepository,
  claimRepository,
  critiqueRepository,
  eventRepository,
  orgRepository,
  llmCallRepository,
  runRepository,
  stepRepository,
  type RunRecord,
} from '@quorum/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../plugins/auth.js';
import { ApiError, notFound } from '../plugins/error-handler.js';
import { getStorage } from '../services/storage.js';
import {
  isPlanExecutionQueued,
  enqueueRunPlan,
  runQueuePosition,
  workerAvailability,
} from '../services/queue.js';

const RunSummarySchema = z.object({
  id: z.string(),
  goal: z.string(),
  mode: z.enum(AUTONOMY_MODES),
  status: z.enum(RUN_STATUSES),
  budgetUsd: z.number(),
  spentUsd: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  planHash: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

const StepSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  objective: z.string(),
  targetUrl: z.string().nullable(),
  agentPath: z.array(z.string()),
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  notes: z.string().nullable(),
  status: z.enum(['PENDING', 'RUNNING', 'BLOCKED', 'DONE', 'FAILED', 'SKIPPED']),
  estimatedMs: z.number().int().nullable(),
  estimatedUsd: z.number().nullable(),
});

const EventSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  type: z.string(),
  agent: z.string().nullable(),
  stepId: z.string().nullable(),
  payload: z.unknown(),
  causationId: z.string().nullable(),
  correlationId: z.string().nullable(),
  ts: z.string(),
});

const CreateRunBodySchema = z.object({
  requestId: z.string().uuid().optional(),
  goal: z.string().min(12, 'Describe the task in a sentence or two.').max(4_000),
  mode: z.enum(AUTONOMY_MODES).default('BALANCED'),
  /** Optional override; clamped to the workspace ceiling server-side regardless. */
  budgetUsd: z.number().positive().max(50).optional(),
  recipeId: z.string().optional(),
});

const microToUsd = (micro: number): number => micro / 1_000_000;

function toRunSummary(run: RunRecord) {
  return {
    id: run.id,
    goal: run.goal,
    mode: run.mode,
    status: run.status,
    budgetUsd: microToUsd(run.budgetMicroUsd),
    spentUsd: microToUsd(run.spentMicroUsd),
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    planHash: run.planHash,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    endedAt: run.endedAt?.toISOString() ?? null,
  };
}

export const runRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get('/runtime', { schema: { tags: ['runs'] } }, async () => workerAvailability());

  app.get(
    '/runs/:runId/report',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        params: z.object({ runId: z.string() }),
        tags: ['runs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const identity = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, identity.org);
      if (!run) throw notFound('Run');
      const [claims, critiques, steps, availability, lastSeq, calls] = await Promise.all([
        claimRepository.listCurrentForRun(run.id),
        critiqueRepository.listForRun(run.id),
        stepRepository.listForRun(run.id),
        workerAvailability(),
        eventRepository.lastSeq(run.id),
        llmCallRepository.listForRun(run.id),
      ]);
      const recentEvents = await eventRepository.listAfter(
        run.id,
        Math.max(0, lastSeq - 2000),
        2000,
      );
      const evidenceWarnings = recentEvents
        .filter((e) => e.type === 'error.classified')
        .flatMap((e) => {
          const p = e.payload as { code?: string; humanMessage?: string };
          return p.code === 'E_LLM_HALLUCINATION_SUSPECTED' && typeof p.humanMessage === 'string'
            ? [p.humanMessage]
            : [];
        });
      const last = await eventRepository.listAfter(run.id, Math.max(0, lastSeq - 1), 1);
      let approvalQueued = false;
      if (run.status === 'AWAITING_APPROVAL') {
        try {
          approvalQueued = await isPlanExecutionQueued(run.id, run.planHash);
        } catch {
          /* Availability is unknown. */
        }
      }
      let queuePosition: number | null = null;
      if (run.status === 'CREATED' || approvalQueued) {
        try {
          queuePosition = await runQueuePosition(run.id);
        } catch {
          /* Availability stays explicit. */
        }
      }
      const openFindings = critiques.filter(
        (c) => c.resolution === 'OPEN' || c.resolution === 'ACCEPTED',
      );
      const gaps = openFindings.filter((c) => c.kind === 'COVERAGE_GAP' && c.severity !== 'NOTE');
      const disputed = claims.filter((c) => !['VERIFIED', 'HUMAN_CORRECTED'].includes(c.status));
      return {
        status: run.status,
        usage: {
          spentUsd: microToUsd(run.spentMicroUsd),
          budgetUsd: microToUsd(run.budgetMicroUsd),
          estimatedUsd: steps.some((step) => step.estimatedMicroUsd !== null)
            ? microToUsd(steps.reduce((sum, step) => sum + (step.estimatedMicroUsd ?? 0), 0))
            : null,
          calls: calls.length,
          agents: [...new Set(calls.map((call) => call.agent))].map((agent) => ({
            agent,
            calls: calls.filter((call) => call.agent === agent).length,
            spentUsd: microToUsd(
              calls
                .filter((call) => call.agent === agent)
                .reduce((sum, call) => sum + call.costMicroUsd, 0),
            ),
          })),
        },
        evidenceWarnings,
        finishedAt: run.endedAt?.toISOString() ?? null,
        availability,
        queuePosition,
        approvalQueued,
        lastActivityAt: last[0]?.ts.toISOString() ?? run.createdAt.toISOString(),
        outcome:
          run.status !== 'COMPLETED'
            ? null
            : !claims.length || gaps.length || steps.some((s) => s.status === 'SKIPPED')
              ? 'incomplete'
              : disputed.length || openFindings.some((c) => c.severity !== 'NOTE')
                ? 'review'
                : 'finished',
        findings: openFindings.map((c) => ({
          id: c.id,
          kind: c.kind,
          severity: c.severity,
          message: c.message,
          claimIds: c.claimIds,
        })),
        skippedSteps: steps.filter((s) => s.status === 'SKIPPED').map((s) => s.objective),
        claims: await Promise.all(
          claims.map(async (c) => {
            const verdicts = await claimRepository.listVerdicts(c.id);
            const verdict = verdicts.at(-1);
            return {
              id: c.id,
              entity: c.entity,
              field: c.field,
              value: c.value,
              unit: c.unit,
              status: c.status,
              confidence: c.confidence,
              sourceUrl: c.sourceUrl,
              sourceText: c.sourceText,
              capturedAt: c.extractedAt.toISOString(),
              nullReason: c.nullReason,
              screenshotUrl: c.screenshotKey
                ? await getStorage().signedUrl(c.screenshotKey, 900)
                : null,
              rationale: verdict?.rationale ?? null,
              independentReading: verdict?.independentReading ?? null,
            };
          }),
        ),
      };
    },
  );

  app.get(
    '/runs/:runId/screenshots',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        params: z.object({ runId: z.string() }),
        tags: ['runs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');
      const artifacts = await artifactRepository.listForRun(run.id, 'SCREENSHOT');
      const shots = artifacts.map((a) => ({
        key: a.r2Key,
        capturedAt: a.createdAt.toISOString(),
        label: 'Extraction evidence',
      }));
      // Older runs retained a final frame in their closing event, without an artifact row.
      let cursor = 0;
      for (;;) {
        const events = await eventRepository.listAfter(run.id, cursor, 1000);
        for (const event of events) {
          if (event.type !== 'browser.session.closed') continue;
          const payload = event.payload as { finalFrameKey?: unknown };
          if (
            typeof payload.finalFrameKey === 'string' &&
            payload.finalFrameKey.startsWith(`runs/${run.id}/`)
          ) {
            shots.push({
              key: payload.finalFrameKey,
              capturedAt: event.ts.toISOString(),
              label: 'Final browser view',
            });
          }
        }
        if (events.length < 1000) break;
        cursor = events.at(-1)!.seq;
      }
      const storage = shots.length ? getStorage() : null;
      return {
        screenshots: await Promise.all(
          shots.map(async (shot) => ({ ...shot, url: await storage!.signedUrl(shot.key, 900) })),
        ),
      };
    },
  );

  app.post(
    '/runs',
    {
      onRequest: app.requirePermission('run:create'),
      schema: {
        tags: ['runs'],
        summary: 'Create a run and queue it for planning',
        security: [{ bearerAuth: [] }],
        body: CreateRunBodySchema,
        response: { 202: RunSummarySchema },
      },
    },
    async (request, reply) => {
      const claims = requireAuth(request);
      const org = await orgRepository.findById(claims.org);
      if (!org) throw notFound('Workspace');

      // The workspace budget is a ceiling, not a default a caller may raise. Trusting a
      // client-supplied budget would make the limit advisory.
      const requestedUsd = request.body.budgetUsd ?? Math.min(0.5, org.maxRunBudgetUsd);
      const budgetUsd = Math.min(requestedUsd, org.maxRunBudgetUsd);

      const input = {
        userId: claims.sub,
        orgId: claims.org,
        goal: request.body.goal,
        mode: request.body.mode,
        budgetMicroUsd: Math.round(budgetUsd * 1_000_000),
        recipeId: request.body.recipeId ?? null,
      };
      const run = request.body.requestId
        ? await runRepository.createOnce(
            input,
            `request_${createHash('sha256').update(`${claims.org}:${claims.sub}:${request.body.requestId}`).digest('hex')}`,
          )
        : await runRepository.create(input);
      if (
        run.goal !== input.goal ||
        run.mode !== input.mode ||
        run.budgetMicroUsd !== input.budgetMicroUsd ||
        run.recipeId !== input.recipeId
      ) {
        throw new ApiError(
          409,
          'E_REQUEST_REUSED',
          'This submission was already used for a different task. Submit a new task.',
        );
      }

      // Enqueued only after the row exists, so a worker can never claim a run it cannot read.
      if (run.status === 'CREATED') await enqueueRunPlan(run.id);

      return reply.status(202).send(toRunSummary(run));
    },
  );

  app.get(
    '/runs',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        tags: ['runs'],
        summary: 'List your runs, newest first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: z.string().optional(),
        }),
        response: { 200: z.object({ runs: z.array(RunSummarySchema) }) },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const runs = await runRepository.listForUser(
        claims.sub,
        request.query.limit,
        request.query.cursor,
      );
      return { runs: runs.map(toRunSummary) };
    },
  );

  app.get(
    '/runs/:runId',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        tags: ['runs'],
        summary: 'A run with its plan and current claim count',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        response: {
          200: z.object({
            run: RunSummarySchema,
            steps: z.array(StepSchema),
            claimCount: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      // Scoped by organisation, not merely by id: an id is guessable, tenancy is not.
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      const [steps, currentClaims] = await Promise.all([
        stepRepository.listForRun(run.id),
        claimRepository.listCurrentForRun(run.id),
      ]);

      return {
        run: toRunSummary(run),
        steps: steps.map((step) => ({
          id: step.id,
          index: step.index,
          objective: step.objective,
          targetUrl: step.targetUrl,
          agentPath: step.agentPath,
          outputSchema: step.outputSchema,
          riskLevel: step.riskLevel,
          notes: step.notes,
          status: step.status,
          estimatedMs: step.estimatedMs,
          estimatedUsd: step.estimatedMicroUsd === null ? null : microToUsd(step.estimatedMicroUsd),
        })),
        claimCount: currentClaims.length,
      };
    },
  );

  app.get(
    '/runs/:runId/events',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        tags: ['runs'],
        summary: 'Event history after a cursor — the WebSocket reconnect path',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        querystring: z.object({
          after: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(1_000).default(500),
        }),
        response: {
          200: z.object({
            events: z.array(EventSchema),
            lastSeq: z.number().int(),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      const events = await eventRepository.listAfter(
        run.id,
        request.query.after,
        request.query.limit,
      );

      return {
        events: events.map((event) => ({
          id: event.id,
          seq: event.seq,
          type: event.type,
          agent: event.agent,
          stepId: event.stepId,
          payload: event.payload,
          causationId: event.causationId,
          correlationId: event.correlationId,
          ts: event.ts.toISOString(),
        })),
        lastSeq: events.at(-1)?.seq ?? request.query.after,
        hasMore: events.length === request.query.limit,
      };
    },
  );

  /**
   * A local, instant estimate. It exists because agent products feel financially
   * unbounded, and that feeling suppresses usage more than the actual price does —
   * showing a number before the user commits converts an anxiety into a decision.
   */
  app.post(
    '/runs/estimate',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['runs'],
        summary: 'Estimate cost and duration before committing',
        security: [{ bearerAuth: [] }],
        body: z.object({ goal: z.string().max(4_000), mode: z.enum(AUTONOMY_MODES) }),
        response: {
          200: z.object({
            targetCount: z.number().int(),
            estimatedSteps: z.number().int(),
            estimatedSeconds: z.number().int(),
            estimatedUsd: z.number(),
            isRough: z.boolean(),
          }),
        },
      },
    },
    (request) => {
      requireAuth(request);
      return estimateRun(request.body.goal, request.body.mode);
    },
  );

  done();
};
