import { checkDatabase } from '@quorum/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkRedis } from '../redis.js';

const DependencySchema = z.object({ ok: z.boolean(), latencyMs: z.number() });

const LivenessSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string(),
  uptimeSeconds: z.number(),
});

const ReadinessSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({ database: DependencySchema, redis: DependencySchema }),
});

/**
 * Two probes, deliberately different.
 *
 * `/healthz` (liveness) answers "is this process alive?" and must not touch
 * dependencies — otherwise a brief database blip makes the orchestrator kill healthy
 * processes, turning a partial outage into a total one.
 *
 * `/readyz` (readiness) answers "should this instance receive traffic?" and does check
 * dependencies, so a degraded instance is drained rather than restarted.
 */
export const healthRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  const startedAt = Date.now();

  app.get(
    '/healthz',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        response: { 200: LivenessSchema },
      },
    },
    () => ({
      status: 'ok' as const,
      service: 'api' as const,
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['system'],
        summary: 'Readiness probe',
        response: { 200: ReadinessSchema, 503: ReadinessSchema },
      },
    },
    async (_request, reply) => {
      const [database, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);
      const ready = database.ok && redisCheck.ok;
      return reply.status(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('degraded' as const),
        checks: { database, redis: redisCheck },
      });
    },
  );
  done();
};
