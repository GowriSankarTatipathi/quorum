import { type ArtifactStore, resolveStorage, StorageUnconfiguredError } from '@quorum/storage';
import { env } from '../env.js';

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
    throw initError;
  }
  if (!store) {
    throw new Error('Storage initialization failed without an error');
  }
  return store;
}

export const hasStorage = (): boolean => initError === null;
