import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { newId } from '@quorum/core';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env } from './env.js';
import { logger } from './logger.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import { getStorage, hasStorage } from './services/storage.js';
import { redis } from './redis.js';
import { controlRoutes } from './routes/control.js';
import { exportRoutes } from './routes/exports.js';
import { artifactRoutes } from './routes/artifacts.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { runRoutes } from './routes/runs.js';
import { registerWebsocket } from './routes/ws.js';

/**
 * Fastify over Express for one deciding reason: a single Zod schema per route produces
 * runtime validation, TypeScript types AND OpenAPI documentation. Express needs three
 * separate libraries to reach the same place, with three chances to drift apart.
 */
/**
 * The concrete instance type. Spelling it out (rather than returning the default
 * `FastifyInstance`) keeps the Zod type provider attached across module boundaries,
 * so routes registered in other files stay end-to-end typed.
 */
export type QuorumApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export async function buildApp(): Promise<QuorumApp> {
  // Widening the pino Logger to FastifyBaseLogger at the construction site prevents
  // Fastify from inferring the narrow pino type for its logger generic, which would
  // otherwise cause a contravariance mismatch when passing the instance to functions
  // typed with the default FastifyInstance (e.g. registerWebsocket in ws.ts).
  const loggerInstance: FastifyBaseLogger = logger;
  const app = Fastify({
    loggerInstance,
    // ULID request ids: sortable, and the same id format used for run events, so a
    // request can be correlated with the events it caused.
    genReqId: () => newId(),
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandler);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Backed by Redis so the limit is global across gateway instances rather than
    // per-instance, which would multiply the effective limit by the replica count.
    redis,
    keyGenerator: (request) => request.ip,
    allowList: ['/healthz', '/readyz'],
    // Rate limiting fails OPEN. It is a protective measure, not a correctness
    // requirement, and refusing every request because the counter store is unreachable
    // turns a degraded dependency into a total outage. The security denylist in
    // plugins/auth.ts deliberately fails CLOSED — that asymmetry is the point.
    skipOnError: true,
  });

  await app.register(websocket, {
    options: { maxPayload: 1_048_576 },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'QUORUM API',
        description:
          'Autonomous browser agents with claim-level provenance and human approval gates.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(
    (v1, _opts, done) => {
      v1.get('/', { schema: { tags: ['system'], summary: 'API root' } }, () => ({
        name: 'quorum-api',
        version: '0.1.0',
        docs: '/docs',
      }));
      done();
    },
    { prefix: '/v1' },
  );

  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(runRoutes, { prefix: '/v1' });
  await app.register(controlRoutes, { prefix: '/v1' });
  await app.register(exportRoutes, { prefix: '/v1' });

  // ws.ts declares its own absolute path (/v1/ws), so it takes no prefix.
  registerWebsocket(app);

  if (hasStorage() && getStorage().kind === 'filesystem') {
    await app.register(artifactRoutes, { prefix: '/v1' });
  }

  return app;
}
