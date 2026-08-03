import { describe, expect, it } from 'vitest';
import { AccessTokenDenylist, type DenylistStore } from './denylist.js';

class MemoryDenylistStore implements DenylistStore {
  readonly entries = new Map<string, { value: string; ttl: number }>();
  set(key: string, value: string, _mode: 'EX', ttlSeconds: number): Promise<unknown> {
    this.entries.set(key, { value, ttl: ttlSeconds });
    return Promise.resolve('OK');
  }
  exists(key: string): Promise<number> {
    return Promise.resolve(this.entries.has(key) ? 1 : 0);
  }
}

describe('AccessTokenDenylist', () => {
  const now = 1_700_000_000_000;
  const nowSeconds = Math.floor(now / 1000);

  it('marks a token revoked and reports it', async () => {
    const store = new MemoryDenylistStore();
    const denylist = new AccessTokenDenylist(store);
    expect(await denylist.isRevoked('jti_1')).toBe(false);
    await denylist.revoke('jti_1', nowSeconds + 300, now);
    expect(await denylist.isRevoked('jti_1')).toBe(true);
  });

  it('expires the entry with the token, keeping the set bounded', async () => {
    const store = new MemoryDenylistStore();
    await new AccessTokenDenylist(store).revoke('jti_1', nowSeconds + 300, now);
    expect(store.entries.get('quorum:auth:denylist:jti_1')?.ttl).toBe(300);
  });

  it('never writes a non-positive ttl for an already-expired token', async () => {
    const store = new MemoryDenylistStore();
    await new AccessTokenDenylist(store).revoke('jti_1', nowSeconds - 100, now);
    expect(store.entries.get('quorum:auth:denylist:jti_1')?.ttl).toBe(1);
  });

  it('namespaces keys so they cannot collide with other Redis data', async () => {
    const store = new MemoryDenylistStore();
    await new AccessTokenDenylist(store).revoke('abc', nowSeconds + 10, now);
    expect([...store.entries.keys()]).toEqual(['quorum:auth:denylist:abc']);
  });
});
