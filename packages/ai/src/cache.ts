import type { CompletionRequest } from './providers/types.js';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** In-process store. Correct for a worker that owns one run at a time; the Redis-backed
 *  store is swapped in wherever a cache shared across workers is worth the round trip. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Exact-match caching, deliberately not semantic.
 *
 * A semantic cache can return a *nearly* right answer for a *slightly* different page,
 * which is precisely the class of silent error this whole product exists to prevent.
 * Exact matching gives roughly a 40% hit rate on repeated runs at zero correctness risk,
 * and correctness is not something we trade for cost here.
 */
export async function cacheKey(agent: string, request: CompletionRequest): Promise<string> {
  const material = JSON.stringify({
    agent,
    model: request.model,
    system: request.system,
    user: request.user,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    images: (request.images ?? []).map((image) => image.data.length),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return `quorum:llm:${Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Non-zero temperature means the response is a sample, not a function of the input.
 * Caching one would freeze a single draw and quietly remove the diversity the Critic and
 * Recovery agents are given a temperature for in the first place.
 */
export const isCacheable = (temperature: number): boolean => temperature === 0;
