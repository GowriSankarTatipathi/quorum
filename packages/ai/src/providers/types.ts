import type { ModelId, Provider as ProviderName } from '../models.js';
import type { TokenUsage } from '../pricing.js';

export interface ImageInput {
  /** Base64-encoded image bytes, without a data-url prefix. */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface CompletionRequest {
  model: ModelId;
  system: string;
  user: string;
  images?: readonly ImageInput[];
  maxTokens: number;
  temperature: number;
  /** Ask the provider for strict JSON. Validation still happens at the boundary. */
  json: boolean;
  /** Milliseconds before the request is aborted. */
  timeoutMs: number;
  /** Called with each text delta when the provider streams. */
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

export interface RateLimitInfo {
  requestsRemaining?: number;
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
}

export interface CompletionResponse {
  /** Raw assistant text. Parsing and validation are the router's job, not the provider's. */
  text: string;
  usage: TokenUsage;
  model: ModelId;
  stopReason: string | null;
  latencyMs: number;
  /** Vendor request id, for correlating a support ticket with an exact call. */
  requestId?: string;
  /** What headroom the vendor says remains, so a run can slow before it is throttled. */
  rateLimit?: RateLimitInfo;
}

/**
 * The port every model vendor implements.
 *
 * Providers do exactly one thing: turn a request into text and token counts. They do not
 * retry, do not fall back, do not parse JSON and do not price anything — those are the
 * router's concerns, and keeping them out here is what makes adding a vendor a
 * ~120-line file rather than a negotiation with the rest of the system.
 */
export interface LlmProvider {
  readonly name: ProviderName | 'fixture';
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
