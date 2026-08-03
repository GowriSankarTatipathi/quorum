export interface PutResult {
  key: string;
  bytes: number;
}

/**
 * The storage port.
 *
 * Declared so the filesystem and S3 implementations are interchangeable: local
 * development and CI write to disk with no credentials and no network, and production
 * writes to R2, without the calling code knowing which it got. The same argument as the
 * browser driver interface — the alternative is a code path that only ever runs in
 * production, which is the one you least want to be discovering bugs in.
 */
export interface ArtifactStore {
  readonly kind: 'filesystem' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  /** A URL the browser can fetch. Signed and expiring for S3; a file URL on disk. */
  signedUrl(key: string, expiresInSeconds?: number, downloadAs?: string): Promise<string>;
  deletePrefix(prefix: string): Promise<number>;
  exists(key: string): Promise<boolean>;
}
