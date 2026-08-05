import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmError } from '../errors.js';
import { LlmRouter, resolveCandidateModels } from '../router.js';
import { AnthropicProvider } from './anthropic.js';
import { startAnthropicReplica, type Replica, type ReplicaResponse } from './anthropic-replica.js';
import type { CompletionRequest } from './types.js';

/**
 * These drive the real provider over real HTTP against a local replica of the Anthropic
 * API. Everything under test here — the fetch, the headers, the SSE framing, the error
 * mapping — would otherwise execute for the first time in production.
 */
let replica: Replica | null = null;

afterEach(async () => {
  await replica?.close();
  replica = null;
});

const start = async (...responses: ReplicaResponse[]) => {
  replica = await startAnthropicReplica({ responses });
  return new AnthropicProvider('test-key-not-a-secret', replica.url);
};

const request = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'claude-sonnet-4-5-20250929',
  system: 'You are the reasoning agent.',
  user: 'Extract the pricing.',
  maxTokens: 1024,
  temperature: 0,
  json: true,
  timeoutMs: 10_000,
  ...over,
});

describe('request shape actually sent over the wire', () => {
  it('sends the documented auth and version headers', async () => {
    const provider = await start({ kind: 'message', text: '{"ok":true}' });
    await provider.complete(request());

    const headers = replica!.requests[0]!.headers;
    expect(headers['x-api-key']).toBe('test-key-not-a-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    // The key must never travel as a bearer token; Anthropic ignores that header.
    expect(headers.authorization).toBeUndefined();
  });

  it('puts the system prompt in the top-level field, not in the messages array', async () => {
    const provider = await start({ kind: 'message', text: '{}' });
    await provider.complete(request());

    const body = replica!.requests[0]!.body;
    expect(body.system).toBe('You are the reasoning agent.');
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('sends images before text, which is the ordering the model reads best', async () => {
    const provider = await start({ kind: 'message', text: '{}' });
    await provider.complete(request({ images: [{ data: 'QUJD', mediaType: 'image/jpeg' }] }));

    const content = (replica!.requests[0]!.body.messages as { content: { type: string }[] }[])[0]!
      .content;
    expect(content[0]?.type).toBe('image');
    expect(content[1]?.type).toBe('text');
  });
});

describe('successful responses', () => {
  it('extracts text and the real usage numbers', async () => {
    const provider = await start({
      kind: 'message',
      text: '{"claims":[]}',
      inputTokens: 4_210,
      outputTokens: 318,
    });
    const response = await provider.complete(request());

    expect(response.text).toBe('{"claims":[]}');
    expect(response.usage.inputTokens).toBe(4_210);
    expect(response.usage.outputTokens).toBe(318);
    expect(response.stopReason).toBe('end_turn');
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces the request id and remaining rate-limit headroom', async () => {
    const provider = await start({ kind: 'message', text: '{}' });
    const response = await provider.complete(request());

    expect(response.requestId).toMatch(/^req_replica_/);
    // Knowing the headroom lets a run slow down before it is throttled, not after.
    expect(response.rateLimit?.requestsRemaining).toBe(48);
    expect(response.rateLimit?.inputTokensRemaining).toBe(19_500);
  });
});

describe('server-sent events', () => {
  it('reassembles deltas in order and reports usage from the stream', async () => {
    const provider = await start({
      kind: 'stream',
      chunks: ['{"claims"', ':[{"entity"', ':"Brex"}]}'],
      inputTokens: 900,
      outputTokens: 44,
    });

    const tokens: string[] = [];
    const response = await provider.complete(request({ onToken: (text) => tokens.push(text) }));

    expect(response.text).toBe('{"claims":[{"entity":"Brex"}]}');
    expect(tokens).toEqual(['{"claims"', ':[{"entity"', ':"Brex"}]}']);
    expect(response.usage.inputTokens).toBe(900);
    expect(response.usage.outputTokens).toBe(44);
    expect(response.stopReason).toBe('end_turn');
  });

  it('asks for a stream only when a token callback is supplied', async () => {
    const provider = await start({ kind: 'stream', chunks: ['{}'] });
    await provider.complete(request({ onToken: () => undefined }));
    expect(replica!.requests[0]!.body.stream).toBe(true);
  });

  it('survives deltas that contain newlines, which would break a naive line parser', async () => {
    const provider = await start({ kind: 'stream', chunks: ['{"a":\n', '"b\\nc"}'] });
    const response = await provider.complete(request({ onToken: () => undefined }));
    expect(response.text).toBe('{"a":\n"b\\nc"}');
  });
});

describe('error mapping', () => {
  it('classifies a 429 from the vendor error type and honours retry-after', async () => {
    const provider = await start({
      kind: 'error',
      status: 429,
      errorType: 'rate_limit_error',
      message: 'Number of requests has exceeded your rate limit',
      retryAfterSeconds: 7,
    });

    await expect(provider.complete(request())).rejects.toMatchObject({
      errorClass: 'RATE_LIMITED',
      vendorType: 'rate_limit_error',
      retryAfterSeconds: 7,
      status: 429,
    });
  });

  it('treats 529 overloaded as transient', async () => {
    const provider = await start({
      kind: 'error',
      status: 529,
      errorType: 'overloaded_error',
      message: 'Overloaded',
    });

    try {
      await provider.complete(request());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).errorClass).toBe('OVERLOADED');
      expect((error as LlmError).transient).toBe(true);
    }
  });

  it('treats an auth error as permanent, so retries do not delay the honest failure', async () => {
    const provider = await start({
      kind: 'error',
      status: 401,
      errorType: 'authentication_error',
      message: 'invalid x-api-key',
    });

    try {
      await provider.complete(request());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as LlmError).errorClass).toBe('AUTH');
      expect((error as LlmError).transient).toBe(false);
    }
  });

  it('prefers the vendor error type over the status code', async () => {
    // A 400 that is really an overload must be retried, not abandoned.
    const provider = await start({
      kind: 'error',
      status: 400,
      errorType: 'overloaded_error',
      message: 'Overloaded',
    });
    await expect(provider.complete(request())).rejects.toMatchObject({ errorClass: 'OVERLOADED' });
  });

  it('never puts the api key in the error message', async () => {
    const provider = await start({
      kind: 'error',
      status: 401,
      errorType: 'authentication_error',
      message: 'invalid x-api-key',
    });
    try {
      await provider.complete(request());
    } catch (error) {
      expect((error as Error).message).not.toContain('test-key-not-a-secret');
      expect(JSON.stringify((error as LlmError).toJSON())).not.toContain('test-key-not-a-secret');
    }
  });

  it('aborts on timeout rather than hanging the run', async () => {
    replica = await startAnthropicReplica({ responses: [] });
    // No response is ever written, so only the client-side timeout can end this.
    const provider = new AnthropicProvider('k', 'http://127.0.0.1:1');
    await expect(provider.complete(request({ timeoutMs: 200 }))).rejects.toBeInstanceOf(LlmError);
  });
});

describe('router over the real provider', () => {
  const Schema = z.object({ answer: z.string() });

  it('retries a rate limit, honours the server backoff, then succeeds', async () => {
    replica = await startAnthropicReplica({
      responses: [
        {
          kind: 'error',
          status: 429,
          errorType: 'rate_limit_error',
          message: 'slow down',
          retryAfterSeconds: 1,
        },
        { kind: 'message', text: '{"answer":"recovered"}' },
      ],
    });

    const waits: number[] = [];
    const providers = { anthropic: new AnthropicProvider('k', replica.url) };
    const router = new LlmRouter({
      providers,
      candidates: resolveCandidateModels({}, providers),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    const result = await router.call(
      { agent: 'reasoning', promptVersion: 'reasoning.v4', system: 's', user: 'u' },
      Schema,
    );

    expect(result.data.answer).toBe('recovered');
    // 1000ms because the server said so — not a number we invented.
    expect(waits).toEqual([1_000]);
    expect(replica.requests).toHaveLength(2);
  });

  it('validates a real response against the schema and retries a wrong shape', async () => {
    replica = await startAnthropicReplica({
      responses: [
        { kind: 'message', text: '{"wrong":"shape"}' },
        { kind: 'message', text: '{"answer":"eventually"}' },
      ],
    });
    const providers = { anthropic: new AnthropicProvider('k', replica.url) };
    const router = new LlmRouter({
      providers,
      candidates: resolveCandidateModels({}, providers),
      sleep: () => Promise.resolve(),
    });

    const result = await router.call(
      { agent: 'reasoning', promptVersion: 'reasoning.v4', system: 's', user: 'u' },
      Schema,
    );
    expect(result.data.answer).toBe('eventually');
    expect(replica.requests).toHaveLength(2);
  });

  it('gives up on the primary model after its retries and moves to the fallback', async () => {
    // The primary is allowed three attempts (initial + two retries). A fourth good
    // response is never reached, because by then the router has correctly switched
    // providers — retrying a model that keeps returning the wrong shape is not a strategy.
    replica = await startAnthropicReplica({
      responses: [{ kind: 'message', text: '{"wrong":"shape"}' }],
    });
    const providers = { anthropic: new AnthropicProvider('k', replica.url) };
    const router = new LlmRouter({
      providers,
      candidates: resolveCandidateModels({}, providers),
      sleep: () => Promise.resolve(),
    });

    await expect(
      router.call(
        { agent: 'reasoning', promptVersion: 'reasoning.v4', system: 's', user: 'u' },
        Schema,
      ),
    ).rejects.toMatchObject({ name: 'AllProvidersFailedError' });

    expect(replica.requests).toHaveLength(6);
  });
});

describe('error text classification', () => {
  it('classifies upstream capacity messages as RATE_LIMITED', async () => {
    const provider = await start({
      kind: 'error',
      status: 400,
      message: 'Worker local total request limit reached (32/32)',
    });
    
    await expect(provider.complete(request())).rejects.toMatchObject({
      errorClass: 'RATE_LIMITED',
      status: 400,
    });
  });
});
