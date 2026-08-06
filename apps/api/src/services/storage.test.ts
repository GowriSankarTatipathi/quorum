import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../env.js', () => ({
  env: {
    ARTIFACT_ROOT: '/tmp/artifacts',
  },
}));

describe('getStorage in API', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves to FilesystemStorage when ARTIFACT_ROOT is set and R2 is absent', async () => {
    const { getStorage } = await import('./storage.js');
    const store = getStorage();
    expect(store.kind).toBe('filesystem');
  });
});
