import { describe, expect, it } from 'vitest';
import { MemoryCacheStore, cacheKey, isCacheable } from './cache.js';
import type { CompletionRequest } from './providers/types.js';

const request = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'claude-sonnet-4-5',
  system: 'system prompt',
  user: 'user prompt',
  maxTokens: 1024,
  temperature: 0,
  json: true,
  timeoutMs: 60_000,
  ...over,
});

describe('cacheKey', () => {
  it('is stable for identical requests', async () => {
    expect(await cacheKey('reasoning', request())).toBe(await cacheKey('reasoning', request()));
  });

  it('differs when the prompt, model or agent differs', async () => {
    const base = await cacheKey('reasoning', request());
    expect(await cacheKey('reasoning', request({ user: 'other' }))).not.toBe(base);
    expect(await cacheKey('reasoning', request({ model: 'claude-haiku-4-5' }))).not.toBe(base);
    expect(await cacheKey('verification', request())).not.toBe(base);
  });

  it('differs when an image is attached, so a screenshot cannot be ignored', async () => {
    const withImage = request({ images: [{ data: 'AAAA', mediaType: 'image/jpeg' }] });
    expect(await cacheKey('browser', withImage)).not.toBe(await cacheKey('browser', request()));
  });
});

describe('isCacheable', () => {
  it('caches deterministic calls only', () => {
    // Caching a sampled response would freeze one draw and remove exactly the diversity
    // the Critic and Recovery agents are given a temperature for.
    expect(isCacheable(0)).toBe(true);
    expect(isCacheable(0.3)).toBe(false);
  });
});

describe('MemoryCacheStore', () => {
  it('stores and returns a value', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', 'v', 60);
    expect(await store.get('k')).toBe('v');
  });

  it('expires entries and reclaims the space', async () => {
    let now = 1_000;
    const store = new MemoryCacheStore(() => now);
    await store.set('k', 'v', 1);
    now += 1_001;
    expect(await store.get('k')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('returns null for an unknown key', async () => {
    expect(await new MemoryCacheStore().get('missing')).toBeNull();
  });
});
