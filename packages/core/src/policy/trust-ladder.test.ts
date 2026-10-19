import { describe, expect, it } from 'vitest';
import {
  GATE_THRESHOLD,
  TrustLevel,
  classify,
  isIrreversible,
  trustLadder,
} from './trust-ladder.js';
import type { BrowserAction, ElementDescriptor } from '../types/actions.js';

const el = (over: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  ref: 1,
  role: 'button',
  name: 'Button',
  ...over,
});

describe('classify — L0 read', () => {
  const reads: BrowserAction[] = [
    { type: 'screenshot' },
    { type: 'extract_ready' },
    { type: 'give_up', reason: 'blocked' },
    { type: 'scroll', direction: 'down', pixels: 400 },
    { type: 'wait_for', milliseconds: 500 },
  ];
  it.each(reads)('$type is L0', (action) => {
    expect(classify(action)).toBe(TrustLevel.L0_READ);
  });
});

describe('classify — navigation', () => {
  it('is L1 with no allowlist', () => {
    expect(classify({ type: 'navigate', url: 'https://ramp.com/pricing' })).toBe(TrustLevel.L1_NAV);
  });
  it('is L1 for an allowed host and its subdomains', () => {
    const ctx = { allowedHosts: ['ramp.com'] };
    expect(classify({ type: 'navigate', url: 'https://www.ramp.com/pricing' }, ctx)).toBe(
      TrustLevel.L1_NAV,
    );
    expect(classify({ type: 'navigate', url: 'https://app.ramp.com/x' }, ctx)).toBe(
      TrustLevel.L1_NAV,
    );
  });
  it('is L4 for a look-alike host', () => {
    expect(
      classify(
        { type: 'navigate', url: 'https://evil-ramp.com/x' },
        { allowedHosts: ['ramp.com'] },
      ),
    ).toBe(TrustLevel.L4_EXTERNAL);
  });
  it('is L4 for an unparseable url', () => {
    expect(classify({ type: 'navigate', url: 'not a url' })).toBe(TrustLevel.L4_EXTERNAL);
  });
});

describe('classify — clicks', () => {
  it('links are L1', () => {
    expect(classify({ type: 'click', ref: 1, target: el({ role: 'link', name: 'Pricing' }) })).toBe(
      TrustLevel.L1_NAV,
    );
  });
  it('pagination controls are L1 so runs are not an approval treadmill', () => {
    expect(classify({ type: 'click', ref: 1, target: el({ name: 'Next' }) })).toBe(
      TrustLevel.L1_NAV,
    );
    expect(classify({ type: 'click', ref: 1, target: el({ name: 'Load more' }) })).toBe(
      TrustLevel.L1_NAV,
    );
  });
  it('toggles are L2', () => {
    expect(
      classify({ type: 'click', ref: 1, target: el({ role: 'switch', name: 'Annual' }) }),
    ).toBe(TrustLevel.L2_MUTATE);
  });
  it('unknown buttons default upward to L2, never downward', () => {
    expect(classify({ type: 'click', ref: 1, target: el({ name: 'Do the thing' }) })).toBe(
      TrustLevel.L2_MUTATE,
    );
  });
  it('submit buttons are L3', () => {
    expect(classify({ type: 'click', ref: 1, target: el({ name: 'Go', isSubmit: true }) })).toBe(
      TrustLevel.L3_COMMIT,
    );
  });
  it('commit verbs are L3', () => {
    for (const name of ['Submit', 'Request a demo', 'Delete account', 'Contact sales']) {
      expect(classify({ type: 'click', ref: 1, target: el({ name }) })).toBe(TrustLevel.L3_COMMIT);
    }
  });
  it('payment verbs are L4 and outrank submit', () => {
    expect(
      classify({ type: 'click', ref: 1, target: el({ name: 'Pay now', isSubmit: true }) }),
    ).toBe(TrustLevel.L4_EXTERNAL);
  });
});

describe('classify — typing', () => {
  it('ordinary text entry is L2', () => {
    expect(classify({ type: 'type', ref: 1, target: el({ role: 'textbox' }), text: 'hello' })).toBe(
      TrustLevel.L2_MUTATE,
    );
  });
  it('password fields are L4', () => {
    expect(
      classify({
        type: 'type',
        ref: 1,
        target: el({ role: 'textbox', inputType: 'password' }),
        text: 'hunter2',
      }),
    ).toBe(TrustLevel.L4_EXTERNAL);
  });
  it('select is L2', () => {
    expect(classify({ type: 'select', ref: 1, target: el({ role: 'combobox' }), value: 'a' })).toBe(
      TrustLevel.L2_MUTATE,
    );
  });
});

describe('classify — key presses', () => {
  it('plain keys are L1', () => {
    expect(classify({ type: 'press', key: 'Escape' })).toBe(TrustLevel.L1_NAV);
    expect(classify({ type: 'press', key: 'Enter' })).toBe(TrustLevel.L1_NAV);
  });
  it('Enter inside a form control is the commit it actually is', () => {
    expect(classify({ type: 'press', key: 'Enter', focused: el({ role: 'textbox' }) })).toBe(
      TrustLevel.L3_COMMIT,
    );
  });
  it('Enter inside a password field is L4', () => {
    expect(classify({ type: 'press', key: 'Enter', focused: el({ inputType: 'password' }) })).toBe(
      TrustLevel.L4_EXTERNAL,
    );
  });
});

describe('trustLadder gating by mode', () => {
  const toggle: BrowserAction = {
    type: 'click',
    ref: 1,
    target: el({ role: 'switch', name: 'Annual' }),
  };
  const submit: BrowserAction = { type: 'click', ref: 1, target: el({ name: 'Submit' }) };

  it('careful gates L2', () => {
    expect(trustLadder(toggle, 'CAREFUL').requiresApproval).toBe(true);
  });
  it('balanced does not gate L2', () => {
    expect(trustLadder(toggle, 'BALANCED').requiresApproval).toBe(false);
  });
  it('L3 is gated in EVERY mode, including autonomous', () => {
    for (const mode of ['CAREFUL', 'BALANCED', 'AUTONOMOUS'] as const) {
      expect(trustLadder(submit, mode).requiresApproval).toBe(true);
    }
  });
  it('no mode ever raises the threshold above L3', () => {
    for (const t of Object.values(GATE_THRESHOLD))
      expect(t).toBeLessThanOrEqual(TrustLevel.L3_COMMIT);
  });
  it('always returns a human-readable reason', () => {
    expect(trustLadder(submit, 'BALANCED').reason.length).toBeGreaterThan(10);
  });
});

describe('isIrreversible', () => {
  it('is true at L3 and above, false below', () => {
    expect(isIrreversible({ type: 'click', ref: 1, target: el({ name: 'Submit' }) })).toBe(true);
    expect(isIrreversible({ type: 'scroll', direction: 'down', pixels: 10 })).toBe(false);
  });
});

describe('billing period selectors', () => {
  it.each(['Pay monthly', 'Pay annually', 'Pay yearly'])(
    'treats %s radio as a reversible choice',
    (name) => {
      const action: BrowserAction = {
        type: 'click',
        ref: 1,
        target: el({ name, role: 'radio', isSubmit: false }),
      };
      expect(trustLadder(action, 'BALANCED').requiresApproval).toBe(false);
      expect(trustLadder(action, 'CAREFUL').requiresApproval).toBe(true);
      expect(classify(action)).toBe(TrustLevel.L2_MUTATE);
    },
  );
  it.each([
    { name: 'Pay monthly', role: 'button', isSubmit: false },
    { name: 'Pay monthly', role: 'radio', isSubmit: true },
    { name: 'Pay monthly and subscribe', role: 'radio', isSubmit: false },
    { name: 'Pay now', role: 'radio', isSubmit: false },
  ])('keeps payment actions gated: $name / $role', (target) => {
    expect(classify({ type: 'click', ref: 1, target: el(target) })).toBe(TrustLevel.L4_EXTERNAL);
  });
});
