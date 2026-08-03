import { ArtifactStorage } from '@quorum/storage';
import { env } from '../env.js';

/**
 * Constructed lazily and only when credentials exist.
 *
 * A worker with no object store configured can still plan and browse — it simply cannot
 * export or persist screenshots. Failing at boot for a capability most runs do not reach
 * would turn a partial configuration into a total outage.
 */
let instance: ArtifactStorage | null = null;

export function getStorage(): ArtifactStorage {
  if (!instance) {
    if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      throw new Error(
        'Artifact storage is not configured. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or point R2_ENDPOINT at the local MinIO container).',
      );
    }
    instance = new ArtifactStorage({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      ...(env.R2_ACCOUNT_ID ? { accountId: env.R2_ACCOUNT_ID } : {}),
      ...(env.R2_ENDPOINT ? { endpoint: env.R2_ENDPOINT } : {}),
    });
  }
  return instance;
}

export const hasStorage = (): boolean =>
  Boolean(env.R2_ACCESS_KEY_ID) && Boolean(env.R2_SECRET_ACCESS_KEY);
