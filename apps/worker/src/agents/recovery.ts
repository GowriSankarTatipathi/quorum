import { PROMPT_REGISTRY, RecoveryOutputSchema, type RecoveryAttemptView } from '@quorum/ai';
import {
  MAX_RECOVERY_ATTEMPTS_PER_STEP,
  agentSelectableStrategies,
  availableRungs,
  type ClassifiedError,
  type RecoveryStrategy,
} from '@quorum/core';
import { recoveryRepository } from '@quorum/db';
import { eventPublisher } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';

export interface RecoveryContext {
  runId: string;
  stepId: string;
  correlationId: string;
  stepObjective: string;
  currentUrl: string;
  pageDigest: string;
  budgetRemainingUsd: number;
}

export type RecoveryDecision =
  | {
      kind: 'strategy';
      strategy: RecoveryStrategy;
      rationale: string;
      expectedOutcome: string;
      alternateUrl: string | null;
      attemptId: string;
    }
  | {
      kind: 'escalate';
      reason: 'exhausted' | 'requires_human' | 'attempt_cap';
      question: string | null;
    };

/**
 * Choose the next recovery strategy for a classified failure.
 *
 * The model never sees the full ladder. Rungs already tried, and rungs the remaining
 * budget cannot afford, are removed before the prompt is built — so it chooses from what
 * is genuinely still open rather than proposing something the runtime would then refuse.
 * Classes that require a human, and the injection response, never reach it at all.
 */
export async function runRecoveryAgent(
  error: ClassifiedError,
  ctx: RecoveryContext,
): Promise<RecoveryDecision> {
  const started = Date.now();
  const eventCtx = {
    runId: ctx.runId,
    agent: 'recovery' as const,
    stepId: ctx.stepId,
    correlationId: ctx.correlationId,
  };

  await eventPublisher.emit('agent.started', { agent: 'recovery', stepIndex: null }, eventCtx);

  const history = await recoveryRepository.listForStep(ctx.stepId);

  // A dumb guardrail on top of a clever system: ladders can interact badly, and a global
  // counter is the backstop against loops nobody predicted.
  if (history.length >= MAX_RECOVERY_ATTEMPTS_PER_STEP) {
    await eventPublisher.emit(
      'recovery.exhausted',
      { attempts: history.length, escalatingTo: 'human' },
      eventCtx,
    );
    return { kind: 'escalate', reason: 'attempt_cap', question: null };
  }

  // Some classes are never worth an autonomous attempt. Asking a model whether to try
  // solving a CAPTCHA is a question with an obviously wrong answer available.
  if (error.requiresHuman) {
    await eventPublisher.emit(
      'recovery.exhausted',
      { attempts: history.length, escalatingTo: 'human' },
      eventCtx,
    );
    return { kind: 'escalate', reason: 'requires_human', question: error.humanMessage };
  }

  const attempted = history.map((attempt) => attempt.strategy as RecoveryStrategy);
  const rungs = availableRungs({
    errorClass: error.errorClass,
    attempted,
    budgetRemainingUsd: ctx.budgetRemainingUsd,
  });

  const selectable = agentSelectableStrategies(error.errorClass);
  const offered = rungs
    .map((rung) => rung.strategy)
    .filter((strategy) => selectable.includes(strategy));

  if (offered.length === 0) {
    await eventPublisher.emit(
      'recovery.exhausted',
      { attempts: history.length, escalatingTo: 'human' },
      eventCtx,
    );
    return { kind: 'escalate', reason: 'exhausted', question: null };
  }

  await eventPublisher.emit(
    'recovery.started',
    { errorCode: error.code, attempt: history.length + 1 },
    eventCtx,
  );

  const attemptViews: RecoveryAttemptView[] = history.map((attempt) => ({
    attempt: attempt.attempt,
    strategy: attempt.strategy,
    succeeded: attempt.succeeded,
  }));

  const prompt = PROMPT_REGISTRY.recovery.build({
    errorClass: error.errorClass,
    errorMessage: error.message,
    humanMessage: error.humanMessage,
    availableStrategies: offered,
    attempts: attemptViews,
    pageDigest: ctx.pageDigest,
    currentUrl: ctx.currentUrl,
    stepObjective: ctx.stepObjective,
    budgetRemainingUsd: ctx.budgetRemainingUsd,
  });

  const router = createRouter(new RunTelemetry(ctx.runId, ctx.stepId, ctx.correlationId));
  const { data } = await router.call(
    {
      agent: 'recovery',
      promptVersion: PROMPT_REGISTRY.recovery.version,
      system: prompt.system,
      user: prompt.user,
    },
    RecoveryOutputSchema,
  );

  // The schema constrains the vocabulary, but not to *this* error's still-open rungs. A
  // strategy outside the offered set is treated as exhaustion rather than executed.
  if (!offered.includes(data.strategy)) {
    await eventPublisher.emit(
      'recovery.exhausted',
      { attempts: history.length, escalatingTo: 'human' },
      eventCtx,
    );
    return { kind: 'escalate', reason: 'exhausted', question: null };
  }

  if (data.strategy === 'request_human') {
    return { kind: 'escalate', reason: 'requires_human', question: data.humanQuestion };
  }

  const attempt = await recoveryRepository.record({
    stepId: ctx.stepId,
    attempt: history.length + 1,
    errorCode: error.code,
    errorClass: error.errorClass,
    strategy: data.strategy,
    rationale: data.rationale,
    expectedOutcome: data.expectedOutcome,
  });

  await eventPublisher.emit(
    'recovery.strategy.chosen',
    {
      strategy: data.strategy,
      rationale: data.rationale,
      expectedOutcome: data.expectedOutcome,
    },
    eventCtx,
  );
  await eventPublisher.emit(
    'agent.finished',
    { agent: 'recovery', durationMs: Date.now() - started, confidence: null },
    eventCtx,
  );

  return {
    kind: 'strategy',
    strategy: data.strategy,
    rationale: data.rationale,
    expectedOutcome: data.expectedOutcome,
    alternateUrl: data.alternateUrl,
    attemptId: attempt.id,
  };
}
