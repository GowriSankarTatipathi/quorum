import { z } from 'zod';

/**
 * The Browser agent's action vocabulary, as a closed discriminated union.
 *
 * Closed on purpose: the worst outcome of a successful prompt injection is then a *wrong*
 * action from a known, gated set — never an *arbitrary* one. Elements are addressed by
 * numeric ref, because a hallucinated CSS selector that happens to match something is a
 * confident wrong click, while an invalid ref is a caught, typed error.
 */
export const BrowserActionOutputSchema = z.object({
  reasoning: z.string().min(1).max(2_000),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('navigate'), url: z.string().url() }),
    z.object({ type: z.literal('click'), ref: z.number().int().min(1) }),
    z.object({
      type: z.literal('type'),
      ref: z.number().int().min(1),
      text: z.string().max(2_000),
    }),
    z.object({
      type: z.literal('select'),
      ref: z.number().int().min(1),
      value: z.string().max(500),
    }),
    z.object({
      type: z.literal('scroll'),
      direction: z.enum(['up', 'down']),
      pixels: z.number().int().min(1).max(20_000),
    }),
    z.object({
      type: z.literal('wait_for'),
      ref: z.number().int().min(1).nullable().default(null),
      milliseconds: z.number().int().min(0).max(30_000).nullable().default(null),
    }),
    z.object({ type: z.literal('press'), key: z.string().min(1).max(30) }),
    z.object({ type: z.literal('screenshot') }),
    z.object({ type: z.literal('extract_ready'), note: z.string().max(500).nullable().default(null) }),
    z.object({ type: z.literal('give_up'), reason: z.string().min(3).max(500) }),
  ]),
  confidence: z.number().min(0).max(1).nullable(),
  /** Set when page content tried to issue instructions of its own. */
  injectionDetected: z.boolean().default(false),
  injectionExcerpt: z.string().max(200).nullable().default(null),
});

export type BrowserActionOutput = z.infer<typeof BrowserActionOutputSchema>;

/** One extracted datum, with the provenance that makes it citable. */
export const ExtractedClaimSchema = z.object({
  entity: z.string().min(1).max(200),
  field: z.string().min(1).max(200),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  unit: z.string().max(100).nullable(),
  /**
   * The verbatim text the value was read from. Required for any non-null value: it is
   * what the deterministic grounding check compares against the captured page, and a
   * claim without it cannot be traced back to a pixel.
   */
  sourceText: z.string().max(1_000).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  ambiguity: z.string().max(500).nullable(),
  /** Why a null is null: "not_present" | "ambiguous" | "requires_human". */
  nullReason: z.enum(['not_present', 'ambiguous', 'requires_human']).nullable(),
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export const ReasoningOutputSchema = z
  .object({
    claims: z.array(ExtractedClaimSchema).max(200),
    /** Stated when the page could not be read as the step expected. */
    note: z.string().max(1_000).nullable(),
    injectionDetected: z.boolean().default(false),
    injectionExcerpt: z.string().max(200).nullable().default(null),
  })
  .superRefine((output, ctx) => {
    output.claims.forEach((claim, index) => {
      // A value without a quote cannot be grounded, so it is rejected at the boundary
      // rather than being stored and quarantined later.
      if (claim.value !== null && (claim.sourceText === null || claim.sourceText.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'sourceText'],
          message: 'sourceText is required for any value that is not null',
        });
      }
      if (claim.value === null && claim.nullReason === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'nullReason'],
          message: 'a null value must say why it is null',
        });
      }
    });
  });

export type ReasoningOutput = z.infer<typeof ReasoningOutputSchema>;

/**
 * The verifier commits to its own reading before it is allowed to express agreement.
 *
 * `independentReading` is declared first in the schema deliberately: models emit JSON in
 * field order, so requiring it before `verdict` forces a reading to exist before a
 * judgement does. Without it, verifiers confirm ~95% of claims regardless of correctness,
 * which is worse than no verification because it manufactures false certainty.
 */
export const VerdictOutputSchema = z.object({
  independentReading: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  verdict: z.enum(['CONFIRMED', 'CONTRADICTED', 'UNSUPPORTED', 'AMBIGUOUS']),
  rationale: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1).nullable(),
});

export type VerdictOutput = z.infer<typeof VerdictOutputSchema>;

export const CritiqueOutputSchema = z.object({
  critiques: z
    .array(
      z.object({
        kind: z.enum([
          'UNIT_MISMATCH',
          'OUTLIER',
          'DUPLICATE',
          'COVERAGE_GAP',
          'STALENESS',
          'CONTRADICTION',
          'SUSPICIOUS_UNIFORMITY',
        ]),
        severity: z.enum(['BLOCKING', 'WARNING', 'NOTE']),
        message: z.string().min(10).max(1_000),
        /** Every critique must cite the claims it is about. May be empty for COVERAGE_GAP. */
        claimIds: z.array(z.string()).max(50),
        remedy: z.object({
          action: z.enum(['re_extract', 'drop', 'merge', 'ask_human', 'accept']),
          params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).nullable(),
        }),
      }),
    )
    .max(30),
});

export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>;

export const RecoveryOutputSchema = z.object({
  strategy: z.enum([
    'retry_same',
    'wait_longer',
    'rescroll_rescan',
    'dismiss_overlay',
    'alternate_selector',
    'alternate_route',
    'switch_model',
    'decompose',
    'skip_and_note',
    'request_human',
  ]),
  rationale: z.string().min(1).max(1_000),
  /** Recorded so the system can tell whether the recovery actually worked. */
  expectedOutcome: z.string().min(1).max(500),
  /** Populated for alternate_route. */
  alternateUrl: z.string().url().nullable(),
  /** Populated for request_human: the exact question to put in front of the person. */
  humanQuestion: z.string().max(500).nullable(),
});

export type RecoveryOutput = z.infer<typeof RecoveryOutputSchema>;
