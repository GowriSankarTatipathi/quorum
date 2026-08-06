import { ArtifactStorage } from './storage.js';
import { FilesystemStorage } from './filesystem.js';
import type { ArtifactStore } from './types.js';

export interface StorageConfigOptions {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ENDPOINT?: string;

  ARTIFACT_ROOT?: string;
  ARTIFACT_BASE_URL?: string;
  ARTIFACT_SIGNING_SECRET?: string;

  API_ORIGIN?: string;
}

export class StorageUnconfiguredError extends Error {
  readonly code = 'E_STORAGE_UNCONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'StorageUnconfiguredError';
  }
}

export function resolveStorage(env: StorageConfigOptions): ArtifactStore {
  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    if (!env.R2_BUCKET) {
      throw new StorageUnconfiguredError('R2_BUCKET is required when using R2');
    }
    console.warn('[Storage] Using R2 object storage');
    return new ArtifactStorage({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      ...(env.R2_ACCOUNT_ID ? { accountId: env.R2_ACCOUNT_ID } : {}),
      ...(env.R2_ENDPOINT ? { endpoint: env.R2_ENDPOINT } : {}),
    });
  }

  if (env.ARTIFACT_ROOT) {
    const apiOrigin = env.API_ORIGIN ?? 'http://localhost:3001';

    if (env.ARTIFACT_BASE_URL && !env.ARTIFACT_BASE_URL.startsWith(apiOrigin)) {
      console.warn(
        `[Storage] WARNING: ARTIFACT_BASE_URL (${env.ARTIFACT_BASE_URL}) does not match the API origin (${apiOrigin}), but the filesystem store is selected. Artifact URLs will be generated for the API origin.`,
      );
    }

    console.warn(
      '[Storage] WARNING: Using local filesystem storage. This is unsuitable for a multi-machine deployment.',
    );
    return new FilesystemStorage({
      root: env.ARTIFACT_ROOT,
      publicBaseUrl: `${apiOrigin}/v1/artifacts`,
      signingSecret: env.ARTIFACT_SIGNING_SECRET ?? 'development-secret-do-not-use-in-production',
    });
  }

  throw new StorageUnconfiguredError('Exports are not available on this deployment yet.');
}
