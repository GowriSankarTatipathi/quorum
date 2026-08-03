import { AUTONOMY_MODES, RUN_STATUSES, estimateRun } from '@quorum/core';
import {
  claimRepository,
  eventRepository,
  orgRepository,
  runRepository,
  stepRepository,
  type RunRecord,
} from '@quorum/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../plugins/auth.js';
import { notFound } from '../plugins/error-handler.js';
import { enqueueRunPlan } from '../services/queue.js';

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

      const run = await runRepository.create({
        userId: claims.sub,
        orgId: claims.org,
        goal: request.body.goal,
        mode: request.body.mode,
        budgetMicroUsd: Math.round(budgetUsd * 1_000_000),
        recipeId: request.body.recipeId ?? null,
      });

      // Enqueued only after the row exists, so a worker can never claim a run it cannot read.
      await enqueueRunPlan(run.id);

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
