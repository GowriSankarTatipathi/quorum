import { describe, expect, it } from 'vitest';
import { retrieveKnowledge, type KnowledgeChunk } from './retrieval.js';
import { executeKnowledgeTool } from './tools.js';

const chunks: KnowledgeChunk[] = [
  {
    id: 'trust',
    title: 'Trust Ladder and approvals',
    sourcePath: 'README.md',
    content: 'Irreversible browser actions require human approval.',
  },
  {
    id: 'claims',
    title: 'Claims and provenance',
    sourcePath: 'docs/ARCHITECTURE.md',
    content: 'Every extracted claim has source text and is grounded against the page.',
  },
  {
    id: 'deployment',
    title: 'Deployment',
    sourcePath: 'docs/DEPLOYMENT.md',
    content: 'The API and worker run as separate services.',
  },
];

describe('retrieveKnowledge', () => {
  it('ranks the most relevant source first', () => {
    const results = retrieveKnowledge('How are irreversible actions approved?', chunks);

    expect(results[0]?.id).toBe('trust');
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('returns no matches for terms absent from the knowledge base', () => {
    expect(retrieveKnowledge('maternal nutrition guidance', chunks)).toEqual([]);
  });

  it('respects the requested result limit and handles empty queries', () => {
    expect(retrieveKnowledge('source claim verification', chunks, 1)).toHaveLength(1);
    expect(retrieveKnowledge('the and what', chunks)).toEqual([]);
  });

  it('retrieves expected documentation for a small evaluation set', () => {
    const evaluationCases = [
      { query: 'who approves an irreversible form submission', expected: 'trust' },
      { query: 'what text is used as the source for extracted claims', expected: 'claims' },
      { query: 'which services run the API and worker', expected: 'deployment' },
    ];
    const correct = evaluationCases.filter((testCase) => {
      const result = executeKnowledgeTool(
        { name: 'search_knowledge', arguments: { query: testCase.query, limit: 3 } },
        chunks,
      );
      return (
        result.name === 'search_knowledge' &&
        result.chunks.some((chunk) => chunk.id === testCase.expected)
      );
    }).length;

    expect(correct / evaluationCases.length).toBeGreaterThanOrEqual(0.9);
  });
});
