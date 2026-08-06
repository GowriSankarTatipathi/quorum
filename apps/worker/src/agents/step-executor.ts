import {
  ApprovalRequiredError,
  executeAction,
  type PageSnapshot,
  type Session,
} from '@quorum/browser';
import {
  ClassifiedActionError,
  isClassifiedActionError,
  throwable,
  trustLadder,
  type AutonomyMode,
  type BrowserAction,
  type ClassifiedError,
} from '@quorum/core';
import { claimRepository, stepRepository, undoFrameRepository, type StepRecord } from '@quorum/db';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { browserDriver } from '../services/browser.js';
import { eventPublisher, newCorrelation } from '../services/event-publisher.js';
import { ApprovalTimeoutError, awaitApproval } from '../services/approval.js';
import { runBrowserAgent } from './browser.js';
import { runReasoningAgent } from './reasoning.js';
import { runVerificationAgent } from './verification.js';
import { runRecoveryAgent, type RecoveryDecision } from './recovery.js';

export interface StepExecutionContext {
  runId: string;
  orgId: string;
  mode: AutonomyMode;
  allowedHosts: readonly string[];
  session: Session;
  budgetRemainingUsd: () => number;
}

export type StepOutcome =
  | { kind: 'done'; claimCount: number; quarantinedCount: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'needs_human'; question: string; error: ClassifiedError }
  | { kind: 'paused'; reason: 'approval_timeout' };

const describeAction = (action: BrowserAction): string =>
  'ref' in action && typeof action.ref === 'number'
    ? `${action.type} [${String(action.ref)}]`
    : action.type;

/**
 * Execute one plan step to completion.
 *
 * The inner loop is deliberately bounded and deliberately shaped: propose one action,
 * gate it, execute it, observe the result. Extraction is a separate pass that happens once
 * the Browser agent says the content is visible, because extraction is the expensive call
 * and running it on every intermediate page would multiply the cost of a run by the number
 * of clicks it took to get there.
 */
export async function executeStep(
  step: StepRecord,
  ctx: StepExecutionContext,
): Promise<StepOutcome> {
  const correlationId = newCorrelation();
  const eventCtx = { runId: ctx.runId, stepId: step.id, correlationId };
  const recentActions: string[] = [];

  await stepRepository.start(step.id);
  await eventPublisher.emit(
    'agent.handoff',
    { from: 'planner', to: 'browser' },
    { ...eventCtx, agent: 'browser' },
  );

  let snapshot: PageSnapshot = step.targetUrl
    ? await navigateTo(ctx.session, step.targetUrl, eventCtx)
    : await browserDriver.snapshot(ctx.session);

  for (let attempt = 1; attempt <= env.MAX_BROWSER_ATTEMPTS_PER_STEP; attempt += 1) {
    let decision;
    try {
      decision = await runBrowserAgent({
        runId: ctx.runId,
        stepId: step.id,
        correlationId,
        stepObjective: step.objective,
        snapshot,
        recentActions,
        attempt,
        maxAttempts: env.MAX_BROWSER_ATTEMPTS_PER_STEP,
      });
    } catch (error) {
      const outcome = await recover(error, step, ctx, snapshot, correlationId);
      if (outcome) return outcome;
      snapshot = await browserDriver.snapshot(ctx.session);
      continue;
    }

    if (decision.action.type === 'give_up') {
      await stepRepository.finish(step.id, 'SKIPPED', 0);
      return { kind: 'skipped', reason: decision.action.reason };
    }

    if (decision.action.type === 'extract_ready') {
      return extractAndVerify(step, ctx, snapshot, correlationId);
    }

    const verdict = trustLadder(decision.action, ctx.mode, { allowedHosts: ctx.allowedHosts });
    let approvalToken: string | undefined;

    if (verdict.requiresApproval) {
      try {
        const approval = await awaitApproval({
          runId: ctx.runId,
          stepId: step.id,
          correlationId,
          trustLevel: verdict.level,
          action: { ...decision.action, reasoning: decision.reasoning },
          payload: 'text' in decision.action ? { text: decision.action.text } : null,
          screenshotKey: null,
          reason: verdict.reason,
        });

        if (approval.decision === 'REJECTED') {
          await stepRepository.finish(step.id, 'SKIPPED', 0);
          return { kind: 'skipped', reason: 'You rejected this step, so I skipped it.' };
        }
        approvalToken = approval.userId;
      } catch (error) {
        if (error instanceof ApprovalTimeoutError)
          return { kind: 'paused', reason: 'approval_timeout' };
        throw error;
      }
    }

    try {
      const executed = await executeAction(browserDriver, ctx.session, decision.action, snapshot, {
        mode: ctx.mode,
        allowedHosts: ctx.allowedHosts,
        ...(approvalToken === undefined ? {} : { approvalToken }),
        onEvent: async (event) => {
          if (event.type === 'action.start') {
            await eventPublisher.emit(
              'browser.action.start',
              {
                action: {
                  type: event.action.type,
                  ...('ref' in event.action ? { ref: event.action.ref } : {}),
                },
                trustLevel: event.verdict.level,
                highlight: event.highlight,
              },
              { ...eventCtx, agent: 'browser' },
            );
          } else if (event.type === 'action.ok') {
            await eventPublisher.emit(
              'browser.action.ok',
              {
                action: { type: event.action.type },
                durationMs: event.durationMs,
                changed: event.changed,
              },
              { ...eventCtx, agent: 'browser' },
            );
          } else if (event.type === 'noop.detected') {
            await eventPublisher.emit(
              'browser.noop_detected',
              { action: { type: event.action.type }, ref: event.ref },
              { ...eventCtx, agent: 'browser' },
            );
          } else {
            await eventPublisher.emit(
              'browser.action.failed',
              {
                action: { type: event.action.type },
                code: event.error.code,
                humanMessage: event.error.humanMessage,
              },
              { ...eventCtx, agent: 'browser' },
            );
          }
        },
        captureUndo: async (frame) => {
          await undoFrameRepository.capture({
            stepId: step.id,
            seq: await undoFrameRepository.nextSeq(step.id),
            url: frame.url,
            scrollY: frame.scrollY,
            // Artifact bytes are written by the storage service; the keys are recorded
            // here so undo has something to restore even before upload completes.
            domSnapshotKey: `runs/${ctx.runId}/steps/${step.id}/dom-${String(Date.now())}.html`,
            screenshotKey: `runs/${ctx.runId}/steps/${step.id}/shot-${String(Date.now())}.jpg`,
            reversible: frame.reversible,
          });
          if (!frame.reversible) await undoFrameRepository.markStepIrreversible(step.id);
        },
      });

      recentActions.push(describeAction(decision.action));
      snapshot = executed.snapshotAfter;
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        // The gate is the security boundary and must not be bypassable by a retry, so a
        // missing token here is a programming error rather than something to recover from.
        throw error;
      }
      const outcome = await recover(error, step, ctx, snapshot, correlationId);
      if (outcome) return outcome;
      snapshot = await browserDriver.snapshot(ctx.session);
    }
  }

  // The attempt ceiling was reached without the agent declaring the content ready.
  return extractAndVerify(step, ctx, snapshot, correlationId);
}

async function navigateTo(
  session: Session,
  url: string,
  eventCtx: { runId: string; stepId: string; correlationId: string },
): Promise<PageSnapshot> {
  const result = await browserDriver.navigate(session, url);
  await eventPublisher.emit(
    'browser.navigate',
    { url: result.url, title: result.title },
    { ...eventCtx, agent: 'browser' },
  );
  return browserDriver.snapshot(session);
}

async function extractAndVerify(
  step: StepRecord,
  ctx: StepExecutionContext,
  snapshot: PageSnapshot,
  correlationId: string,
): Promise<StepOutcome> {
  const started = Date.now();
  const capture = await browserDriver.capture(ctx.session);

  const currentClaims = await claimRepository.listCurrentForRun(ctx.runId);
  const knownFields = currentClaims.map((c) => ({
    entity: c.entity,
    field: c.field,
    id: c.id,
  }));

  const extraction = await runReasoningAgent({
    runId: ctx.runId,
    stepId: step.id,
    correlationId,
    stepObjective: step.objective,
    outputSchema: step.outputSchema as Record<string, string> | null,
    url: snapshot.url,
    pageContent: snapshot.tree,
    // Grounding is checked against a wider capture than the model saw, so trimming the
    // tree for cost cannot make a genuinely-read value look fabricated.
    capturedText: `${capture.a11y}\n${capture.html}`,
    screenshotKey: null,
    domSnapshotKey: null,
    knownFields,
  });

  await runVerificationAgent(extraction.claims, {
    runId: ctx.runId,
    stepId: step.id,
    correlationId,
    sourceRegion: snapshot.tree,
    capturedAt: capture.capturedAt,
  });

  await stepRepository.finish(step.id, 'DONE', Date.now() - started);
  const current = await claimRepository.listCurrentForRun(ctx.runId);
  logger.info(
    { runId: ctx.runId, stepId: step.id, claims: extraction.claims.length, total: current.length },
    'step complete',
  );

  return {
    kind: 'done',
    claimCount: extraction.claims.length,
    quarantinedCount: extraction.quarantined.length,
  };
}

/**
 * Run the recovery ladder for a failure.
 *
 * Returns an outcome when the step is over, or `null` when a strategy was chosen and the
 * loop should try again. Injection is handled here rather than delegated: continuing after
 * a page has tried to issue instructions is unsafe at any price, and the decision must not
 * belong to the component being targeted.
 */
async function recover(
  error: unknown,
  step: StepRecord,
  ctx: StepExecutionContext,
  snapshot: PageSnapshot,
  correlationId: string,
): Promise<StepOutcome | null> {
  const failure: ClassifiedActionError = isClassifiedActionError(error)
    ? error
    : new ClassifiedActionError(throwable('INTERNAL', String(error)).toClassified());

  await eventPublisher.emit(
    'error.classified',
    {
      errorClass: failure.errorClass,
      code: failure.code,
      humanMessage: failure.humanMessage,
      retryable: failure.retryable,
      requiresHuman: failure.requiresHuman,
    },
    { runId: ctx.runId, agent: 'recovery', stepId: step.id, correlationId },
  );

  if (failure.errorClass === 'INJECTION_DETECTED') {
    await stepRepository.finish(step.id, 'FAILED', 0);
    return {
      kind: 'needs_human',
      question: failure.humanMessage,
      error: failure.toClassified(),
    };
  }

  const decision: RecoveryDecision = await runRecoveryAgent(failure.toClassified(), {
    runId: ctx.runId,
    stepId: step.id,
    correlationId,
    stepObjective: step.objective,
    currentUrl: snapshot.url,
    pageDigest: snapshot.tree.slice(0, 4_000),
    budgetRemainingUsd: ctx.budgetRemainingUsd(),
  });

  if (decision.kind === 'escalate') {
    await stepRepository.setStatus(step.id, 'BLOCKED');
    return {
      kind: 'needs_human',
      question: decision.question ?? failure.humanMessage,
      error: failure.toClassified(),
    };
  }

  if (decision.strategy === 'skip_and_note') {
    await stepRepository.finish(step.id, 'SKIPPED', 0);
    return { kind: 'skipped', reason: decision.rationale };
  }

  if (decision.strategy === 'alternate_route' && decision.alternateUrl) {
    await browserDriver.navigate(ctx.session, decision.alternateUrl);
  } else if (decision.strategy === 'wait_longer') {
    await browserDriver.act(ctx.session, { type: 'wait_for', milliseconds: 5_000 });
  } else if (decision.strategy === 'rescroll_rescan') {
    await browserDriver.act(ctx.session, { type: 'scroll', direction: 'down', pixels: 600 });
  }

  return null;
}
