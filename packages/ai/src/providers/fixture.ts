import { LlmError } from '../errors.js';
import type { CompletionRequest, CompletionResponse, LlmProvider } from './types.js';

export interface RecordedCompletion {
  /** Matched against the request; the first entry whose predicate passes is used. */
  match: (request: CompletionRequest) => boolean;
  /** Either a canned response or an error to raise, so failure paths are testable too. */
  respond:
    | { kind: 'text'; text: string; usage?: { inputTokens: number; outputTokens: number } }
    | { kind: 'error'; error: LlmError };
  /** Optional cap on how many times this entry may be consumed. */
  times?: number;
}

/**
 * A provider that replays recorded completions.
 *
 * This is a full implementation of the provider port, not a stand-in for one: it is how
 * the seven-agent pipeline is exercised deterministically in CI with no network, no API
 * keys and no per-run cost. Without it, agent behaviour is effectively untested and
 * every refactor is a gamble — which is precisely the property this product cannot have.
 */
export class FixtureProvider implements LlmProvider {
  readonly name = 'fixture' as const;
  readonly calls: CompletionRequest[] = [];
  private readonly used = new Map<RecordedCompletion, number>();

  constructor(private readonly recordings: RecordedCompletion[]) {}

  complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push(request);

    for (const recording of this.recordings) {
      const consumed = this.used.get(recording) ?? 0;
      if (recording.times !== undefined && consumed >= recording.times) continue;
      if (!recording.match(request)) continue;

      this.used.set(recording, consumed + 1);

      if (recording.respond.kind === 'error') return Promise.reject(recording.respond.error);

      const text = recording.respond.text;
      if (request.onToken) {
        // Deltas are emitted in small slices so streaming consumers are exercised the
        // same way they would be against a real provider.
        for (let i = 0; i < text.length; i += 24) request.onToken(text.slice(i, i + 24));
      }

      return Promise.resolve({
        text,
        usage: {
          inputTokens: recording.respond.usage?.inputTokens ?? Math.ceil(request.system.length / 4),
          outputTokens: recording.respond.usage?.outputTokens ?? Math.ceil(text.length / 4),
          cachedInputTokens: 0,
        },
        model: request.model,
        stopReason: 'end_turn',
        latencyMs: 1,
      });
    }

    return Promise.reject(
      new LlmError(
        'BAD_REQUEST',
        `No recorded completion matched a ${request.model} request`,
        this.name,
        request.model,
      ),
    );
  }
}
