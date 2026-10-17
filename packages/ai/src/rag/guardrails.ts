import type { KnowledgeChunk } from './retrieval.js';

export type KnowledgeQuestionDecision =
  | { allowed: true }
  | { allowed: false; answer: string; reason: 'out_of_scope' | 'prompt_injection' };

const OUT_OF_SCOPE_TERMS =
  /\b(health\s+(?:advice|question|issue|condition|concern)|medical|medicine|pregnan(?:cy|t)|maternal|diagnos(?:e|is)|symptom|medication|treatment|doctor|clinician)\b/i;
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|override)\b.{0,50}\b(instructions|rules|prompt|policy)\b/i,
  /\b(reveal|repeat|print|show|display|quote)\b.{0,40}\b(system|developer|hidden)\s+(prompt|instructions|message)\b/i,
  /\b(reveal|repeat|print|show)\b.{0,40}\b(secrets|api key)\b/i,
  /\b(developer mode|jailbreak|bypass guardrails)\b/i,
];

export const OUT_OF_SCOPE_ANSWER =
  'I can answer questions about QUORUM and its product documentation, but I cannot provide health, medical, or other professional advice.';

export const PROMPT_INJECTION_ANSWER =
  'I can answer questions about QUORUM’s product documentation, but I can’t reveal internal instructions or bypass the assistant’s rules.';

export function assessKnowledgeQuestion(question: string): KnowledgeQuestionDecision {
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(question))) {
    return { allowed: false, answer: PROMPT_INJECTION_ANSWER, reason: 'prompt_injection' };
  }
  if (OUT_OF_SCOPE_TERMS.test(question)) {
    return { allowed: false, answer: OUT_OF_SCOPE_ANSWER, reason: 'out_of_scope' };
  }
  return { allowed: true };
}

export interface KnowledgeCitation {
  id: string;
  title: string;
  path: string;
  excerpt: string;
}

export interface CitationCheck {
  valid: boolean;
  citedIds: string[];
  reason: 'missing_citations' | 'unknown_source' | 'citation_mismatch' | 'uncited_sentence' | null;
}

/**
 * A response must cite known retrieved sources inline, and the structured citation list
 * must agree. This is a format/traceability guard, not proof that the cited text entails
 * the model's claim; that still needs human-reviewed evaluations.
 */
export function validateKnowledgeCitations(
  answer: string,
  citations: readonly string[],
  availableIds: ReadonlySet<string>,
): CitationCheck {
  // A grouped reference cites each label, just like adjacent [S1] [S2] references.
  // Normalize only well-formed groups; every extracted label is still checked below.
  const normalizedAnswer = answer.replace(
    /\[(S\d+(?:[ \t]*,[ \t]*S\d+)+)\]/g,
    (_match, labels: string) =>
      labels
        .split(/[ \t]*,[ \t]*/)
        .map((id) => `[${id}]`)
        .join(' '),
  );
  const inlineIds = [...normalizedAnswer.matchAll(/\[(S\d+)\]/g)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined);
  const listedIds = [...new Set(citations)];
  // List numbers are formatting, and a citation immediately after a sentence's
  // punctuation still belongs to that sentence. Normalize those before splitting.
  const factualSegments = normalizedAnswer
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/([.!?])[ \t]+(\[S\d+\](?:[ \t]*\[S\d+\])*)/g, ' $2$1')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  let reason: CitationCheck['reason'] = null;
  if (inlineIds.length === 0 || listedIds.length === 0) reason = 'missing_citations';
  else if ([...inlineIds, ...listedIds].some((id) => !availableIds.has(id)))
    reason = 'unknown_source';
  else if (
    inlineIds.some((id) => !listedIds.includes(id)) ||
    listedIds.some((id) => !inlineIds.includes(id))
  )
    reason = 'citation_mismatch';
  else if (
    factualSegments.length === 0 ||
    factualSegments.some((segment) => !/\[S\d+\]/.test(segment))
  )
    reason = 'uncited_sentence';

  return {
    valid: reason === null,
    citedIds: listedIds.filter((id) => availableIds.has(id)),
    reason,
  };
}

export function sourcesForCitations(
  chunks: readonly KnowledgeChunk[],
  citations: readonly string[],
): KnowledgeCitation[] {
  const cited = new Set(citations);
  return chunks.flatMap((chunk, index) => {
    if (!cited.has(`S${index + 1}`)) return [];
    return [
      {
        id: `S${index + 1}`,
        title: chunk.title,
        path: chunk.sourcePath,
        excerpt: chunk.content.slice(0, 500),
      },
    ];
  });
}
