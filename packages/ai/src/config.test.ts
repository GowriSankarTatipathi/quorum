import { describe, expect, it } from 'vitest';
import { createProviders, isLive } from './providers/factory.js';
import { describeLlmConfig, loadLlmConfig } from './config.js';

const load = (env: NodeJS.ProcessEnv) => loadLlmConfig(env);

describe('mode selection', () => {
  it('runs recorded when no key is present, and says why', () => {
    const config = load({});
    expect(config.mode).toBe('recorded');
    expect(config.reason).toMatch(/Export ANTHROPIC_API_KEY/);
  });

  it('switches to live automatically the moment ANTHROPIC_API_KEY appears', () => {
    const config = load({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    expect(config.mode).toBe('live');
    expect(isLive(config)).toBe(true);
  });

  it('lets CI force recorded even with a key, so a pull request never spends money', () => {
    const config = load({ ANTHROPIC_API_KEY: 'sk-ant-xxx', QUORUM_LLM_MODE: 'recorded' });
    expect(config.mode).toBe('recorded');
  });

  it('refuses to start in forced-live mode with no key rather than silently degrading', () => {
    expect(() => load({ QUORUM_LLM_MODE: 'live' })).toThrow(/no provider key is set/);
  });

  it('treats an empty key as absent instead of sending it', () => {
    expect(load({ ANTHROPIC_API_KEY: '' }).mode).toBe('recorded');
  });
});

describe('provider construction', () => {
  it('builds the fixture provider in recorded mode and nothing else', () => {
    const providers = createProviders(load({}), { recordings: [] });
    expect(Object.keys(providers)).toEqual(['fixture']);
  });

  it('builds Anthropic alone when only that key is set', () => {
    const providers = createProviders(load({ ANTHROPIC_API_KEY: 'k' }));
    expect(Object.keys(providers)).toEqual(['anthropic']);
  });

  it('builds both when a fallback key is present', () => {
    const providers = createProviders(load({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'o' }));
    expect(Object.keys(providers).sort()).toEqual(['anthropic', 'openai']);
  });

  it('honours a base-url override, which is how the replica is pointed at', () => {
    const config = load({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999' });
    expect(config.anthropic?.baseUrl).toBe('http://127.0.0.1:9999');
  });
});

describe('secret hygiene', () => {
  it('never prints a key, only enough to tell two apart', () => {
    const described = describeLlmConfig(load({ ANTHROPIC_API_KEY: 'sk-ant-super-secret-value' }));
    expect(described).not.toContain('super-secret');
    expect(described).toContain('sk-a');
    expect(described).toContain('mode=live');
  });

  it('masks a short key entirely rather than revealing most of it', () => {
    expect(describeLlmConfig(load({ ANTHROPIC_API_KEY: 'short' }))).toContain('****');
  });
});

describe('overrides', () => {
  it('accepts per-agent model overrides so a deployment can retune without a deploy', () => {
    const config = load({ ANTHROPIC_API_KEY: 'k', QUORUM_MODEL_CRITIC: 'claude-haiku-4-5' });
    expect(config.modelOverrides.critic).toBe('claude-haiku-4-5');
  });

  it('rejects an unknown model instead of failing on the first call', () => {
    expect(() => load({ ANTHROPIC_API_KEY: 'k', QUORUM_MODEL_CRITIC: 'gpt-9' })).toThrow(
      /Invalid LLM configuration/,
    );
  });
});
