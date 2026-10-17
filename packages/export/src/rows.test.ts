import { describe, expect, it } from 'vitest';
import type { ClaimRecord, CritiqueRecord, VerdictRecord } from '@quorum/db';
import { buildExportBundle } from './rows.js';

const claim = (over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  id: 'clm_1',
  stepId: 'stp_1',
  entity: 'Ramp',
  field: 'price_per_user_monthly.plus',
  value: 15,
  unit: 'USD/user/month',
  sourceUrl: 'https://ramp.com/pricing',
  sourceSelector: null,
  sourceText: '$15 /user/month',
  screenshotKey: 'runs/r1/shot-1.jpg',
  domSnapshotKey: null,
  extractedAt: new Date('2026-08-02T10:00:00Z'),
  extractedBy: 'claude-sonnet-4-5',
  promptVersion: 'reasoning.v4',
  confidence: 0.96,
  status: 'VERIFIED',
  ambiguity: null,
  nullReason: null,
  supersedesId: null,
  correctedBy: null,
  ...over,
});

const verdict = (over: Partial<VerdictRecord> = {}): VerdictRecord => ({
  id: 'vd_1',
  claimId: 'clm_1',
  verdict: 'VERIFIED',
  independentReading: 15,
  rationale: 'matches',
  confidence: 0.98,
  model: 'claude-haiku-4-5',
  createdAt: new Date(),
  ...over,
});

const critique = (over: Partial<CritiqueRecord> = {}): CritiqueRecord => ({
  id: 'cr_1',
  runId: 'run_1',
  kind: 'UNIT_MISMATCH',
  severity: 'BLOCKING',
  message: "Expensify's $5 appears to be the annual rate.",
  claimIds: ['clm_1'],
  remedy: { action: 're_extract' },
  resolution: 'OPEN',
  resolvedBy: null,
  resolvedAt: null,
  createdAt: new Date(),
  ...over,
});

const build = (
  claims: ClaimRecord[],
  verdicts: [string, VerdictRecord[]][] = [],
  critiques: CritiqueRecord[] = [],
) =>
  buildExportBundle({
    claims,
    verdictsByClaim: new Map(verdicts),
    critiques,
    artifactBaseUrl: 'https://artifacts.quorum.app',
  });

describe('results sheet', () => {
  it('exports one row per accepted claim', () => {
    const bundle = build([claim()]);
    expect(bundle.results).toHaveLength(1);
    expect(bundle.results[0]).toMatchObject({
      entity: 'Ramp',
      value: '15',
      unit: 'USD/user/month',
      confidence: 0.96,
    });
  });

  it('renders a null value as its reason, not as an empty cell', () => {
    // An empty cell reads as "we forgot"; the reason reads as "we checked and it is not
    // there", which is a different and more useful statement.
    const bundle = build([claim({ value: null, nullReason: 'not_present', sourceText: null })]);
    expect(bundle.results[0]?.value).toBe('not_present');
  });

  it('names the critique in the note in severity order', () => {
    const bundle = build(
      [claim()],
      [],
      [
        critique({
          id: 'cr_1',
          severity: 'WARNING',
          kind: 'DUPLICATE',
          message: 'extracted more than once.',
        }),
        critique({
          id: 'cr_2',
          severity: 'BLOCKING',
          kind: 'UNIT_MISMATCH',
          message: 'units are not comparable.',
        }),
      ],
    );
    expect(bundle.results[0]?.note).toBe(
      'UNIT_MISMATCH (blocking) — units are not comparable. See Findings. DUPLICATE (warning) — extracted more than once. See Findings.',
    );
  });

  it('reserves visual emphasis for blocking critiques', () => {
    const withWarning = build(
      [claim()],
      [],
      [critique({ severity: 'WARNING', kind: 'DUPLICATE', message: 'duplicate.' })],
    );
    expect(withWarning.results[0]?.needsReview).toBe(false);

    const withBlocking = build(
      [claim()],
      [],
      [critique({ severity: 'BLOCKING', kind: 'UNIT_MISMATCH', message: 'mismatch.' })],
    );
    expect(withBlocking.results[0]?.needsReview).toBe(true);
  });

  it('adds a review note to a low-confidence claim', () => {
    const bundle = build([claim({ confidence: 0.4, status: 'UNVERIFIED' })]);
    expect(bundle.results[0]?.note).toMatch(/Needs review/);
  });
});

describe('provenance sheet — the reason the feature exists', () => {
  it('carries everything needed to trace a value back to a pixel', () => {
    const bundle = build([claim()], [['clm_1', [verdict()]]]);
    const row = bundle.provenance[0]!;
    expect(row.sourceUrl).toBe('https://ramp.com/pricing');
    expect(row.sourceText).toBe('$15 /user/month');
    expect(row.extractedBy).toBe('claude-sonnet-4-5');
    expect(row.promptVersion).toBe('reasoning.v4');
    expect(row.extractedAt).toBe('2026-08-02T10:00:00.000Z');
    expect(row.screenshot).toBe('https://artifacts.quorum.app/runs/r1/shot-1.jpg');
    expect(row.claimId).toBe('clm_1');
  });

  it('records the verifier’s independent reading alongside the claim', () => {
    const bundle = build(
      [claim()],
      [['clm_1', [verdict({ verdict: 'CONTRADICTED', independentReading: 12 })]]],
    );
    // A contradiction routes the claim to human review, so it stays in the export with the
    // disagreement visible rather than being silently dropped.
    expect(bundle.provenance[0]?.verificationStatus).toBe('CONTRADICTED');
    expect(bundle.provenance[0]?.independentReading).toBe('12');
  });

  it('says "not sampled" rather than implying a verification that never happened', () => {
    expect(build([claim()]).provenance[0]?.verificationStatus).toBe('not sampled');
  });

  it('has exactly one provenance row per exported result row', () => {
    const bundle = build([claim(), claim({ id: 'clm_2', entity: 'Brex' })]);
    expect(bundle.provenance).toHaveLength(bundle.results.length);
  });

  it('leaves the screenshot cell empty rather than emitting a broken link', () => {
    expect(build([claim({ screenshotKey: null })]).provenance[0]?.screenshot).toBe('');
  });
});

describe('exclusions', () => {
  it('excludes superseded claims so a correction does not appear twice', () => {
    const bundle = build([claim({ status: 'SUPERSEDED' }), claim({ id: 'clm_2' })]);
    expect(bundle.results).toHaveLength(1);
    expect(bundle.summary.excluded).toBe(1);
  });

  it('excludes a claim the source did not support at all', () => {
    const bundle = build([claim()], [['clm_1', [verdict({ verdict: 'UNSUPPORTED' })]]]);
    expect(bundle.results).toHaveLength(0);
    expect(bundle.summary.excluded).toBe(1);
  });

  it('counts what it excluded, because invisible incompleteness is the worse failure', () => {
    const bundle = build([claim({ status: 'SUPERSEDED' })]);
    expect(bundle.summary.totalClaims).toBe(1);
    expect(bundle.summary.exported).toBe(0);
    expect(bundle.summary.excluded).toBe(1);
  });
});

describe('summary', () => {
  it('reports verification and correction counts and mean confidence', () => {
    const bundle = build([
      claim({ confidence: 1 }),
      claim({ id: 'clm_2', confidence: 0.9, status: 'HUMAN_CORRECTED' }),
    ]);
    expect(bundle.summary.exported).toBe(2);
    expect(bundle.summary.verified).toBe(1);
    expect(bundle.summary.humanCorrected).toBe(1);
    expect(bundle.summary.meanConfidence).toBe(0.95);
  });

  it('counts blocking findings, which gate a run from presenting as finished', () => {
    const bundle = build(
      [claim()],
      [],
      [critique(), critique({ id: 'cr_2', severity: 'WARNING' })],
    );
    expect(bundle.summary.blockingCritiques).toBe(1);
  });

  it('reports zero mean confidence rather than NaN for an empty export', () => {
    expect(build([]).summary.meanConfidence).toBe(0);
  });
});
