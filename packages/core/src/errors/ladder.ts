import type { ErrorClass } from './taxonomy.js';

export const RECOVERY_STRATEGIES = [
  'retry_same',
  'wait_longer',
  'rescroll_rescan',
  'dismiss_overlay',
  'alternate_selector',
  'alternate_route',
  'switch_model',
  'decompose',
  'skip_and_note',
  'request_human',
  'abort_step_and_alert',
] as const;

export type RecoveryStrategy = (typeof RECOVERY_STRATEGIES)[number];

export interface RecoveryRung {
  strategy: RecoveryStrategy;
  maxAttempts: number;
  /**
   * Attached so the Recovery agent, which is given its remaining budget, can be filtered
   * to affordable rungs. A nearly-exhausted run degrades to `skip_and_note` rather than
   * dying at an LLM call it cannot pay for.
   */
  costUsd: number;
  timeoutMs?: number;
  backoff?: 'exponential';
}

/**
 * Rungs executed by the runtime, never offered to a model.
 *
 * The response to a suspected prompt injection must not be decided by the component the
 * injection is targeting. A unit test asserts the ladder and the agent's strategy
 * vocabulary are identical modulo this allowlist, so the two cannot silently drift.
 */
export const SYSTEM_ONLY_STRATEGIES: readonly RecoveryStrategy[] = ['abort_step_and_alert'];

const TERMINAL_HUMAN: RecoveryRung[] = [{ strategy: 'request_human', maxAttempts: 1, costUsd: 0 }];

export const RECOVERY_LADDER: Record<ErrorClass, RecoveryRung[]> = {
  PAGE_LOAD_TIMEOUT: [
    { strategy: 'wait_longer', maxAttempts: 1, costUsd: 0, timeoutMs: 20_000 },
    { strategy: 'retry_same', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.01 },
    ...TERMINAL_HUMAN,
  ],
  NETWORK_TIMEOUT: [
    { strategy: 'retry_same', maxAttempts: 2, costUsd: 0, backoff: 'exponential' },
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.01 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  RATE_LIMITED: [
    { strategy: 'retry_same', maxAttempts: 3, costUsd: 0, backoff: 'exponential' },
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.03 },
  ],
  PROVIDER_5XX: [
    { strategy: 'retry_same', maxAttempts: 2, costUsd: 0, backoff: 'exponential' },
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.03 },
  ],
  ELEMENT_NOT_FOUND: [
    { strategy: 'rescroll_rescan', maxAttempts: 2, costUsd: 0 },
    { strategy: 'dismiss_overlay', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_selector', maxAttempts: 1, costUsd: 0.01 },
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  STALE_REF: [
    { strategy: 'rescroll_rescan', maxAttempts: 1, costUsd: 0 },
    { strategy: 'retry_same', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_selector', maxAttempts: 1, costUsd: 0.01 },
  ],
  ELEMENT_NOT_INTERACTABLE: [
    { strategy: 'wait_longer', maxAttempts: 1, costUsd: 0 },
    { strategy: 'dismiss_overlay', maxAttempts: 1, costUsd: 0 },
    { strategy: 'rescroll_rescan', maxAttempts: 1, costUsd: 0 },
    ...TERMINAL_HUMAN,
  ],
  OVERLAY_INTERCEPTED: [
    { strategy: 'dismiss_overlay', maxAttempts: 2, costUsd: 0 },
    { strategy: 'alternate_selector', maxAttempts: 1, costUsd: 0.01 },
    ...TERMINAL_HUMAN,
  ],
  NO_OP_ACTION: [
    { strategy: 'wait_longer', maxAttempts: 1, costUsd: 0 },
    { strategy: 'dismiss_overlay', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_selector', maxAttempts: 1, costUsd: 0.01 },
    ...TERMINAL_HUMAN,
  ],
  UNEXPECTED_NAVIGATION: [
    { strategy: 'rescroll_rescan', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  CONTENT_MISSING: [
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  SCHEMA_VIOLATION: [
    { strategy: 'retry_same', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.04 },
    { strategy: 'decompose', maxAttempts: 1, costUsd: 0.05 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  EMPTY_EXTRACTION: [
    { strategy: 'rescroll_rescan', maxAttempts: 1, costUsd: 0 },
    { strategy: 'wait_longer', maxAttempts: 1, costUsd: 0 },
    { strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  AMBIGUOUS_CONTENT: [
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.04 },
    // A three-second question to a human beats an expensive guess.
    ...TERMINAL_HUMAN,
  ],
  PAGINATION_LOOP: [{ strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 }],
  // No autonomous attempt: spending ninety seconds failing at a task designed to be
  // unsolvable by machines, while the human watching could do it in four, is not
  // persistence.
  CAPTCHA_DETECTED: TERMINAL_HUMAN,
  AUTH_REQUIRED: TERMINAL_HUMAN,
  GEO_BLOCKED: TERMINAL_HUMAN,
  PAYWALL: TERMINAL_HUMAN,
  ROBOTS_DISALLOWED: TERMINAL_HUMAN,
  BOT_WALL: [{ strategy: 'alternate_route', maxAttempts: 1, costUsd: 0.02 }, ...TERMINAL_HUMAN],
  LLM_REFUSAL: [
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.04 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  LLM_HALLUCINATION_SUSPECTED: [
    { strategy: 'retry_same', maxAttempts: 1, costUsd: 0.02 },
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.04 },
    { strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 },
  ],
  LLM_LOW_CONFIDENCE: [
    { strategy: 'switch_model', maxAttempts: 1, costUsd: 0.04 },
    ...TERMINAL_HUMAN,
  ],
  ALL_PROVIDERS_FAILED: [{ strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 }],
  BUDGET_EXCEEDED: TERMINAL_HUMAN,
  TIME_EXCEEDED: TERMINAL_HUMAN,
  DOMAIN_NOT_ALLOWED: TERMINAL_HUMAN,
  APPROVAL_REJECTED: [{ strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 }],
  APPROVAL_TIMEOUT: TERMINAL_HUMAN,
  INJECTION_DETECTED: [{ strategy: 'abort_step_and_alert', maxAttempts: 1, costUsd: 0 }],
  SESSION_LOST: [{ strategy: 'retry_same', maxAttempts: 1, costUsd: 0 }, ...TERMINAL_HUMAN],
  INTERNAL: [{ strategy: 'skip_and_note', maxAttempts: 1, costUsd: 0 }],
};

/** Hard caps on top of the ladder. Clever systems need dumb guardrails: ladders can
 *  interact badly, and a global counter is a simple backstop against emergent loops. */
export const MAX_RECOVERY_ATTEMPTS_PER_STEP = 4;
export const MAX_RECOVERY_ATTEMPTS_PER_RUN = 10;

export interface LadderContext {
  errorClass: ErrorClass;
  /** Strategies already tried for this failure, with how many times each was used. */
  attempted: readonly RecoveryStrategy[];
  budgetRemainingUsd: number;
}

/** Rungs that are still affordable and not yet exhausted, in ladder order. */
export function availableRungs(context: LadderContext): RecoveryRung[] {
  const used = new Map<RecoveryStrategy, number>();
  for (const strategy of context.attempted) {
    used.set(strategy, (used.get(strategy) ?? 0) + 1);
  }
  return RECOVERY_LADDER[context.errorClass].filter(
    (rung) =>
      (used.get(rung.strategy) ?? 0) < rung.maxAttempts &&
      rung.costUsd <= context.budgetRemainingUsd,
  );
}

/** Strategies the Recovery agent may choose from — the ladder minus system-only rungs. */
export function agentSelectableStrategies(errorClass: ErrorClass): RecoveryStrategy[] {
  return RECOVERY_LADDER[errorClass]
    .map((rung) => rung.strategy)
    .filter((strategy) => !SYSTEM_ONLY_STRATEGIES.includes(strategy));
}

export function hasNextStrategy(context: LadderContext): boolean {
  return availableRungs(context).length > 0;
}
