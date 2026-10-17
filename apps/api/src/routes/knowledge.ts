import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { answerKnowledgeQuestion, listKnowledgeSources } from '../services/knowledge.js';

const AskBodySchema = z.object({
  question: z.string().trim().min(3).max(1_000),
});

const KnowledgeAnswerSchema = z.object({
  answer: z.string(),
  abstained: z.boolean(),
  toolsUsed: z.array(z.enum(['search_knowledge'])),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      excerpt: z.string(),
    }),
  ),
});

const KnowledgeSourcesSchema = z.object({
  sources: z.array(z.object({ title: z.string(), path: z.string() })),
});

export const knowledgeRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/knowledge/ask',
    {
      onRequest: app.requirePermission('run:read'),
      // LLM calls are the expensive part of this endpoint; cap each client independently
      // from ordinary API traffic to limit accidental loops and model spend.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['knowledge'],
        summary: 'Answer a QUORUM question from product documentation',
        security: [{ bearerAuth: [] }],
        body: AskBodySchema,
        response: { 200: KnowledgeAnswerSchema },
      },
    },
    async (request) => answerKnowledgeQuestion(request.body.question, request.id),
  );

  app.get(
    '/knowledge/sources',
    {
      onRequest: app.requirePermission('run:read'),
      schema: {
        tags: ['knowledge'],
        summary: 'List documentation available to the QUORUM knowledge assistant',
        security: [{ bearerAuth: [] }],
        response: { 200: KnowledgeSourcesSchema },
      },
    },
    async () => ({ sources: await listKnowledgeSources() }),
  );

  done();
};
