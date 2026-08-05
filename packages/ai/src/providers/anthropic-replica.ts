import { createServer, type Server } from 'node:http';

/**
 * A local HTTP replica of the Anthropic Messages API.
 *
 * The point is to exercise `AnthropicProvider` itself — its fetch call, its header
 * parsing, its SSE framing, its error mapping — rather than bypassing it with a fake
 * provider. Those are the code paths that would otherwise run for the first time in
 * production, against a vendor, with a customer waiting.
 *
 * The response bodies below are the real wire shapes documented by the API. Exported from
 * the package (not the test file) so the integration harness can use the same replica.
 */
export interface ReplicaScript {
  /** Consumed in order; the last entry repeats once the list is exhausted. */
  responses: ReplicaResponse[];
}

export type ReplicaResponse =
  | { kind: 'message'; text: string; inputTokens?: number; outputTokens?: number }
  | { kind: 'stream'; chunks: string[]; inputTokens?: number; outputTokens?: number }
  | {
      kind: 'error';
      status: number;
      errorType?: string;
      message: string;
      retryAfterSeconds?: number;
    };

export interface Replica {
  url: string;
  /** Every request body the provider sent, for asserting what was actually transmitted. */
  requests: { headers: Record<string, string>; body: Record<string, unknown> }[];
  close: () => Promise<void>;
}

export function startAnthropicReplica(script: ReplicaScript, port = 0): Promise<Replica> {
  let index = 0;
  const requests: Replica['requests'] = [];

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key] = value;
      }
      requests.push({ headers, body: JSON.parse(raw || '{}') as Record<string, unknown> });

      const next = script.responses[Math.min(index, script.responses.length - 1)]!;
      index += 1;

      // Present on every real response, success or failure.
      const common: Record<string, string> = {
        'request-id': `req_replica_${String(index)}`,
        'anthropic-ratelimit-requests-remaining': '48',
        'anthropic-ratelimit-input-tokens-remaining': '19500',
        'anthropic-ratelimit-tokens-reset': '2026-08-03T06:00:00Z',
      };

      if (next.kind === 'error') {
        res.writeHead(next.status, {
          'content-type': 'application/json',
          ...common,
          ...(next.retryAfterSeconds === undefined
            ? {}
            : { 'retry-after': String(next.retryAfterSeconds) }),
        });
        res.end(
          JSON.stringify({ type: 'error', error: { type: next.errorType, message: next.message } }),
        );
        return;
      }

      if (next.kind === 'message') {
        res.writeHead(200, { 'content-type': 'application/json', ...common });
        res.end(
          JSON.stringify({
            id: 'msg_replica',
            type: 'message',
            role: 'assistant',
            model: (requests.at(-1)?.body.model as string) ?? 'claude-sonnet-4-5-20250929',
            content: [{ type: 'text', text: next.text }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: next.inputTokens ?? 1_000,
              output_tokens: next.outputTokens ?? 200,
              cache_read_input_tokens: 0,
            },
          }),
        );
        return;
      }

      // Server-sent events, framed exactly as the API frames them — including splitting
      // deltas across arbitrary chunk boundaries, which is what broke naive parsers.
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        ...common,
      });
      const write = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      write('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: next.inputTokens ?? 1_000, cache_read_input_tokens: 0 } },
      });
      write('content_block_start', { type: 'content_block_start', index: 0 });
      for (const chunk of next.chunks) {
        write('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: chunk },
        });
      }
      write('content_block_stop', { type: 'content_block_stop', index: 0 });
      write('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: next.outputTokens ?? 200 },
      });
      write('message_stop', { type: 'message_stop' });
      res.end();
    });
  });

  return new Promise<Replica>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${String(boundPort)}`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
