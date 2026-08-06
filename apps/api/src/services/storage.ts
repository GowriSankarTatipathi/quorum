import { type ArtifactStore, resolveStorage, StorageUnconfiguredError } from '@quorum/storage';
import { env } from '../env.js';
import { ApiError } from '../plugins/error-handler.js';

let store: ArtifactStore | null = null;
let initError: Error | null = null;

try {
  store = resolveStorage(env);
} catch (e) {
  if (e instanceof StorageUnconfiguredError) {
    initError = e;
  } else {
    throw e;
  }
}

export function getStorage(): ArtifactStore {
  if (initError) {
    throw new ApiError(503, 'E_STORAGE_UNCONFIGURED', initError.message);
  }
  if (!store) {
    throw new Error('Storage initialization failed without an error');
  }
  return store;
}

export const hasStorage = (): boolean => initError === null;
