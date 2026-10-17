import { describe, expect, it } from 'vitest';
import { executeKnowledgeTool } from './tools.js';
import type { KnowledgeChunk } from './retrieval.js';

const chunks: KnowledgeChunk[] = [
  {
    id: 'trust',
    title: 'Trust Ladder',
    sourcePath: 'README.md',
    content: 'Irreversible actions require human approval.',
  },
  {
    id: 'claims',
    title: 'Claims',
    sourcePath: 'docs/ARCHITECTURE.md',
    content: 'Claims are checked against their quoted source text.',
  },
];

describe('knowledge tools', () => {
  it('searches the curated corpus with validated bounded inputs', () => {
    const result = executeKnowledgeTool(
      { name: 'search_knowledge', arguments: { query: 'irreversible actions', limit: 2 } },
      chunks,
    );
    expect(result.name).toBe('search_knowledge');
    if (result.name !== 'search_knowledge') throw new Error('unexpected tool result');
    expect(result.chunks[0]?.id).toBe('trust');
    expect(() =>
      executeKnowledgeTool({ name: 'run_browser_action', arguments: {} }, chunks),
    ).toThrow();
    expect(() =>
      executeKnowledgeTool({ name: 'search_knowledge', arguments: { query: 'x' } }, chunks),
    ).toThrow();
  });

  it('lists sources without exposing anything outside the supplied corpus', () => {
    const result = executeKnowledgeTool({ name: 'list_knowledge_sources', arguments: {} }, chunks);
    expect(result).toEqual({
      name: 'list_knowledge_sources',
      sources: [
        { title: 'Trust Ladder', path: 'README.md' },
        { title: 'Claims', path: 'docs/ARCHITECTURE.md' },
      ],
    });
  });
});
