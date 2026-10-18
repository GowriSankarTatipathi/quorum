import { claimsCanApprove } from '@quorum/auth';
import { availableControls } from '@quorum/core';
import { approvalRepository, critiqueRepository, runRepository, type RunRecord } from '@quorum/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../plugins/auth.js';
import { ApiError, notFound } from '../plugins/error-handler.js';
import { redis } from '../redis.js';
import { enqueueRunExecute } from '../services/queue.js';

const approvalKey = (runId: string, approvalId: string): string =>
  `run:${runId}:approval:${approvalId}`;

/** Mirrors the machine's state names so the API and the interface agree on what is valid. */
function machineStateFor(run: RunRecord): string {
  switch (run.status) {
    case 'AWAITING_APPROVAL':
      return 'awaitingApproval';
    case 'EXECUTING':
    case 'VERIFYING':
      return 'executing';
    case 'PAUSED':
      return 'paused';
    case 'TAKEOVER':
      return 'takeover';
    case 'RECOVERING':
      return 'recovering';
    case 'CRITIQUE':
      return 'critique';
    case 'FORMATTING':
      return 'formatting';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'CREATED':
    case 'PLANNING':
      return 'created';
  }
}

const ControlBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('raise_budget'), additionalUsd: z.number().positive().max(20) }),
]);

export const controlRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  /**
   * Plan approval.
   *
   * The hash of the plan the human actually saw is required. A plan regenerated or patched
   * between render and click no longer matches, so an approval can never be applied to a
   * plan nobody read — the time-of-check/time-of-use gap that produces "I didn't approve
   * that".
   */
  app.post(
    '/runs/:runId/plan/approve',
    {
      onRequest: app.requirePermission('run:control'),
      schema: {
        tags: ['control'],
        summary: 'Approve a plan and start execution',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        body: z.object({ planHash: z.string().min(8) }),
        response: { 202: z.object({ status: z.string() }) },
      },
    },
    async (request, reply) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      if (run.status !== 'AWAITING_APPROVAL') {
        throw new ApiError(
          409,
          'E_NOT_AWAITING_APPROVAL',
          'This run is not waiting for plan approval.',
        );
      }
      if (run.planHash !== request.body.planHash) {
        throw new ApiError(
          409,
          'E_PLAN_CHANGED',
          'The plan changed since you reviewed it. Reload and read it again before approving.',
        );
      }

      await enqueueRunExecute(run.id, request.body.planHash);
      return reply.status(202).send({ status: 'EXECUTING' });
    },
  );

  app.post(
    '/runs/:runId/control',
    {
      onRequest: app.requirePermission('run:control'),
      schema: {
        tags: ['control'],
        summary: 'Pause, resume, stop, or raise the budget',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        body: ControlBodySchema,
        response: { 200: z.object({ status: z.string() }) },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      const controls = availableControls(machineStateFor(run));
      const body = request.body;

      switch (body.action) {
        case 'pause': {
          if (!controls.canPause) {
            throw new ApiError(409, 'E_CANNOT_PAUSE', 'This run cannot be paused right now.');
          }
          await runRepository.setStatus(run.id, 'PAUSED');
          return { status: 'PAUSED' };
        }
        case 'resume': {
          if (!controls.canResume) {
            throw new ApiError(409, 'E_CANNOT_RESUME', 'This run is not paused.');
          }
          await enqueueRunExecute(run.id);
          return { status: 'EXECUTING' };
        }
        case 'stop': {
          if (!controls.canStop) {
            throw new ApiError(409, 'E_CANNOT_STOP', 'This run has already finished.');
          }
          // Everything extracted so far is kept. If the user stops at 60%, they keep 60%
          // of the value rather than losing the run.
          await runRepository.setStatus(run.id, 'CANCELLED');
          return { status: 'CANCELLED' };
        }
        case 'raise_budget': {
          if (run.status !== 'PAUSED') {
            throw new ApiError(
              409,
              'E_NOT_PAUSED',
              'The budget can only be raised while a run is paused at its limit.',
            );
          }
          await enqueueRunExecute(run.id);
          return { status: 'EXECUTING' };
        }
      }
    },
  );

  /**
   * Decide a gated action.
   *
   * Approval authority is checked separately from `run:control`: a viewer may watch, and a
   * member whose authority has been revoked may still drive a run, but neither may sign
   * for something irreversible. That separation is the whole reason approval is not a row
   * in the permission matrix.
   */
  app.post(
    '/approvals/:approvalId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['control'],
        summary: 'Approve or reject a gated action',
        security: [{ bearerAuth: [] }],
        params: z.object({ approvalId: z.string() }),
        body: z.object({
          decision: z.enum(['APPROVED', 'REJECTED']),
          editedPayload: z.record(z.string(), z.unknown()).nullable().default(null),
          scope: z.enum(['SINGLE', 'SIMILAR_IN_RUN']).default('SINGLE'),
          runId: z.string(),
        }),
        response: { 200: z.object({ status: z.string() }) },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const approval = await approvalRepository.findById(request.params.approvalId);
      if (!approval) throw notFound('Approval');
      if (approval.status !== 'PENDING') {
        throw new ApiError(409, 'E_ALREADY_DECIDED', 'That step has already been decided.');
      }

      const run = await runRepository.findByIdForOrg(request.body.runId, claims.org);
      if (!run) throw notFound('Run');

      if (request.body.decision === 'APPROVED' && !claimsCanApprove(claims, approval.trustLevel)) {
        throw new ApiError(
          403,
          'E_APPROVAL_AUTHORITY',
          `This step is level L${String(approval.trustLevel)} and your account cannot approve it. Ask an administrator.`,
        );
      }

      await approvalRepository.decide(
        approval.id,
        request.body.decision,
        claims.sub,
        request.body.editedPayload,
        request.body.scope,
      );

      // Wakes the worker's blocked BLPOP in single-digit milliseconds.
      await redis.lpush(
        approvalKey(run.id, approval.id),
        JSON.stringify({
          decision: request.body.decision,
          userId: claims.sub,
          editedPayload: request.body.editedPayload,
          scope: request.body.scope,
        }),
      );
      // The list is a one-shot mailbox; expiring it stops an unread decision lingering.
      await redis.expire(approvalKey(run.id, approval.id), 3_600);

      return { status: request.body.decision };
    },
  );

  app.post(
    '/critiques/:critiqueId/resolve',
    {
      onRequest: app.requirePermission('claim:correct'),
      schema: {
        tags: ['control'],
        summary: 'Resolve a critique raised by the Critic',
        security: [{ bearerAuth: [] }],
        params: z.object({ critiqueId: z.string() }),
        body: z.object({ resolution: z.enum(['ACCEPTED', 'DISMISSED', 'REMEDIED']) }),
        response: { 200: z.object({ resolution: z.string() }) },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const resolved = await critiqueRepository.resolve(
        request.params.critiqueId,
        request.body.resolution,
        claims.sub,
      );
      return { resolution: resolved.resolution };
    },
  );

  done();
};
