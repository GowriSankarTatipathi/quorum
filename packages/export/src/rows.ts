import { claimDisposition, isExportable, type Disposition } from '@quorum/core';
import type { ClaimRecord, CritiqueRecord, VerdictRecord } from '@quorum/db';

export interface ResultRow {
  entity: string;
  field: string;
  value: string;
  unit: string;
  confidence: number;
  status: string;
  /** Empty when the value stands on its own; a sentence when it needs a caveat. */
  note: string;
}

/**
 * One row per exported value, carrying everything needed to answer "where did this come
 * from?" three weeks later, in a meeting, without our application open.
 */
export interface ProvenanceRow {
  entity: string;
  field: string;
  value: string;
  sourceUrl: string;
  sourceText: string;
  extractedAt: string;
  extractedBy: string;
  promptVersion: string;
  confidence: number;
  verificationStatus: string;
  independentReading: string;
  screenshot: string;
  claimId: string;
  correctedBy: string;
}

export interface ExportInput {
  claims: readonly ClaimRecord[];
  verdictsByClaim: ReadonlyMap<string, readonly VerdictRecord[]>;
  critiques: readonly CritiqueRecord[];
  /** Base URL screenshots are served from, so a link in a spreadsheet resolves. */
  artifactBaseUrl: string;
}

export interface ExportBundle {
  results: ResultRow[];
  provenance: ProvenanceRow[];
  critiques: CritiqueRecord[];
  summary: {
    totalClaims: number;
    exported: number;
    excluded: number;
    verified: number;
    humanCorrected: number;
    meanConfidence: number;
    blockingCritiques: number;
  };
}

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(renderValue).join('; ');
  return JSON.stringify(value) ?? '';
};

const NOTE_FOR: Record<Disposition, string> = {
  ACCEPT: '',
  FLAG: 'Worth a glance — readable but not unambiguous.',
  HUMAN_REVIEW: 'Needs review: the verifier disagreed, or confidence was too low to stand behind.',
  QUARANTINE: '',
};

/**
 * Build the export.
 *
 * Two decisions here are the whole point of the feature. Quarantined claims are excluded
 * rather than silently dropped — the summary says how many and why, because invisible
 * incompleteness is worse than visible incompleteness. And provenance ships *inside* the
 * deliverable rather than as a separate log, because the partner's question arrives weeks
 * later without our product open: if the answer only lives in our app, we did not actually
 * solve the problem.
 */
export function buildExportBundle(input: ExportInput): ExportBundle {
  const results: ResultRow[] = [];
  const provenance: ProvenanceRow[] = [];

  let excluded = 0;
  let verified = 0;
  let humanCorrected = 0;
  let confidenceSum = 0;

  const flagged = new Set(input.critiques.flatMap((critique) => critique.claimIds));

  for (const claim of input.claims) {
    const verdicts = input.verdictsByClaim.get(claim.id) ?? [];
    const disposition = claimDisposition({
      confidence: claim.confidence,
      status: claim.status,
      // Storage already rejected ungrounded claims, so anything persisted is grounded.
      grounded: true,
      verdicts: verdicts.map((verdict) => ({ verdict: verdict.verdict })),
    });

    if (!isExportable(disposition)) {
      excluded += 1;
      continue;
    }

    if (claim.status === 'VERIFIED') verified += 1;
    if (claim.status === 'HUMAN_CORRECTED') humanCorrected += 1;
    confidenceSum += claim.confidence;

    const value = renderValue(claim.value);
    const critiqueNote = flagged.has(claim.id)
      ? 'Flagged by the Critic — see the Findings sheet.'
      : '';

    results.push({
      entity: claim.entity,
      field: claim.field,
      value: claim.value === null ? (claim.nullReason ?? 'not present') : value,
      unit: claim.unit ?? '',
      confidence: Number(claim.confidence.toFixed(3)),
      status: claim.status,
      note: [NOTE_FOR[disposition], critiqueNote].filter(Boolean).join(' '),
    });

    const latest = verdicts.at(-1);
    provenance.push({
      entity: claim.entity,
      field: claim.field,
      value,
      sourceUrl: claim.sourceUrl,
      sourceText: claim.sourceText ?? '',
      extractedAt: claim.extractedAt.toISOString(),
      extractedBy: claim.extractedBy,
      promptVersion: claim.promptVersion,
      confidence: Number(claim.confidence.toFixed(3)),
      verificationStatus: latest?.verdict ?? 'not sampled',
      independentReading: latest ? renderValue(latest.independentReading) : '',
      screenshot: claim.screenshotKey ? `${input.artifactBaseUrl}/${claim.screenshotKey}` : '',
      claimId: claim.id,
      correctedBy: claim.correctedBy ?? '',
    });
  }

  const exported = results.length;

  return {
    results,
    provenance,
    critiques: [...input.critiques],
    summary: {
      totalClaims: input.claims.length,
      exported,
      excluded,
      verified,
      humanCorrected,
      meanConfidence: exported === 0 ? 0 : Number((confidenceSum / exported).toFixed(3)),
      blockingCritiques: input.critiques.filter((critique) => critique.severity === 'BLOCKING')
        .length,
    },
  };
}
