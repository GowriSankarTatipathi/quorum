import { z } from 'zod';
import {
  retrieveKnowledge,
  type KnowledgeChunk,
  type RetrievedKnowledgeChunk,
} from './retrieval.js';

export const KnowledgeToolCallSchema = z.discriminatedUnion('name', [
  z
    .object({
      name: z.literal('search_knowledge'),
      arguments: z
        .object({
          query: z.string().trim().min(3).max(1_000),
          limit: z.number().int().min(1).max(6).default(4),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal('list_knowledge_sources'),
      arguments: z.object({}).strict(),
    })
    .strict(),
]);

export type KnowledgeToolCall = z.infer<typeof KnowledgeToolCallSchema>;

export type KnowledgeToolResult =
  | { name: 'search_knowledge'; chunks: RetrievedKnowledgeChunk[] }
  | { name: 'list_knowledge_sources'; sources: Array<{ title: string; path: string }> };

/**
 * The allowlisted, read-only tool surface for the documentation assistant.
 * Inputs are validated here even when the caller already validates HTTP input.
 */
export function executeKnowledgeTool(
  rawCall: unknown,
  chunks: readonly KnowledgeChunk[],
): KnowledgeToolResult {
  const call = KnowledgeToolCallSchema.parse(rawCall);
  if (call.name === 'search_knowledge') {
    return {
      name: call.name,
      chunks: retrieveKnowledge(call.arguments.query, chunks, call.arguments.limit),
    };
  }

  const uniqueSources = new Map<string, { title: string; path: string }>();
  for (const chunk of chunks) {
    const title = chunk.title.split(':')[0]!;
    uniqueSources.set(title, { title, path: chunk.sourcePath });
  }
  return { name: call.name, sources: [...uniqueSources.values()] };
}
