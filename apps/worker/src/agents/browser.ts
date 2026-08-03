import { BrowserActionOutputSchema, PROMPT_REGISTRY, type BrowserActionOutput } from '@quorum/ai';
import { throwable, type BrowserAction, type ElementDescriptor } from '@quorum/core';
import type { PageSnapshot } from '@quorum/browser';
import { eventPublisher } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';

export interface BrowserAgentContext {
  runId: string;
  stepId: string;
  correlationId: string;
  stepObjective: string;
  snapshot: PageSnapshot;
  recentActions: string[];
  attempt: number;
  maxAttempts: number;
}

export interface BrowserAgentDecision {
  action: BrowserAction;
  reasoning: string;
  confidence: number;
}

/**
 * Resolve the model's numeric ref into a full descriptor.
 *
 * The model chooses a number; the descriptor it maps to comes from our own snapshot. That
 * is what lets the Trust Ladder classify on real element attributes rather than on
 * anything the model asserted — a model cannot claim a submit button is a link in order to
 * slip past the gate.
 */
function resolveRef(snapshot: PageSnapshot, ref: number): ElementDescriptor {
  const element = snapshot.elements.get(ref);
  if (!element) {
    throw throwable(
      'STALE_REF',
      `The model referenced [${String(ref)}], which is not in the current snapshot`,
    );
  }
  return element;
}

function toBrowserAction(output: BrowserActionOutput, snapshot: PageSnapshot): BrowserAction {
  const action = output.action;
  switch (action.type) {
    case 'navigate':
      return { type: 'navigate', url: action.url };
    case 'click':
      return { type: 'click', ref: action.ref, target: resolveRef(snapshot, action.ref) };
    case 'type':
      return {
        type: 'type',
        ref: action.ref,
        target: resolveRef(snapshot, action.ref),
        text: action.text,
      };
    case 'select':
      return {
        type: 'select',
        ref: action.ref,
        target: resolveRef(snapshot, action.ref),
        value: action.value,
      };
    case 'scroll':
      return { type: 'scroll', direction: action.direction, pixels: action.pixels };
    case 'wait_for':
      return {
        type: 'wait_for',
        ...(action.ref === null ? {} : { ref: action.ref }),
        ...(action.milliseconds === null ? {} : { milliseconds: action.milliseconds }),
      };
    case 'press':
      // A key press against a focused form control is a commit, so the focused element is
      // attached for the Trust Ladder to classify on.
      return { type: 'press', key: action.key };
    case 'screenshot':
      return { type: 'screenshot' };
    case 'extract_ready':
      return { type: 'extract_ready', ...(action.note === null ? {} : { note: action.note }) };
    case 'give_up':
      return { type: 'give_up', reason: action.reason };
  }
}

/**
 * Decide the next single action on the current page.
 *
 * The agent proposes; it does not execute. Separating the two is what allows the Trust
 * Ladder gate, the undo capture and the highlight-before-click affordance to sit between
 * the decision and its consequence.
 */
export async function runBrowserAgent(ctx: BrowserAgentContext): Promise<BrowserAgentDecision> {
  const started = Date.now();
  const eventCtx = {
    runId: ctx.runId,
    agent: 'browser' as const,
    stepId: ctx.stepId,
    correlationId: ctx.correlationId,
  };

  await eventPublisher.emit('agent.started', { agent: 'browser', stepIndex: null }, eventCtx);

  const prompt = PROMPT_REGISTRY.browser.build({
    stepObjective: ctx.stepObjective,
    page: ctx.snapshot.tree,
    url: ctx.snapshot.url,
    recentActions: ctx.recentActions,
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
  });

  const router = createRouter(new RunTelemetry(ctx.runId, ctx.stepId, ctx.correlationId));
  const { data } = await router.call(
    {
      agent: 'browser',
      promptVersion: PROMPT_REGISTRY.browser.version,
      system: prompt.system,
      user: prompt.user,
    },
    BrowserActionOutputSchema,
  );

  if (data.injectionDetected) {
    await eventPublisher.emit(
      'security.injection_detected',
      { excerpt: data.injectionExcerpt ?? '(no excerpt)', url: ctx.snapshot.url },
      eventCtx,
    );
    // Continuing here is unsafe at any price, so this is the one failure the runtime
    // handles itself rather than handing to the Recovery agent.
    throw throwable('INJECTION_DETECTED', 'page content attempted to issue instructions', {
      excerpt: data.injectionExcerpt ?? undefined,
    });
  }

  const action = toBrowserAction(data, ctx.snapshot);

  await eventPublisher.emit(
    'agent.finished',
    { agent: 'browser', durationMs: Date.now() - started, confidence: data.confidence },
    eventCtx,
  );

  return { action, reasoning: data.reasoning, confidence: data.confidence };
}
