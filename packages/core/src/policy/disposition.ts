import type { ClaimStatus, Disposition } from '../enums.js';

/**
 * What the product should DO about a claim, given what verification learned about it.
 *
 * Deliberately separate from `ClaimStatus`: that records what we learned, this records
 * how to act. Keeping them apart means escalation policy can be tuned per workspace —
 * a firm doing regulated filings will want a higher review threshold — without
 * migrating a single historical row.
 */

export interface DispositionInput {
  confidence: number | null;
  status: ClaimStatus;
  /** False when the claim's `sourceText` does not appear in the captured DOM. */
  grounded: boolean;
  verdicts: readonly { verdict: ClaimStatus }[];
}

export interface DispositionPolicy {
  /** Below this, a human looks at it regardless of what the verifier said. */
  humanReviewBelowConfidence: number;
  /** Below this, the claim is flagged but still shown. */
  flagBelowConfidence: number;
}

export const DEFAULT_DISPOSITION_POLICY: DispositionPolicy = {
  humanReviewBelowConfidence: 0.6,
  flagBelowConfidence: 0.8,
};

export function claimDisposition(
  input: DispositionInput,
  policy: DispositionPolicy = DEFAULT_DISPOSITION_POLICY,
): Disposition {
  // Grounding is checked first and wins outright. If the text the model says it read is
  // not on the page, the model did not read it — no confidence score and no verifier
  // opinion can rehabilitate that.
  if (!input.grounded) return 'QUARANTINE';

  if (input.status === 'SUPERSEDED') return 'QUARANTINE';

  if (input.confidence === null) return 'HUMAN_REVIEW';

  if (input.status === 'HUMAN_CORRECTED') return 'ACCEPT';

  if (input.verdicts.some((v) => v.verdict === 'CONTRADICTED')) return 'HUMAN_REVIEW';
  if (input.verdicts.some((v) => v.verdict === 'UNSUPPORTED')) return 'QUARANTINE';

  if (input.confidence < policy.humanReviewBelowConfidence) return 'HUMAN_REVIEW';
  if (input.verdicts.some((v) => v.verdict === 'AMBIGUOUS')) return 'FLAG';
  if (input.status === 'AMBIGUOUS') return 'FLAG';
  if (input.confidence < policy.flagBelowConfidence) return 'FLAG';

  return 'ACCEPT';
}

/** Quarantined claims are shown struck through, never silently deleted, and never exported. */
export const isExportable = (disposition: Disposition): boolean => disposition !== 'QUARANTINE';

/** Sentence shown beside a claim the product is not willing to present as a fact. */
export function explainDisposition(disposition: Disposition): string | null {
  switch (disposition) {
    case 'ACCEPT':
      return null;
    case 'FLAG':
      return 'Worth a glance — the source was readable but not unambiguous.';
    case 'HUMAN_REVIEW':
      return 'Needs your eyes. The verifier disagreed, or confidence was too low to stand behind.';
    case 'QUARANTINE':
      return "Couldn't verify this against the page, so it is excluded from exports.";
  }
}

/**
 * Verification is risk-weighted rather than exhaustive: everything uncertain, plus a
 * sample of the rest. Full verification would roughly double cost and latency for a
 * marginal gain on claims that were already unambiguous.
 */
export function shouldVerify(
  confidence: number | null,
  sampleRate: number,
  random: number,
  policy: DispositionPolicy = DEFAULT_DISPOSITION_POLICY,
): boolean {
  if (confidence === null) return true;
  if (confidence < policy.flagBelowConfidence) return true;
  return random < sampleRate;
}
