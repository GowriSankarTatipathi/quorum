import { assertNever } from '../assert.js';
import type { AutonomyMode } from '../enums.js';
import type { BrowserAction, ElementDescriptor } from '../types/actions.js';

/**
 * Actions are classified by REVERSIBILITY, not by difficulty — reversibility is what
 * the user actually cares about. The classifier is a pure function: deterministic,
 * fast, unit-testable at 100% branch coverage, and impossible to prompt-inject. An
 * LLM deciding whether an action needs approval would be a security hole with extra
 * steps, because a malicious page could argue its way past the gate.
 */
export enum TrustLevel {
  /** screenshot, read DOM, scroll, extract — never gated */
  L0_READ = 0,
  /** navigate, follow a link, paginate — never gated */
  L1_NAV = 1,
  /** type into a field, select, toggle, upload — gated in `careful` */
  L2_MUTATE = 2,
  /** submit a form, click Pay/Send/Delete — always gated */
  L3_COMMIT = 3,
  /** auth, payment, off-allowlist navigation — always gated */
  L4_EXTERNAL = 4,
}

/** Shown verbatim in the approval modal. If a user cannot predict when they will be
 *  interrupted, interruptions feel arbitrary and they disable them. */
export const TRUST_EXPLANATIONS: Record<TrustLevel, string> = {
  [TrustLevel.L0_READ]: 'Reading the page. Nothing is changed.',
  [TrustLevel.L1_NAV]: 'Moving between pages. Fully reversible.',
  [TrustLevel.L2_MUTATE]:
    'Changing something on the page (typing, selecting, toggling). Reversible, but it alters state.',
  [TrustLevel.L3_COMMIT]:
    'This sends data or performs an action that cannot be undone from our side.',
  [TrustLevel.L4_EXTERNAL]:
    'This involves credentials, payment, or a site outside the approved list for this run.',
};

/** The autonomy dial controls FRICTION, never AUTHORITY: a product whose safety
 *  guarantees can be switched off has no guarantees, only a default. */
export const GATE_THRESHOLD: Record<AutonomyMode, TrustLevel> = {
  CAREFUL: TrustLevel.L2_MUTATE,
  BALANCED: TrustLevel.L3_COMMIT,
  AUTONOMOUS: TrustLevel.L3_COMMIT,
};

/** Verbs that indicate an irreversible commit. Matched against accessible names. */
const COMMIT_INTENT = [
  'submit',
  'send',
  'delete',
  'remove',
  'confirm',
  'apply now',
  'place order',
  'sign up',
  'create account',
  'request demo',
  'request a demo',
  'contact sales',
  'get started free',
  'save changes',
  'publish',
  'cancel subscription',
];

/** Verbs that indicate money movement or account binding. */
const PAYMENT_INTENT = [
  'pay',
  'checkout',
  'check out',
  'purchase',
  'buy',
  'subscribe',
  'add payment',
  'place order and pay',
  'authorize',
];

/** Names that indicate pure navigation. Paginating must stay free, or every run of
 *  any length becomes an approval treadmill and the gate loses its meaning. */
const NAV_INTENT = [
  'next',
  'previous',
  'prev',
  'more',
  'load more',
  'show more',
  'see all',
  'view all',
  'back',
  'continue reading',
  'page',
];

const TOGGLE_ROLES = new Set([
  'checkbox',
  'radio',
  'switch',
  'tab',
  'combobox',
  'listbox',
  'option',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
]);

const CREDENTIAL_INPUT_TYPES = new Set(['password']);

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const matchesAny = (name: string, phrases: readonly string[]): boolean => {
  const n = normalize(name);
  return phrases.some((p) => n === p || n.includes(p));
};

export interface ClassifyContext {
  /** Hosts the plan declared. Navigation outside them is L4 regardless of mode. */
  allowedHosts?: readonly string[];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `example.com` allows `example.com` and `www.example.com`, not `evil-example.com`. */
function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => {
    const base = a.toLowerCase().replace(/^www\./, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

function classifyClickTarget(target: ElementDescriptor): TrustLevel {
  if (matchesAny(target.name, PAYMENT_INTENT)) return TrustLevel.L4_EXTERNAL;
  if (target.isSubmit === true) return TrustLevel.L3_COMMIT;
  if (matchesAny(target.name, COMMIT_INTENT)) return TrustLevel.L3_COMMIT;
  if (matchesAny(target.name, NAV_INTENT)) return TrustLevel.L1_NAV;
  if (target.role === 'link') return TrustLevel.L1_NAV;
  if (TOGGLE_ROLES.has(target.role)) return TrustLevel.L2_MUTATE;
  // Unknown button: default to L2. Defaulting downward would make the gate advisory.
  return TrustLevel.L2_MUTATE;
}

/** Pure. Deterministic. The single security boundary for action authorisation. */
export function classify(action: BrowserAction, ctx: ClassifyContext = {}): TrustLevel {
  switch (action.type) {
    case 'screenshot':
    case 'extract_ready':
    case 'give_up':
    case 'scroll':
    case 'wait_for':
      return TrustLevel.L0_READ;

    case 'navigate': {
      const host = hostOf(action.url);
      if (host === null) return TrustLevel.L4_EXTERNAL; // unparseable target: treat as hostile
      if (ctx.allowedHosts && ctx.allowedHosts.length > 0 && !isHostAllowed(host, ctx.allowedHosts))
        return TrustLevel.L4_EXTERNAL;
      return TrustLevel.L1_NAV;
    }

    case 'click':
      return classifyClickTarget(action.target);

    case 'type': {
      if (action.target.inputType && CREDENTIAL_INPUT_TYPES.has(action.target.inputType))
        return TrustLevel.L4_EXTERNAL;
      return TrustLevel.L2_MUTATE;
    }

    case 'select':
      return TrustLevel.L2_MUTATE;

    case 'press': {
      // Enter inside a form control submits it. Treat it as the commit it is.
      if (action.key === 'Enter' && action.focused) {
        if (action.focused.inputType && CREDENTIAL_INPUT_TYPES.has(action.focused.inputType))
          return TrustLevel.L4_EXTERNAL;
        return TrustLevel.L3_COMMIT;
      }
      return TrustLevel.L1_NAV;
    }

    default:
      return assertNever(action, 'Unhandled browser action');
  }
}

export interface TrustVerdict {
  level: TrustLevel;
  requiresApproval: boolean;
  reason: string;
}

export function trustLadder(
  action: BrowserAction,
  mode: AutonomyMode,
  ctx: ClassifyContext = {},
): TrustVerdict {
  const level = classify(action, ctx);
  return {
    level,
    requiresApproval: level >= GATE_THRESHOLD[mode],
    reason: TRUST_EXPLANATIONS[level],
  };
}

/** True when a completed action cannot be reversed by our undo machinery. */
export function isIrreversible(action: BrowserAction, ctx: ClassifyContext = {}): boolean {
  return classify(action, ctx) >= TrustLevel.L3_COMMIT;
}
