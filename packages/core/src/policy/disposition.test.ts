import { describe, expect, it } from 'vitest';
import type { ClaimStatus } from '../enums.js';
import {
  DEFAULT_DISPOSITION_POLICY,
  claimDisposition,
  explainDisposition,
  isExportable,
  shouldVerify,
  type DispositionInput,
} from './disposition.js';

const claim = (over: Partial<DispositionInput> = {}): DispositionInput => ({
  confidence: 0.95,
  status: 'VERIFIED',
  grounded: true,
  verdicts: [],
  ...over,
});

const verdicts = (...vs: ClaimStatus[]) => vs.map((verdict) => ({ verdict }));

describe('claimDisposition', () => {
  it('accepts a grounded, high-confidence, verified claim', () => {
    expect(claimDisposition(claim())).toBe('ACCEPT');
  });

  it('quarantines an ungrounded claim regardless of confidence', () => {
    expect(claimDisposition(claim({ grounded: false, confidence: 0.99 }))).toBe('QUARANTINE');
  });

  it('quarantines even when the verifier confirmed it — grounding wins outright', () => {
    expect(claimDisposition(claim({ grounded: false, verdicts: verdicts('VERIFIED') }))).toBe(
      'QUARANTINE',
    );
  });

  it('sends a contradicted claim to a human rather than dropping it', () => {
    expect(claimDisposition(claim({ verdicts: verdicts('CONTRADICTED') }))).toBe('HUMAN_REVIEW');
  });

  it('quarantines a claim the source does not support at all', () => {
    expect(claimDisposition(claim({ verdicts: verdicts('UNSUPPORTED') }))).toBe('QUARANTINE');
  });

  it('sends low-confidence claims to review', () => {
    expect(claimDisposition(claim({ confidence: 0.59 }))).toBe('HUMAN_REVIEW');
  });

  it('flags mid-confidence claims without blocking them', () => {
    expect(claimDisposition(claim({ confidence: 0.7 }))).toBe('FLAG');
  });

  it('flags an ambiguous verdict', () => {
    expect(claimDisposition(claim({ verdicts: verdicts('AMBIGUOUS') }))).toBe('FLAG');
  });

  it('accepts a human correction unconditionally — a person outranks the pipeline', () => {
    expect(claimDisposition(claim({ status: 'HUMAN_CORRECTED', confidence: 0.1 }))).toBe('ACCEPT');
  });

  it('quarantines a superseded claim so corrections do not appear twice', () => {
    expect(claimDisposition(claim({ status: 'SUPERSEDED' }))).toBe('QUARANTINE');
  });

  it('honours a stricter workspace policy without touching claim history', () => {
    const strict = { humanReviewBelowConfidence: 0.9, flagBelowConfidence: 0.99 };
    expect(claimDisposition(claim({ confidence: 0.95 }))).toBe('ACCEPT');
    expect(claimDisposition(claim({ confidence: 0.95 }), strict)).toBe('FLAG');
    expect(claimDisposition(claim({ confidence: 0.85 }), strict)).toBe('HUMAN_REVIEW');
  });

  it('prefers the more severe outcome when several conditions apply', () => {
    expect(claimDisposition(claim({ confidence: 0.3, verdicts: verdicts('AMBIGUOUS') }))).toBe(
      'HUMAN_REVIEW',
    );
  });
});

describe('isExportable', () => {
  it('excludes only quarantined claims', () => {
    expect(isExportable('ACCEPT')).toBe(true);
    expect(isExportable('FLAG')).toBe(true);
    expect(isExportable('HUMAN_REVIEW')).toBe(true);
    expect(isExportable('QUARANTINE')).toBe(false);
  });
});

describe('explainDisposition', () => {
  it('says nothing for an accepted claim and something useful otherwise', () => {
    expect(explainDisposition('ACCEPT')).toBeNull();
    for (const d of ['FLAG', 'HUMAN_REVIEW', 'QUARANTINE'] as const) {
      expect(explainDisposition(d)?.length).toBeGreaterThan(20);
    }
  });
});

describe('shouldVerify', () => {
  it('always verifies anything below the flag threshold, whatever the sample rate', () => {
    expect(shouldVerify(0.5, 0, 0.99)).toBe(true);
    expect(shouldVerify(DEFAULT_DISPOSITION_POLICY.flagBelowConfidence - 0.01, 0, 0.99)).toBe(true);
  });

  it('samples the confident remainder at the configured rate', () => {
    expect(shouldVerify(0.99, 0.2, 0.1)).toBe(true);
    expect(shouldVerify(0.99, 0.2, 0.5)).toBe(false);
  });

  it('verifies everything at a sample rate of 1, as a regulated workspace would want', () => {
    expect(shouldVerify(1, 1, 0.999)).toBe(true);
  });
});
