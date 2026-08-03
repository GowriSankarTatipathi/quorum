import { describe, expect, it } from 'vitest';
import { ERROR_CLASSES, ERROR_PROFILES, classified, classifyBrowserError } from './taxonomy.js';
import {
  MAX_RECOVERY_ATTEMPTS_PER_STEP,
  RECOVERY_LADDER,
  RECOVERY_STRATEGIES,
  SYSTEM_ONLY_STRATEGIES,
  agentSelectableStrategies,
  availableRungs,
  hasNextStrategy,
} from './ladder.js';

describe('error profiles', () => {
  it('gives every class a code, a human message and a recovery ladder', () => {
    for (const errorClass of ERROR_CLASSES) {
      const profile = ERROR_PROFILES[errorClass];
      expect(profile.code).toMatch(/^E_[A-Z0-9_]+$/);
      expect(profile.humanMessage.length).toBeGreaterThan(15);
      expect(RECOVERY_LADDER[errorClass].length).toBeGreaterThan(0);
    }
  });

  it('writes human messages for a person, not a stack trace', () => {
    for (const errorClass of ERROR_CLASSES) {
      const message = ERROR_PROFILES[errorClass].humanMessage;
      expect(message).not.toMatch(/Error:|undefined|null|selector|stack|exception/i);
      expect(message[0]).toBe(message[0]?.toUpperCase());
    }
  });

  it('marks exactly the classes a machine cannot resolve as requiring a human', () => {
    expect(ERROR_PROFILES.CAPTCHA_DETECTED.requiresHuman).toBe(true);
    expect(ERROR_PROFILES.AUTH_REQUIRED.requiresHuman).toBe(true);
    expect(ERROR_PROFILES.BUDGET_EXCEEDED.requiresHuman).toBe(true);
    expect(ERROR_PROFILES.ELEMENT_NOT_FOUND.requiresHuman).toBe(false);
  });
});

describe('classifyBrowserError', () => {
  it('recognises a CAPTCHA before a timeout, because retrying one is pointless', () => {
    // A CAPTCHA page whose click also timed out is a CAPTCHA problem. Reading it as a
    // timeout sends the agent into a retry loop against a wall built to stop it.
    const result = classifyBrowserError(
      new Error('Timeout 5000ms exceeded waiting for reCAPTCHA challenge'),
    );
    expect(result.errorClass).toBe('CAPTCHA_DETECTED');
    expect(result.requiresHuman).toBe(true);
  });

  it('recognises an intercepting overlay', () => {
    expect(classifyBrowserError(new Error('element intercepts pointer events')).errorClass).toBe(
      'OVERLAY_INTERCEPTED',
    );
  });

  it('recognises a stale handle', () => {
    expect(classifyBrowserError(new Error('Element is not attached to the DOM')).errorClass).toBe(
      'STALE_REF',
    );
  });

  it('separates a navigation timeout from a generic one', () => {
    expect(
      classifyBrowserError(new Error('Navigation timeout of 30000 ms exceeded')).errorClass,
    ).toBe('PAGE_LOAD_TIMEOUT');
    expect(classifyBrowserError(new Error('Timeout 5000ms exceeded')).errorClass).toBe(
      'NETWORK_TIMEOUT',
    );
  });

  it('recognises a lost session', () => {
    expect(
      classifyBrowserError(new Error('Target page, context or browser has been closed')).errorClass,
    ).toBe('SESSION_LOST');
  });

  it('recognises a bot wall', () => {
    expect(classifyBrowserError(new Error('Attention Required! | Cloudflare')).errorClass).toBe(
      'BOT_WALL',
    );
  });

  it('falls back to INTERNAL rather than guessing', () => {
    expect(classifyBrowserError(new Error('something bizarre')).errorClass).toBe('INTERNAL');
  });

  it('handles a non-Error throw', () => {
    expect(classifyBrowserError('a string').errorClass).toBe('INTERNAL');
  });

  it('carries evidence when supplied', () => {
    const result = classified('NO_OP_ACTION', 'click did nothing', { screenshotKey: 'k' });
    expect(result.evidence?.screenshotKey).toBe('k');
  });
});

describe('recovery ladder', () => {
  it('places terminal rungs last, so escalation is never skipped past', () => {
    // `request_human` and `skip_and_note` end a ladder by definition: anything after them
    // would be unreachable, and a ladder that escalates in the middle would keep spending
    // after it had already decided to stop.
    const terminal = new Set(['request_human', 'skip_and_note', 'abort_step_and_alert']);
    for (const errorClass of ERROR_CLASSES) {
      const strategies = RECOVERY_LADDER[errorClass].map((rung) => rung.strategy);
      const firstTerminal = strategies.findIndex((s) => terminal.has(s));
      if (firstTerminal === -1) continue;
      expect(firstTerminal).toBe(strategies.length - 1);
    }
  });

  it('tries free rungs before paid ones wherever both resolve the same failure', () => {
    // Escalating to a human is priced at zero but is deliberately last, so the ordering
    // invariant applies only among the autonomous rungs that precede it.
    for (const errorClass of ERROR_CLASSES) {
      const autonomous = RECOVERY_LADDER[errorClass].filter(
        (rung) => rung.strategy !== 'request_human' && rung.strategy !== 'skip_and_note',
      );
      const costs = autonomous.map((rung) => rung.costUsd);
      expect(costs).toEqual([...costs].sort((a, b) => a - b));
    }
  });

  it('never asks a model to solve a CAPTCHA', () => {
    expect(RECOVERY_LADDER.CAPTCHA_DETECTED).toEqual([
      { strategy: 'request_human', maxAttempts: 1, costUsd: 0 },
    ]);
  });

  it('aborts on a suspected injection instead of continuing at any price', () => {
    expect(RECOVERY_LADDER.INJECTION_DETECTED.map((r) => r.strategy)).toEqual([
      'abort_step_and_alert',
    ]);
  });

  it('keeps the injection response out of the agent-selectable vocabulary', () => {
    // The response to an injection must not be decided by the component being targeted.
    expect(agentSelectableStrategies('INJECTION_DETECTED')).toEqual([]);
    for (const errorClass of ERROR_CLASSES) {
      for (const strategy of agentSelectableStrategies(errorClass)) {
        expect(SYSTEM_ONLY_STRATEGIES).not.toContain(strategy);
      }
    }
  });

  it('uses only declared strategies', () => {
    for (const errorClass of ERROR_CLASSES) {
      for (const rung of RECOVERY_LADDER[errorClass]) {
        expect(RECOVERY_STRATEGIES).toContain(rung.strategy);
      }
    }
  });
});

describe('availableRungs', () => {
  const context = {
    errorClass: 'ELEMENT_NOT_FOUND' as const,
    attempted: [],
    budgetRemainingUsd: 1,
  };

  it('returns the full ladder when nothing has been tried', () => {
    expect(availableRungs(context)).toHaveLength(RECOVERY_LADDER.ELEMENT_NOT_FOUND.length);
  });

  it('drops a rung once its attempt allowance is used up', () => {
    const after = availableRungs({
      ...context,
      attempted: ['rescroll_rescan', 'rescroll_rescan'],
    });
    expect(after.map((r) => r.strategy)).not.toContain('rescroll_rescan');
  });

  it('filters out rungs the run can no longer afford', () => {
    const broke = availableRungs({ ...context, budgetRemainingUsd: 0 });
    expect(broke.every((rung) => rung.costUsd === 0)).toBe(true);
    // A nearly-exhausted run still degrades gracefully rather than dying at an LLM call.
    expect(broke.map((r) => r.strategy)).toContain('skip_and_note');
  });

  it('reports exhaustion once every rung is spent', () => {
    const exhausted = {
      errorClass: 'CAPTCHA_DETECTED' as const,
      attempted: ['request_human' as const],
      budgetRemainingUsd: 1,
    };
    expect(hasNextStrategy(exhausted)).toBe(false);
  });

  it('caps attempts per step as a backstop against emergent loops', () => {
    expect(MAX_RECOVERY_ATTEMPTS_PER_STEP).toBeLessThanOrEqual(5);
  });
});
