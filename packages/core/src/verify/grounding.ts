/**
 * The strongest hallucination defence in the system, and the cheapest.
 *
 * Every claim carries the verbatim text it was read from. If that text does not appear in
 * the page we captured, the model did not read it — no confidence score and no verifier
 * opinion can rehabilitate that. The check is deterministic, costs zero tokens, and
 * involves no model judgement at all: any hallucination-detection system should start
 * with the check that needs no model.
 */

export type GroundingFailure =
  | 'no_source_text'
  | 'source_text_not_in_dom'
  | 'source_text_too_short'
  | 'value_not_in_source_text';

export interface GroundingResult {
  grounded: boolean;
  reason: GroundingFailure | 'explicit_null' | 'matched' | 'matched_normalised';
  /** What was searched for, after normalisation — surfaced when a check fails. */
  normalisedNeedle?: string;
}

export interface GroundingInput {
  /** The extracted value. `null` is a legitimate answer and is grounded by definition. */
  value: unknown;
  sourceText: string | null | undefined;
  /** Concatenated page text: DOM text plus the rendered accessibility tree. */
  captured: string;
  /** Requires the value itself to appear inside the quoted source text. */
  requireValueInSource?: boolean;
}

/**
 * Pages are full of characters that look identical and are not: non-breaking spaces from
 * a CMS, curly quotes from a designer, en dashes in price ranges, zero-width joiners from
 * an emoji picker. A model reading "$12 – $15" and writing "$12 - $15" has read the page
 * correctly, and failing it for the dash would train users to ignore the check.
 */
export function normaliseForComparison(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Quoted source text must be substantial enough to mean something. "0" appears on almost
 * every page, so a one-character quote proves nothing and would let a fabricated value
 * pass the check that exists to catch fabrication.
 */
const MIN_SOURCE_TEXT_LENGTH = 2;

/** Claim values are primitives or arrays of strings; anything else has no textual form a
 *  page could contain, so it cannot be located inside a quote. */
function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).join(' ');
  return '';
}

export function assertGrounded(input: GroundingInput): GroundingResult {
  // A null with a reason is a correct answer, and there is nothing on the page to point
  // at. Requiring provenance for an absence would push models toward inventing one.
  if (input.value === null || input.value === undefined) {
    return { grounded: true, reason: 'explicit_null' };
  }

  const sourceText = input.sourceText?.trim() ?? '';
  if (sourceText.length === 0) return { grounded: false, reason: 'no_source_text' };
  if (sourceText.length < MIN_SOURCE_TEXT_LENGTH) {
    return { grounded: false, reason: 'source_text_too_short' };
  }

  const needle = normaliseForComparison(sourceText);

  // Exact substring first — the common case, and cheaper than normalising the page.
  const exact = input.captured.includes(sourceText);
  if (!exact) {
    const haystack = normaliseForComparison(input.captured);
    if (!haystack.includes(needle)) {
      return { grounded: false, reason: 'source_text_not_in_dom', normalisedNeedle: needle };
    }
  }

  // Checked on BOTH match paths. Running it only on the normalised path would mean an
  // exactly-quoted snippet paired with a number that is not in it slipped through the one
  // check designed to catch exactly that.
  if (input.requireValueInSource === true) {
    const value = normaliseForComparison(stringifyValue(input.value));
    // Numbers are compared without formatting, so "1,299" in the quote grounds 1299.
    const strippedNeedle = needle.replace(/[,\s]/g, '');
    const strippedValue = value.replace(/[,\s]/g, '');
    if (!needle.includes(value) && !strippedNeedle.includes(strippedValue)) {
      return { grounded: false, reason: 'value_not_in_source_text', normalisedNeedle: needle };
    }
  }

  return exact
    ? { grounded: true, reason: 'matched' }
    : { grounded: true, reason: 'matched_normalised', normalisedNeedle: needle };
}

/** Sentence shown beside a quarantined claim. Never a bare "ungrounded". */
export function explainGrounding(result: GroundingResult): string | null {
  switch (result.reason) {
    case 'matched':
    case 'matched_normalised':
    case 'explicit_null':
      return null;
    case 'no_source_text':
      return 'This value came without a quote from the page, so it cannot be traced to a source.';
    case 'source_text_too_short':
      return 'The quoted text is too short to identify anything on the page.';
    case 'source_text_not_in_dom':
      return "I could not find the text this value was supposedly read from anywhere on the page, so I'm not presenting it as a fact.";
    case 'value_not_in_source_text':
      return 'The quoted text does not actually contain this value.';
  }
}

/**
 * Ratio of claims that failed grounding. A spike is our direct fabrication signal and is
 * alerted on within minutes rather than days: it means a model update or a prompt change
 * started inventing values.
 */
export function groundingFailureRate(results: readonly GroundingResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((result) => !result.grounded).length / results.length;
}
