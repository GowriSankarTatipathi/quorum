/**
 * Minimal contract for the Redis commands the denylist needs. Declaring it here rather
 * than importing ioredis keeps @quorum/auth free of a transport dependency, so the
 * package stays usable from the edge runtime and trivially fakeable in tests.
 */
export interface DenylistStore {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  exists(key: string): Promise<number>;
}

const key = (jti: string): string => `quorum:auth:denylist:${jti}`;

/**
 * Access tokens are stateless and live 15 minutes, which is the right trade for the
 * hot path — but "sign out" that leaves a token working for another 14 minutes is not
 * a sign-out. The denylist closes that window.
 *
 * Entries expire with the token they revoke, so the set stays bounded by the number of
 * sign-outs in any 15-minute period rather than growing forever.
 */
export class AccessTokenDenylist {
  constructor(private readonly store: DenylistStore) {}

  async revoke(jti: string, expiresAt: number, now = Date.now()): Promise<void> {
    const ttl = Math.max(1, expiresAt - Math.floor(now / 1000));
    await this.store.set(key(jti), '1', 'EX', ttl);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.store.exists(key(jti))) > 0;
  }
}
