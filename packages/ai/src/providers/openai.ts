import { LlmError, classifyHttpStatus, classifyThrown } from '../errors.js';
import type { CompletionRequest, CompletionResponse, LlmProvider } from './types.js';

const COMPLETIONS_PATH = '/v1/chat/completions';

interface OpenAiResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string };
}

/**
 * The fallback provider.
 *
 * Cross-provider fallback exists because the two failures we actually see — a provider
 * outage and a model systematically confused by one page — are both unfixed by retrying
 * the same model. A different vendor, with a different tokeniser and different failure
 * modes, fixes both.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;

  private readonly url: string;

  constructor(
    private readonly apiKey: string,
    baseUrl = 'https://api.openai.com',
  ) {
    this.url = `${baseUrl.replace(/\/$/, '')}${COMPLETIONS_PATH}`;
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
      const userContent: Record<string, unknown>[] = [{ type: 'text', text: request.user }];
      for (const image of request.images ?? []) {
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${image.mediaType};base64,${image.data}` },
        });
      }

      const streaming = typeof request.onToken === 'function';

      const response = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          max_completion_tokens: request.maxTokens,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: userContent },
          ],
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
          ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await safeText(response);
        throw new LlmError(
          classifyHttpStatus(response.status),
          `OpenAI responded ${String(response.status)}: ${detail}`,
          this.name,
          request.model,
          {
            status: response.status,
            // OpenAI sends the same header on 429s; honouring it beats guessing.
            retryAfterSeconds: Number(response.headers.get('retry-after')) || undefined,
            requestId: response.headers.get('x-request-id') ?? undefined,
          },
        );
      }

      const result = streaming
        ? await readStream(response, request.onToken!)
        : parseJsonResponse(await response.json(), this.name, request.model);

      return { ...result, model: request.model, latencyMs: Date.now() - started };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(
        classifyThrown(error),
        `OpenAI request failed: ${String(error)}`,
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
  const body = raw as OpenAiResponse;
  if (body.error) {
    throw new LlmError('BAD_REQUEST', body.error.message ?? 'unknown error', provider, model);
  }
  const choice = body.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    stopReason: choice?.finish_reason ?? null,
  };
}

async function readStream(
  response: Response,
  onToken: (text: string) => void,
): Promise<Omit<CompletionResponse, 'model' | 'latencyMs'>> {
  // The DOM lib types `response.body` without a chunk type, so the reader is annotated
  // explicitly rather than letting `any` propagate through the decode path.
  const stream = response.body as ReadableStream<Uint8Array> | null;
  if (!stream) throw new Error('OpenAI returned no response body');
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
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };

      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta;
        onToken(delta);
      }
      const finish = event.choices?.[0]?.finish_reason;
      if (typeof finish === 'string') stopReason = finish;
      if (event.usage) {
        usage.inputTokens = event.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = event.usage.completion_tokens ?? usage.outputTokens;
        usage.cachedInputTokens =
          event.usage.prompt_tokens_details?.cached_tokens ?? usage.cachedInputTokens;
      }
    }
  }

  return { text, usage, stopReason };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}
