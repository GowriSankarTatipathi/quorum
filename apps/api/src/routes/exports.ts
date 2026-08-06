import { artifactRepository, runRepository, type ArtifactKind } from '@quorum/db';
import { downloadFilename } from '@quorum/storage';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../plugins/auth.js';
import { ApiError, notFound } from '../plugins/error-handler.js';
import { enqueueExport } from '../services/queue.js';
import { getStorage } from '../services/storage.js';

const FORMATS = ['xlsx', 'csv', 'json'] as const;
type Format = (typeof FORMATS)[number];

const KIND: Record<Format, ArtifactKind> = {
  xlsx: 'EXPORT_XLSX',
  csv: 'EXPORT_CSV',
  json: 'EXPORT_JSON',
};

export const exportRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/runs/:runId/export',
    {
      onRequest: app.requirePermission('export:create'),
      schema: {
        tags: ['export'],
        summary: 'Queue an export of this run',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        body: z.object({ format: z.enum(FORMATS).default('xlsx') }),
        response: { 202: z.object({ status: z.string(), format: z.string() }) },
      },
    },
    async (request, reply) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      await enqueueExport(run.id, request.body.format, claims.sub);
      return reply.status(202).send({ status: 'QUEUED', format: request.body.format });
    },
  );

  /**
   * Hand back a short-lived signed URL rather than proxying the bytes.
   *
   * Streaming a workbook through the gateway would occupy a connection for the length of
   * the download; a signed URL lets object storage serve it directly and expires so a
   * shared link does not become permanent access to a client's data.
   */
  app.get(
    '/runs/:runId/export',
    {
      onRequest: app.requirePermission('export:create'),
      schema: {
        tags: ['export'],
        summary: 'Get a download link for the latest export',
        security: [{ bearerAuth: [] }],
        params: z.object({ runId: z.string() }),
        querystring: z.object({ format: z.enum(FORMATS).default('xlsx') }),
        response: {
          200: z.object({
            url: z.string(),
            filename: z.string(),
            bytes: z.number().int(),
            createdAt: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const run = await runRepository.findByIdForOrg(request.params.runId, claims.org);
      if (!run) throw notFound('Run');

      const format = request.query.format;
      const artifact = await artifactRepository.findLatestExport(run.id, KIND[format]);
      if (!artifact) {
        throw new ApiError(
          404,
          'E_EXPORT_NOT_READY',
          'That export has not been generated yet. Request it first, then try again in a moment.',
        );
      }

      const filename = downloadFilename(run.goal, format, artifact.createdAt);
      return {
        url: await getStorage().signedUrl(artifact.r2Key, 900, filename),
        filename,
        bytes: artifact.bytes,
        createdAt: artifact.createdAt.toISOString(),
      };
    },
  );

  done();
};
