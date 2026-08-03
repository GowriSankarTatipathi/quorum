/**
 * Never catch a generic error. Classify it, then map the class to an ordered ladder of
 * strategies with known costs. An unclassified `catch (e) { retry() }` is how agents burn
 * budget achieving nothing; classification is what makes recovery *intelligent* rather
 * than merely *persistent*.
 */
export const ERROR_CLASSES = [
  // Transient — the same action will probably work again.
  'NETWORK_TIMEOUT',
  'RATE_LIMITED',
  'PROVIDER_5XX',
  'PAGE_LOAD_TIMEOUT',

  // Page-state — the page is not where we thought it was.
  'ELEMENT_NOT_FOUND',
  'STALE_REF',
  'ELEMENT_NOT_INTERACTABLE',
  'OVERLAY_INTERCEPTED',
  'NO_OP_ACTION',
  'UNEXPECTED_NAVIGATION',

  // Content — the page is fine, the data is not what we expected.
  'CONTENT_MISSING',
  'SCHEMA_VIOLATION',
  'EMPTY_EXTRACTION',
  'AMBIGUOUS_CONTENT',
  'PAGINATION_LOOP',

  // Access — someone is deliberately stopping us.
  'AUTH_REQUIRED',
  'CAPTCHA_DETECTED',
  'BOT_WALL',
  'GEO_BLOCKED',
  'PAYWALL',
  'ROBOTS_DISALLOWED',

  // Model — the LLM is the problem.
  'LLM_REFUSAL',
  'LLM_HALLUCINATION_SUSPECTED',
  'LLM_LOW_CONFIDENCE',
  'ALL_PROVIDERS_FAILED',

  // Policy — we are stopping ourselves.
  'BUDGET_EXCEEDED',
  'TIME_EXCEEDED',
  'DOMAIN_NOT_ALLOWED',
  'APPROVAL_REJECTED',
  'APPROVAL_TIMEOUT',
  'INJECTION_DETECTED',

  // Fatal.
  'SESSION_LOST',
  'INTERNAL',
] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

export interface ErrorProfile {
  code: string;
  /**
   * Written for the person, not the developer. "Error: TimeoutError: waiting for
   * selector" is a message written for an engineer and shown to an accountant; the copy
   * in a failure is where a product's character is actually revealed, so it is a
   * required field rather than something that can be forgotten.
   */
  humanMessage: string;
  retryable: boolean;
  /** Some classes are never worth an autonomous attempt — a human resolves them faster. */
  requiresHuman: boolean;
}

export const ERROR_PROFILES: Record<ErrorClass, ErrorProfile> = {
  NETWORK_TIMEOUT: {
    code: 'E_NETWORK_TIMEOUT',
    humanMessage: 'The network stalled. Trying again.',
    retryable: true,
    requiresHuman: false,
  },
  RATE_LIMITED: {
    code: 'E_RATE_LIMITED',
    humanMessage: 'The site asked me to slow down. Backing off and retrying.',
    retryable: true,
    requiresHuman: false,
  },
  PROVIDER_5XX: {
    code: 'E_PROVIDER_5XX',
    humanMessage: 'The model provider had a problem. Retrying, then switching providers.',
    retryable: true,
    requiresHuman: false,
  },
  PAGE_LOAD_TIMEOUT: {
    code: 'E_PAGE_LOAD_TIMEOUT',
    humanMessage: "The page didn't finish loading in time. Trying again with a longer wait.",
    retryable: true,
    requiresHuman: false,
  },
  ELEMENT_NOT_FOUND: {
    code: 'E_ELEMENT_NOT_FOUND',
    humanMessage: "I couldn't find what I was looking for on the page. Looking again.",
    retryable: true,
    requiresHuman: false,
  },
  STALE_REF: {
    code: 'E_STALE_REF',
    humanMessage: 'The page changed while I was reading it. Re-reading it.',
    retryable: true,
    requiresHuman: false,
  },
  ELEMENT_NOT_INTERACTABLE: {
    code: 'E_ELEMENT_NOT_INTERACTABLE',
    humanMessage: "The control I wanted to use isn't clickable right now.",
    retryable: true,
    requiresHuman: false,
  },
  OVERLAY_INTERCEPTED: {
    code: 'E_OVERLAY_INTERCEPTED',
    humanMessage: 'Something is covering the page — a dialog or banner. Trying to dismiss it.',
    retryable: true,
    requiresHuman: false,
  },
  NO_OP_ACTION: {
    code: 'E_NO_OP_ACTION',
    humanMessage: 'I clicked, but nothing on the page changed. Trying a different approach.',
    retryable: true,
    requiresHuman: false,
  },
  UNEXPECTED_NAVIGATION: {
    code: 'E_UNEXPECTED_NAVIGATION',
    humanMessage: 'The page navigated somewhere I did not expect. Re-orienting.',
    retryable: true,
    requiresHuman: false,
  },
  CONTENT_MISSING: {
    code: 'E_CONTENT_MISSING',
    humanMessage: "The information I was sent for isn't on this page.",
    retryable: false,
    requiresHuman: false,
  },
  SCHEMA_VIOLATION: {
    code: 'E_SCHEMA_VIOLATION',
    humanMessage: "The extracted data didn't match the expected shape. Trying again.",
    retryable: true,
    requiresHuman: false,
  },
  EMPTY_EXTRACTION: {
    code: 'E_EMPTY_EXTRACTION',
    humanMessage: 'I read the page but found nothing to extract.',
    retryable: true,
    requiresHuman: false,
  },
  AMBIGUOUS_CONTENT: {
    code: 'E_AMBIGUOUS_CONTENT',
    humanMessage: 'This page can be read more than one way. I would rather you decide.',
    retryable: false,
    requiresHuman: false,
  },
  PAGINATION_LOOP: {
    code: 'E_PAGINATION_LOOP',
    humanMessage: 'The listing stopped advancing, so I stopped paging through it.',
    retryable: false,
    requiresHuman: false,
  },
  AUTH_REQUIRED: {
    code: 'E_AUTH_REQUIRED',
    humanMessage: 'This page needs a sign-in. Take over and I will pick up after you.',
    retryable: false,
    requiresHuman: true,
  },
  CAPTCHA_DETECTED: {
    code: 'E_CAPTCHA_DETECTED',
    humanMessage: "There's a CAPTCHA. You can solve it in seconds; I cannot solve it at all.",
    retryable: false,
    requiresHuman: true,
  },
  BOT_WALL: {
    code: 'E_BOT_WALL',
    humanMessage: 'This site is blocking automated visits. Trying another route.',
    retryable: false,
    requiresHuman: false,
  },
  GEO_BLOCKED: {
    code: 'E_GEO_BLOCKED',
    humanMessage: "This site isn't available from where I'm browsing.",
    retryable: false,
    requiresHuman: true,
  },
  PAYWALL: {
    code: 'E_PAYWALL',
    humanMessage: 'This content is behind a paywall.',
    retryable: false,
    requiresHuman: true,
  },
  ROBOTS_DISALLOWED: {
    code: 'E_ROBOTS_DISALLOWED',
    humanMessage:
      "This site's robots.txt asks automated visitors not to read this page. You can override that if you have a reason.",
    retryable: false,
    requiresHuman: true,
  },
  LLM_REFUSAL: {
    code: 'E_LLM_REFUSAL',
    humanMessage: 'The model declined this request. Trying a different one.',
    retryable: false,
    requiresHuman: false,
  },
  LLM_HALLUCINATION_SUSPECTED: {
    code: 'E_LLM_HALLUCINATION_SUSPECTED',
    humanMessage:
      "I could not find the text I claimed to have read on the page, so I'm discarding it.",
    retryable: true,
    requiresHuman: false,
  },
  LLM_LOW_CONFIDENCE: {
    code: 'E_LLM_LOW_CONFIDENCE',
    humanMessage: "I'm not confident enough in this reading to record it.",
    retryable: true,
    requiresHuman: false,
  },
  ALL_PROVIDERS_FAILED: {
    code: 'E_ALL_PROVIDERS_FAILED',
    humanMessage: 'Every model provider failed. This is on our side.',
    retryable: false,
    requiresHuman: false,
  },
  BUDGET_EXCEEDED: {
    code: 'E_BUDGET_EXCEEDED',
    humanMessage: 'This run reached its budget. Raise it to continue, or stop here.',
    retryable: false,
    requiresHuman: true,
  },
  TIME_EXCEEDED: {
    code: 'E_TIME_EXCEEDED',
    humanMessage: 'This run hit its time limit.',
    retryable: false,
    requiresHuman: true,
  },
  DOMAIN_NOT_ALLOWED: {
    code: 'E_DOMAIN_NOT_ALLOWED',
    humanMessage: 'That site is outside the list this run is allowed to visit.',
    retryable: false,
    requiresHuman: true,
  },
  APPROVAL_REJECTED: {
    code: 'E_APPROVAL_REJECTED',
    humanMessage: 'You rejected that step, so I skipped it.',
    retryable: false,
    requiresHuman: false,
  },
  APPROVAL_TIMEOUT: {
    code: 'E_APPROVAL_TIMEOUT',
    humanMessage: 'This has been waiting on your approval for a while, so I paused the run.',
    retryable: false,
    requiresHuman: true,
  },
  INJECTION_DETECTED: {
    code: 'E_INJECTION_DETECTED',
    humanMessage:
      'This page tried to give me instructions of its own. I stopped and did not follow them.',
    retryable: false,
    requiresHuman: true,
  },
  SESSION_LOST: {
    code: 'E_SESSION_LOST',
    humanMessage: 'The browser session ended unexpectedly. Starting a fresh one.',
    retryable: true,
    requiresHuman: false,
  },
  INTERNAL: {
    code: 'E_INTERNAL',
    humanMessage: 'Something went wrong on our side. The error has been recorded.',
    retryable: false,
    requiresHuman: false,
  },
};

export interface ClassifiedError {
  errorClass: ErrorClass;
  code: string;
  /** Developer-facing detail. Never shown to the person. */
  message: string;
  humanMessage: string;
  retryable: boolean;
  requiresHuman: boolean;
  evidence?: { screenshotKey?: string; domKey?: string; excerpt?: string };
}

export function classified(
  errorClass: ErrorClass,
  message: string,
  evidence?: ClassifiedError['evidence'],
): ClassifiedError {
  const profile = ERROR_PROFILES[errorClass];
  return {
    errorClass,
    code: profile.code,
    message,
    humanMessage: profile.humanMessage,
    retryable: profile.retryable,
    requiresHuman: profile.requiresHuman,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * A classified failure, thrown.
 *
 * `ClassifiedError` is data — it crosses process boundaries, is persisted, and is sent to
 * the browser. But a plain object thrown as an exception loses its stack trace and fails
 * every `instanceof Error` check between here and the top of the stack, so the throwable
 * form is a real Error that carries the data alongside it.
 */
export class ClassifiedActionError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  readonly humanMessage: string;
  readonly retryable: boolean;
  readonly requiresHuman: boolean;
  readonly evidence: ClassifiedError['evidence'];

  constructor(readonly detail: ClassifiedError) {
    super(detail.message);
    this.name = 'ClassifiedActionError';
    this.errorClass = detail.errorClass;
    this.code = detail.code;
    this.humanMessage = detail.humanMessage;
    this.retryable = detail.retryable;
    this.requiresHuman = detail.requiresHuman;
    this.evidence = detail.evidence;
  }

  toClassified(): ClassifiedError {
    return this.detail;
  }
}

export function throwable(
  errorClass: ErrorClass,
  message: string,
  evidence?: ClassifiedError['evidence'],
): ClassifiedActionError {
  return new ClassifiedActionError(classified(errorClass, message, evidence));
}

export const isClassifiedActionError = (value: unknown): value is ClassifiedActionError =>
  value instanceof ClassifiedActionError;

/** Signatures that identify a class from a thrown error's message. Ordered: first wins. */
const MESSAGE_SIGNATURES: [RegExp, ErrorClass][] = [
  [/\bcaptcha\b|recaptcha|hcaptcha|turnstile/i, 'CAPTCHA_DETECTED'],
  [/cloudflare|are you a (human|robot)|access denied|akamai|perimeterx/i, 'BOT_WALL'],
  [/\bsign in\b|\blog in\b|unauthorized|401/i, 'AUTH_REQUIRED'],
  [/not available in your (country|region)|geo.?block/i, 'GEO_BLOCKED'],
  [/subscribe to (read|continue)|paywall/i, 'PAYWALL'],
  [/intercepts pointer events|element is (covered|obscured)/i, 'OVERLAY_INTERCEPTED'],
  [/element is not visible|not (stable|enabled)|not interactable/i, 'ELEMENT_NOT_INTERACTABLE'],
  [/element .*not attached|stale element|node is detached/i, 'STALE_REF'],
  [/waiting for (selector|locator)|no element matches/i, 'ELEMENT_NOT_FOUND'],
  [/navigation timeout|timeout .*exceeded.*goto|net::ERR_/i, 'PAGE_LOAD_TIMEOUT'],
  [/timeout|timed out/i, 'NETWORK_TIMEOUT'],
  [/target (closed|crashed)|browser has been closed|session (closed|not found)/i, 'SESSION_LOST'],
  [/navigated to|frame was detached/i, 'UNEXPECTED_NAVIGATION'],
];

/**
 * Map a thrown browser error onto the taxonomy.
 *
 * Playwright reports everything as a `TimeoutError` or a plain `Error` with a prose
 * message, so signature matching is the only available signal. It is ordered most
 * specific first: a CAPTCHA page whose click also timed out is a CAPTCHA problem, and
 * treating it as a timeout would send the agent into a retry loop against a wall built
 * to stop it.
 */
export function classifyBrowserError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, errorClass] of MESSAGE_SIGNATURES) {
    if (pattern.test(message)) return classified(errorClass, message);
  }
  return classified('INTERNAL', message);
}
