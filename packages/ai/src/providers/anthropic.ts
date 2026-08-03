import {
  LlmError,
  classifyHttpStatus,
  classifyThrown,
  classifyVendorErrorType,
  type RateLimitSnapshot,
} from '../errors.js';
import type { CompletionRequest, CompletionResponse, LlmProvider } from './types.js';

const MESSAGES_PATH = '/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Read the rate-limit picture the server volunteers on every response.
 *
 * Anthropic reports remaining requests and tokens with reset times, which is strictly
 * better information than inferring pressure from failures. Surfacing it lets a run slow
 * down before it is throttled rather than after.
 */
function readRateLimit(headers: Headers): RateLimitSnapshot | undefined {
  const num = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const snapshot: RateLimitSnapshot = {
    requestsRemaining: num('anthropic-ratelimit-requests-remaining'),
    requestsResetAt: headers.get('anthropic-ratelimit-requests-reset') ?? undefined,
    inputTokensRemaining: num('anthropic-ratelimit-input-tokens-remaining'),
    outputTokensRemaining: num('anthropic-ratelimit-output-tokens-remaining'),
    tokensResetAt: headers.get('anthropic-ratelimit-tokens-reset') ?? undefined,
  };
  return Object.values(snapshot).some((value) => value !== undefined) ? snapshot : undefined;
}

/** `retry-after` is the server telling us exactly how long to wait. Guessing is worse. */
function readRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: AnthropicUsage;
  stop_reason?: string | null;
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private readonly url: string;

  /**
   * The key is supplied by the caller, which reads it from the environment. It is never
   * defaulted, never logged, and never written to disk.
   */
  constructor(
    private readonly apiKey: string,
    baseUrl = 'https://api.anthropic.com',
  ) {
    this.url = `${baseUrl.replace(/\/$/, '')}${MESSAGES_PATH}`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);
    request.signal?.addEventListener('abort', () => {
      controller.abort();
    });

    try {
      const content: Record<string, unknown>[] = [];
      for (const image of request.images ?? []) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        });
      }
      content.push({ type: 'text', text: request.user });

      const streaming = typeof request.onToken === 'function';

      const response = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          system: request.system,
          messages: [{ role: 'user', content }],
          stream: streaming,
        }),
      });

      const requestId = response.headers.get('request-id') ?? undefined;
      const rateLimit = readRateLimit(response.headers);

      if (!response.ok) {
        const detail = await safeText(response);
        const vendorType = readVendorErrorType(detail);
        throw new LlmError(
          // The vendor's own error type is more precise than the status code: an
          // `overloaded_error` arrives as 529 and means retry, an `invalid_request_error`
          // as 400 and means stop.
          classifyVendorErrorType(vendorType) ?? classifyHttpStatus(response.status),
          `Anthropic responded ${String(response.status)}${vendorType ? ` (${vendorType})` : ''}: ${detail.slice(0, 300)}`,
          this.name,
          request.model,
          {
            status: response.status,
            retryAfterSeconds: readRetryAfter(response.headers),
            requestId,
            vendorType,
            rateLimit,
          },
        );
      }

      const result = streaming
        ? await readStream(response, request.onToken!)
        : parseJsonResponse(await response.json(), this.name, request.model);

      return {
        ...result,
        model: request.model,
        latencyMs: Date.now() - started,
        requestId,
        rateLimit,
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(
        classifyThrown(error),
        `Anthropic request failed: ${String(error)}`,
        this.name,
        request.model,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJsonResponse(
  raw: unknown,
  provider: string,
  model: string,
): Omit<CompletionResponse, 'model' | 'latencyMs'> {
  const body = raw as AnthropicResponse;
  if (body.error) {
    throw new LlmError('BAD_REQUEST', body.error.message ?? 'unknown error', provider, model);
  }
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return {
    text,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      cachedInputTokens: body.usage?.cache_read_input_tokens ?? 0,
    },
    stopReason: body.stop_reason ?? null,
  };
}

/**
 * Server-sent events arrive split across arbitrary chunk boundaries, so a partial line
 * is carried into the next chunk rather than parsed and discarded. Getting this wrong
 * drops tokens only under load, which is the worst time to discover it.
 */
async function readStream(
  response: Response,
  onToken: (text: string) => void,
): Promise<Omit<CompletionResponse, 'model' | 'latencyMs'>> {
  // The DOM lib types `response.body` without a chunk type, so the reader is annotated
  // explicitly rather than letting `any` propagate through the decode path.
  const stream = response.body as ReadableStream<Uint8Array> | null;
  if (!stream) throw new Error('Anthropic returned no response body');
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason: string | null = null;
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length === 0 || payload === '[DONE]') continue;

      const event = JSON.parse(payload) as {
        type?: string;
        delta?: { text?: string; stop_reason?: string };
        message?: { usage?: AnthropicUsage };
        usage?: AnthropicUsage;
      };

      if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
        text += event.delta.text;
        onToken(event.delta.text);
      } else if (event.type === 'message_start' && event.message?.usage) {
        usage.inputTokens = event.message.usage.input_tokens ?? 0;
        usage.cachedInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
      } else if (event.type === 'message_delta') {
        usage.outputTokens = event.usage?.output_tokens ?? usage.outputTokens;
        stopReason = event.delta?.stop_reason ?? stopReason;
      }
    }
  }

  return { text, usage, stopReason };
}

/** Anthropic error bodies are JSON; a proxy or gateway may return prose instead. */
function readVendorErrorType(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string } };
    return parsed.error?.type;
  } catch {
    return undefined;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}
