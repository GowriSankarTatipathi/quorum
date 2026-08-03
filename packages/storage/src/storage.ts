import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ArtifactStore, PutResult } from './types.js';

export interface StorageConfig {
  accountId?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Set for MinIO in development; derived from the account id for Cloudflare R2. */
  endpoint?: string;
  region?: string;
}

/**
 * Artifact storage.
 *
 * Cloudflare R2 in production, MinIO locally, both through the S3 API. R2 rather than S3
 * for one decisive reason: zero egress fees. Screenshots are streamed continuously during
 * a live run and again on every replay, so egress — not storage — is the dominant cost,
 * and on S3 it would plausibly exceed the entire compute bill.
 */
export class ArtifactStorage implements ArtifactStore {
  readonly kind = 's3' as const;

  private readonly client: S3Client;
  readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? 'auto',
      endpoint:
        config.endpoint ??
        (config.accountId ? `https://${config.accountId}.r2.cloudflarestorage.com` : undefined),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // MinIO serves path-style URLs; R2 accepts them too, so one setting works for both.
      forcePathStyle: Boolean(config.endpoint),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, bytes: body.byteLength };
  }

  /**
   * Short-lived signed URLs rather than a public bucket.
   *
   * Artifacts are screenshots of a customer's client data. A link that works forever is a
   * link that leaks forever, and fifteen minutes is long enough to open a spreadsheet.
   */
  signedUrl(key: string, expiresInSeconds = 900, downloadAs?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(downloadAs
          ? { ResponseContentDisposition: `attachment; filename="${downloadAs}"` }
          : {}),
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Artifact ${key} has no body`);
    return Buffer.from(bytes);
  }

  /** Deletes an entire run's artifacts. Paginated because a long run produces hundreds. */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => typeof key === 'string');

      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
        deleted += keys.length;
      }
      continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }
}
