'use server';

import { z } from 'zod';
import { apiFetch, ApiClientError } from '@/lib/api-client';

const KnowledgeAnswerSchema = z.object({
  answer: z.string(),
  abstained: z.boolean(),
  toolsUsed: z.array(z.string()),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      excerpt: z.string(),
    }),
  ),
});

export type KnowledgeAnswer = z.infer<typeof KnowledgeAnswerSchema>;

export type AskKnowledgeResult =
  { ok: true; result: KnowledgeAnswer } | { ok: false; message: string };

export async function askKnowledge(question: string): Promise<AskKnowledgeResult> {
  const parsedQuestion = z.string().trim().min(3).max(1_000).safeParse(question);
  if (!parsedQuestion.success) {
    return { ok: false, message: 'Enter a question between 3 and 1,000 characters.' };
  }

  try {
    const result = await apiFetch<KnowledgeAnswer>('/v1/knowledge/ask', {
      method: 'POST',
      body: JSON.stringify({ question: parsedQuestion.data }),
      parse: (value) => KnowledgeAnswerSchema.parse(value),
    });
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiClientError) return { ok: false, message: error.message };
    throw error;
  }
}
