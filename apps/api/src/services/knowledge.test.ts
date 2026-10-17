import { describe, expect, it } from 'vitest';
import { retrieveKnowledge } from '@quorum/ai';
import { loadKnowledgeChunks } from './knowledge.js';

describe('curated QUORUM knowledge corpus evaluation', () => {
  it('loads sourced documentation chunks rather than an empty corpus', async () => {
    const chunks = await loadKnowledgeChunks();
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.every((chunk) => chunk.sourcePath.length > 0)).toBe(true);
  });

  it('achieves recall@3 for representative product questions', async () => {
    const chunks = await loadKnowledgeChunks();
    const cases = [
      {
        question: 'How does QUORUM prevent an agent from submitting without approval?',
        expectedPath: 'README.md',
      },
      {
        question: 'What makes extracted values traceable to evidence from the page?',
        expectedPath: 'docs/ARCHITECTURE.md',
      },
      {
        question: 'What services are used for the API, worker, database, and queue?',
        expectedPath: 'docs/DEPLOYMENT.md, docs/TROUBLESHOOTING.md',
      },
    ];
    const found = cases.filter((evaluationCase) =>
      retrieveKnowledge(evaluationCase.question, chunks, 3).some(
        (chunk) => chunk.sourcePath === evaluationCase.expectedPath,
      ),
    ).length;

    expect(found / cases.length).toBeGreaterThanOrEqual(0.9);
  });
});
