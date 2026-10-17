export interface KnowledgeChunk {
  id: string;
  title: string;
  sourcePath: string;
  content: string;
}

export interface RetrievedKnowledgeChunk extends KnowledgeChunk {
  score: number;
}

const STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
]);

const K1 = 1.5;
const B = 0.75;

function tokenize(value: string): string[] {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []
  );
}

/**
 * Small-corpus BM25 retrieval: it needs no embedding service or vector database, while
 * retaining a clear seam for replacing lexical ranking with hybrid/vector search later.
 */
export function retrieveKnowledge(
  query: string,
  chunks: readonly KnowledgeChunk[],
  limit = 4,
): RetrievedKnowledgeChunk[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || chunks.length === 0 || limit <= 0) return [];

  const tokenized = chunks.map((chunk) => {
    const tokens = [...tokenize(chunk.title), ...tokenize(chunk.content)];
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { chunk, tokens, frequencies };
  });
  const averageLength =
    tokenized.reduce((sum, item) => sum + item.tokens.length, 0) / tokenized.length || 1;

  const ranked = tokenized.map(({ chunk, tokens, frequencies }) => {
    let score = 0;
    for (const term of terms) {
      const termFrequency = frequencies.get(term) ?? 0;
      if (termFrequency === 0) continue;

      const documentFrequency = tokenized.filter((item) => item.frequencies.has(term)).length;
      const inverseDocumentFrequency = Math.log(
        1 + (tokenized.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const lengthNormalization =
        termFrequency + K1 * (1 - B + B * (tokens.length / averageLength));
      score += inverseDocumentFrequency * ((termFrequency * (K1 + 1)) / lengthNormalization);
    }
    return { ...chunk, score };
  });

  return ranked
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}
