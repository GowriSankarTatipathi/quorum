import { join } from 'node:path';
import { ArtifactStorage, FilesystemStorage, type ArtifactStore } from '@quorum/storage';
import { env } from '../env.js';

let instance: ArtifactStore | null = null;

export function getStorage(): ArtifactStore {
  if (!instance) {
    if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
      instance = new ArtifactStorage({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
        ...(env.R2_ACCOUNT_ID ? { accountId: env.R2_ACCOUNT_ID } : {}),
        ...(env.R2_ENDPOINT ? { endpoint: env.R2_ENDPOINT } : {}),
      });
    } else {
      instance = new FilesystemStorage({
        root: env.ARTIFACT_ROOT ?? join(process.cwd(), '../../.artifacts'),
        publicBaseUrl: `${env.ARTIFACT_BASE_URL}/v1/artifacts`,
        signingSecret: env.ARTIFACT_SIGNING_SECRET ?? 'development-secret-do-not-use-in-production',
      });
    }
  }
  return instance;
}

export const hasStorage = (): boolean => true;
