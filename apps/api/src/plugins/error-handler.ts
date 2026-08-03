import { AuthError } from '@quorum/auth';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

/** Application errors carry a stable machine code AND a sentence written for a human. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string): ApiError =>
  new ApiError(404, 'E_NOT_FOUND', `${what} was not found.`);

export default fp(function errorHandler(app: FastifyInstance, _opts: unknown, done: () => void) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;

    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.warn({ err: error, requestId }, 'request failed validation');
      return reply.status(400).send({
        error: {
          code: 'E_VALIDATION',
          message: 'The request body or parameters were not in the expected shape.',
          details: error.validation,
          requestId,
        },
      } satisfies ApiErrorBody);
    }

    /**
     * Authentication failures carry two messages: a terse one for logs and a sentence
     * written for the person. Only the second crosses the wire, and the machine code
     * goes with it so the client can tell "refresh your token" apart from "you are not
     * allowed to do this" without parsing prose.
     */
    if (error instanceof AuthError) {
      request.log.warn({ err: error, requestId, code: error.code }, 'authentication failure');
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.humanMessage, requestId },
      } satisfies ApiErrorBody);
    }

    if (error instanceof ApiError) {
      request.log.warn({ err: error, requestId, code: error.code }, 'handled api error');
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      } satisfies ApiErrorBody);
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error, requestId }, 'unhandled error');
      // Never leak internal messages on a 5xx; they routinely contain connection
      // strings and query fragments.
      return reply.status(statusCode).send({
        error: {
          code: 'E_INTERNAL',
          message: 'Something went wrong on our side. The error has been recorded.',
          requestId,
        },
      } satisfies ApiErrorBody);
    }

    request.log.warn({ err: error, requestId }, 'client error');
    return reply.status(statusCode).send({
      error: { code: error.code || 'E_REQUEST', message: error.message, requestId },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'E_NOT_FOUND',
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    } satisfies ApiErrorBody),
  );

  done();
});
