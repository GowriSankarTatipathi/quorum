import { describe, expect, it } from 'vitest';
import {
  BrowserActionOutputSchema,
  CritiqueOutputSchema,
  ReasoningOutputSchema,
  RecoveryOutputSchema,
  VerdictOutputSchema,
} from './agents.js';

describe('BrowserActionOutputSchema', () => {
  const base = { reasoning: 'The pricing grid is visible.', confidence: 0.9 };

  it('accepts a ref-addressed click', () => {
    expect(
      BrowserActionOutputSchema.safeParse({ ...base, action: { type: 'click', ref: 3 } }).success,
    ).toBe(true);
  });

  it('rejects an action type outside the closed vocabulary', () => {
    // The vocabulary is closed so the worst outcome of an injection is a wrong action
    // from a gated set, never an arbitrary one.
    expect(
      BrowserActionOutputSchema.safeParse({ ...base, action: { type: 'eval', code: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects a click without a ref, which is how selectors would sneak in', () => {
    expect(
      BrowserActionOutputSchema.safeParse({
        ...base,
        action: { type: 'click', selector: '.btn' },
      }).success,
    ).toBe(false);
  });

  it('rejects ref 0 — refs are minted from 1', () => {
    expect(
      BrowserActionOutputSchema.safeParse({ ...base, action: { type: 'click', ref: 0 } }).success,
    ).toBe(false);
  });

  it('requires give_up to state a reason', () => {
    expect(
      BrowserActionOutputSchema.safeParse({ ...base, action: { type: 'give_up', reason: '' } })
        .success,
    ).toBe(false);
  });

  it('defaults injection reporting to false so the field is always present', () => {
    const parsed = BrowserActionOutputSchema.parse({
      ...base,
      action: { type: 'screenshot' },
    });
    expect(parsed.injectionDetected).toBe(false);
    expect(parsed.injectionExcerpt).toBeNull();
  });
});

describe('ReasoningOutputSchema', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    entity: 'Ramp',
    field: 'price_per_user_monthly.plus',
    value: 15,
    unit: 'USD/user/month',
    sourceText: '$15 /user/month',
    confidence: 0.96,
    ambiguity: null,
    nullReason: null,
    ...over,
  });

  it('accepts a well-formed claim with provenance', () => {
    expect(ReasoningOutputSchema.safeParse({ claims: [claim()], note: null }).success).toBe(true);
  });

  it('rejects a non-null value with no source text', () => {
    // A value without a quote cannot be grounded, so it is refused at the boundary rather
    // than stored and quarantined later.
    const result = ReasoningOutputSchema.safeParse({
      claims: [claim({ sourceText: null })],
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/sourceText is required/);
  });

  it('rejects an empty source text just as firmly as a missing one', () => {
    expect(
      ReasoningOutputSchema.safeParse({ claims: [claim({ sourceText: '' })], note: null }).success,
    ).toBe(false);
  });

  it('requires a null value to say why it is null', () => {
    const result = ReasoningOutputSchema.safeParse({
      claims: [claim({ value: null, sourceText: null, nullReason: null })],
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/why it is null/);
  });

  it('accepts a null with a reason — the correct way to report an absence', () => {
    expect(
      ReasoningOutputSchema.safeParse({
        claims: [claim({ value: null, sourceText: null, nullReason: 'not_present' })],
        note: null,
      }).success,
    ).toBe(true);
  });

  it('accepts an empty extraction, which is a real answer', () => {
    expect(
      ReasoningOutputSchema.safeParse({ claims: [], note: 'No pricing on this page.' }).success,
    ).toBe(true);
  });
});

describe('VerdictOutputSchema', () => {
  it('requires an independent reading alongside the verdict', () => {
    expect(
      VerdictOutputSchema.safeParse({
        verdict: 'CONFIRMED',
        rationale: 'matches',
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('declares independentReading before verdict, so a reading must exist first', () => {
    // Models emit JSON in field order; the ordering is the anchoring-bias mitigation.
    const keys = Object.keys(VerdictOutputSchema.shape);
    expect(keys.indexOf('independentReading')).toBeLessThan(keys.indexOf('verdict'));
  });

  it('accepts a contradiction, which is the most valuable output it can produce', () => {
    expect(
      VerdictOutputSchema.safeParse({
        independentReading: 12,
        verdict: 'CONTRADICTED',
        rationale: 'The page shows $12, not $15.',
        confidence: 0.95,
      }).success,
    ).toBe(true);
  });

  it('accepts an independent reading that is an array', () => {
    expect(
      VerdictOutputSchema.safeParse({
        independentReading: ['Tier 1', 'Tier 2'],
        verdict: 'CONTRADICTED',
        rationale: 'There are actually two tiers.',
        confidence: 0.95,
      }).success,
    ).toBe(true);
  });
});

describe('CritiqueOutputSchema', () => {
  it('accepts a critique with an empty claimIds array for COVERAGE_GAP', () => {
    expect(
      CritiqueOutputSchema.safeParse({
        critiques: [
          {
            kind: 'COVERAGE_GAP',
            severity: 'BLOCKING',
            message: 'A tier is missing.',
            claimIds: [],
            remedy: { action: 're_extract', params: null },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts heterogeneous remedy params including booleans and arrays', () => {
    expect(
      CritiqueOutputSchema.safeParse({
        critiques: [
          {
            kind: 'UNIT_MISMATCH',
            severity: 'BLOCKING',
            message: 'Wrong unit',
            claimIds: ['clm_1'],
            remedy: {
              action: 're_extract',
              params: {
                entity: 'Expensify',
                drop_ids: ['clm_2', 'clm_3'],
                keep_one: true,
                threshold: 10,
              },
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts zero findings, which is a correct result on clean data', () => {
    expect(CritiqueOutputSchema.safeParse({ critiques: [] }).success).toBe(true);
  });

  it('accepts the demo critique verbatim', () => {
    expect(
      CritiqueOutputSchema.safeParse({
        critiques: [
          {
            kind: 'UNIT_MISMATCH',
            severity: 'BLOCKING',
            message: "Expensify's $5 appears to be the annual-billing rate.",
            claimIds: ['clm_expensify_collect'],
            remedy: { action: 're_extract', params: { entity: 'Expensify', period: 'monthly' } },
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('RecoveryOutputSchema', () => {
  const base = {
    rationale: 'The overlay was still present.',
    expectedOutcome: 'The consent dialog is gone and the grid is clickable.',
    alternateUrl: null,
    humanQuestion: null,
  };

  it('accepts a strategy from the ladder', () => {
    expect(RecoveryOutputSchema.safeParse({ ...base, strategy: 'dismiss_overlay' }).success).toBe(
      true,
    );
  });

  it('rejects a strategy the runtime never offers to a model', () => {
    // abort_step_and_alert is the injection response; it is executed by the runtime and
    // must not be selectable by the component an injection targets.
    expect(
      RecoveryOutputSchema.safeParse({ ...base, strategy: 'abort_step_and_alert' }).success,
    ).toBe(false);
  });

  it('rejects an invented strategy', () => {
    expect(RecoveryOutputSchema.safeParse({ ...base, strategy: 'try_harder' }).success).toBe(false);
  });

  it('requires an expected outcome, so success can be judged afterwards', () => {
    expect(
      RecoveryOutputSchema.safeParse({ ...base, strategy: 'retry_same', expectedOutcome: '' })
        .success,
    ).toBe(false);
  });
});
