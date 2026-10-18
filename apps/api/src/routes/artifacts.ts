import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FilesystemStorage } from '@quorum/storage';

import { env } from '../env.js';
import { ApiError } from '../plugins/error-handler.js';
import { getStorage } from '../services/storage.js';

const QuerySchema = z.object({
  key: z.string(),
  expires: z.coerce.number(),
  signature: z.string(),
  filename: z.string().optional(),
});

const MIME_TYPES: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const artifactRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    '/artifacts',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Download a filesystem artifact',
        querystring: QuerySchema,
      },
      // Note: No auth hook attached here. The URL signature is the authorization.
    },
    async (request, reply) => {
      if (!env.ARTIFACT_ROOT) {
        throw new ApiError(500, 'E_INTERNAL', 'Filesystem storage is not configured.');
      }

      const store = getStorage();
      if (store.kind !== 'filesystem') {
        throw new ApiError(500, 'E_INTERNAL', 'Artifacts route requires filesystem storage.');
      }

      const { key, expires, signature, filename } = request.query;

      // 1. Verify expiration
      if (expires < Math.floor(Date.now() / 1000)) {
        throw new ApiError(410, 'E_GONE', 'Artifact link has expired');
      }

      // 2. Verify signature
      const fsStore = store as FilesystemStorage;
      if (!fsStore.verify(key, expires, signature)) {
        throw new ApiError(403, 'E_FORBIDDEN', 'Invalid artifact signature');
      }

      // 3. Prevent path traversal
      const rootPath = resolve(env.ARTIFACT_ROOT);
      const targetPath = resolve(env.ARTIFACT_ROOT, key);

      if (targetPath !== rootPath && !targetPath.startsWith(rootPath + sep)) {
        throw new ApiError(403, 'E_FORBIDDEN', 'Invalid artifact key');
      }

      // 4. Check if file exists
      try {
        const stats = await stat(targetPath);
        if (!stats.isFile()) {
          throw new Error('Not a file');
        }
      } catch {
        throw new ApiError(404, 'E_NOT_FOUND', 'Artifact not found');
      }

      // 5. Determine Content-Type and Content-Disposition
      const ext = extname(filename ?? key).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      void reply.type(mimeType);
      // Signed image URLs authorize access. The web UI runs on a separate origin.
      if (mimeType.startsWith('image/')) {
        void reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      }

      if (filename) {
        // Sanitize filename for Content-Disposition header
        const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        void reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
      }

      // 6. Stream the file
      return reply.send(createReadStream(targetPath));
    },
  );
  return Promise.resolve();
};
