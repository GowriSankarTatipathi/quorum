import { createHmac } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ArtifactStore, PutResult } from './types.js';

export interface FilesystemStorageConfig {
  root: string;
  /** Base URL the API serves artifacts from, e.g. http://localhost:3001/v1/artifacts. */
  publicBaseUrl: string;
  /** Signs local artifact URLs so a key is not enough to read someone else's screenshot. */
  signingSecret: string;
}

/**
 * Artifacts on local disk.
 *
 * The default for development and CI: no credentials, no network, no container. It is a
 * real implementation of the port rather than a stub — the same code path that runs in
 * production, differing only in where the bytes land.
 */
export class FilesystemStorage implements ArtifactStore {
  readonly kind = 'filesystem' as const;

  constructor(private readonly config: FilesystemStorageConfig) {}

  /**
   * Keys come from run and step ids, but treating them as paths without checking would
   * make `../` a path-traversal primitive. Every resolved path must stay under the root.
   */
  private pathFor(key: string): string {
    const target = resolve(this.config.root, key);
    const root = resolve(this.config.root);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Artifact key escapes the storage root: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<PutResult> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, bytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signed like the S3 equivalent, and for the same reason: artifacts are screenshots of a
   * customer's client data, so knowing a key must not be enough to read one. The signature
   * covers the key and the expiry together, so neither can be changed independently.
   */
  signedUrl(key: string, expiresInSeconds = 900, downloadAs?: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = this.sign(key, expires);
    const params = new URLSearchParams({ key, expires: String(expires), signature });
    if (downloadAs) params.set('filename', downloadAs);
    return Promise.resolve(`${this.config.publicBaseUrl}?${params.toString()}`);
  }

  sign(key: string, expires: number): string {
    return createHmac('sha256', this.config.signingSecret)
      .update(`${key}:${String(expires)}`)
      .digest('hex');
  }

  /** Constant-time-ish verification used by the artifact route. */
  verify(key: string, expires: number, signature: string): boolean {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(key, expires);
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1)
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const path = this.pathFor(prefix);
    let count = 0;
    try {
      count = await countFiles(path);
      await rm(path, { recursive: true, force: true });
    } catch {
      return 0;
    }
    return count;
  }
}

async function countFiles(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFiles(join(path, entry.name));
    else total += 1;
  }
  return total;
}
