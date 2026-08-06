import { describe, it, expect } from 'vitest';
import { resolveStorage, StorageUnconfiguredError } from './resolver.js';
import { FilesystemStorage } from './filesystem.js';
import { ArtifactStorage } from './storage.js';

describe('resolveStorage', () => {
  it('resolves to R2 when credentials are present', () => {
    const store = resolveStorage({
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
    });
    expect(store).toBeInstanceOf(ArtifactStorage);
    expect((store as ArtifactStorage).bucket).toBe('bucket');
  });

  it('resolves to FilesystemStorage when ARTIFACT_ROOT is set and R2 is absent', () => {
    const store = resolveStorage({
      ARTIFACT_ROOT: '/tmp/artifacts',
    });
    expect(store).toBeInstanceOf(FilesystemStorage);
  });

  it('throws StorageUnconfiguredError when neither R2 nor ARTIFACT_ROOT are present', () => {
    expect(() => resolveStorage({})).toThrowError(StorageUnconfiguredError);
    expect(() => resolveStorage({})).toThrowError(
      'Exports are not available on this deployment yet.',
    );
  });

  it('produces URLs on the API origin for FilesystemStorage', async () => {
    const store = resolveStorage({
      ARTIFACT_ROOT: '/tmp/artifacts',
      API_ORIGIN: 'http://api.local',
    });
    
    const url = await store.signedUrl('test.jpg');
    expect(url).toMatch(/^http:\/\/api\.local\/v1\/artifacts\?/);
  });

  it('produces URLs on the bucket origin for ArtifactStorage (R2/S3)', async () => {
    const store = resolveStorage({
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
      R2_ENDPOINT: 'http://localhost:9000',
    });
    
    const url = await store.signedUrl('test.jpg');
    expect(url).toMatch(/^http:\/\/localhost:9000\/bucket\/test\.jpg\?/);
  });
});
