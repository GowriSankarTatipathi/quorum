export type LlmErrorClass =
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'PROVIDER_5XX'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'CONFIG'
  | 'BAD_REQUEST'
  | 'CONTENT_FILTER'
  | 'SCHEMA_VIOLATION'
  | 'UNKNOWN';

/** Transient classes are worth retrying against the same provider; the rest are not. */
const TRANSIENT: ReadonlySet<LlmErrorClass> = new Set([
  'RATE_LIMITED',
  'OVERLOADED',
  'PROVIDER_5XX',
  'TIMEOUT',
  'NETWORK',
]);

/** Everything a provider can tell us about how to behave next. */
export interface LlmErrorContext {
  status?: number;
  /** Seconds the server asked us to wait. Honoured in preference to our own backoff. */
  retryAfterSeconds?: number;
  /** Vendor request id, so a support ticket can reference the exact call. */
  requestId?: string;
  /** Vendor error type, e.g. "rate_limit_error", kept verbatim for telemetry. */
  vendorType?: string;
  rateLimit?: RateLimitSnapshot;
  cause?: unknown;
}

export interface RateLimitSnapshot {
  requestsRemaining?: number;
  requestsResetAt?: string;
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
  tokensResetAt?: string;
}

export class LlmError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;
  readonly vendorType?: string;
  readonly rateLimit?: RateLimitSnapshot;

  constructor(
    readonly errorClass: LlmErrorClass,
    message: string,
    readonly provider: string,
    readonly model: string,
    context: LlmErrorContext = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.status = context.status;
    this.retryAfterSeconds = context.retryAfterSeconds;
    this.requestId = context.requestId;
    this.vendorType = context.vendorType;
    this.rateLimit = context.rateLimit;
    this.cause = context.cause;
  }

  get transient(): boolean {
    return TRANSIENT.has(this.errorClass);
  }

  /** Structured form for logs and telemetry; never contains credentials. */
  toJSON(): Record<string, unknown> {
    return {
      errorClass: this.errorClass,
      provider: this.provider,
      model: this.model,
      status: this.status,
      vendorType: this.vendorType,
      requestId: this.requestId,
      retryAfterSeconds: this.retryAfterSeconds,
      rateLimit: this.rateLimit,
      message: this.message,
    };
  }
}

/** Raised when every configured provider has failed for one agent turn. */
export class AllProvidersFailedError extends Error {
  constructor(
    readonly agent: string,
    readonly attempts: readonly { model: string; errorClass: LlmErrorClass; message: string }[],
  ) {
    super(
      `Every model failed for the ${agent} agent: ${attempts
        .map((a) => `${a.model} (${a.errorClass})`)
        .join(', ')}`,
    );
    this.name = 'AllProvidersFailedError';
  }
}

/**
 * Anthropic names its failure modes in the body, which is more precise than the status:
 * `overloaded_error` arrives as a 529 and means "retry", `invalid_request_error` as a 400
 * and means "stop". Mapping the vendor type first means we act on what the server said
 * rather than inferring it.
 */
export function classifyVendorErrorType(type: string | undefined): LlmErrorClass | null {
  if (type === undefined) return null;
  switch (type) {
    case 'rate_limit_error':
      return 'RATE_LIMITED';
    case 'overloaded_error':
      return 'OVERLOADED';
    case 'api_error':
    case 'timeout_error':
      return 'PROVIDER_5XX';
    case 'authentication_error':
    case 'permission_error':
      return 'AUTH';
    case 'invalid_request_error':
    case 'not_found_error':
    case 'request_too_large':
      return 'BAD_REQUEST';
    default:
      return null;
  }
}

/**
 * HTTP status is the fallback signal when no vendor type is available: 429 means back off,
 * 401 means stop entirely, and retrying an auth failure three times just delays the
 * honest error.
 */
export function classifyHttpStatus(status: number): LlmErrorClass {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 529) return 'OVERLOADED';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status >= 500) return 'PROVIDER_5XX';
  return 'UNKNOWN';
}

export function classifyThrown(error: unknown): LlmErrorClass {
  if (error instanceof LlmError) return error.errorClass;
  if (error instanceof DOMException && error.name === 'AbortError') return 'TIMEOUT';
  if (error instanceof TypeError) return 'NETWORK';
  return 'UNKNOWN';
}
