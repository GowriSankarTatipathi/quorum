import { describe, expect, it } from 'vitest';
import {
  assertGrounded,
  explainGrounding,
  groundingFailureRate,
  normaliseForComparison,
} from './grounding.js';

const page = `
Brex Pricing
Essentials $0
Premium $12 /user/month
Enterprise Custom
`;

describe('assertGrounded', () => {
  it('grounds a value whose quoted text is on the page', () => {
    const result = assertGrounded({ value: 12, sourceText: '$12 /user/month', captured: page });
    expect(result.grounded).toBe(true);
    expect(result.reason).toBe('matched');
  });

  it('rejects a value whose quoted text is nowhere on the page', () => {
    // The whole point: if the model says it read "$49/user/month" and that string is not
    // there, it did not read it.
    const result = assertGrounded({ value: 49, sourceText: '$49 /user/month', captured: page });
    expect(result.grounded).toBe(false);
    expect(result.reason).toBe('source_text_not_in_dom');
  });

  it('rejects a claim that arrived with no quote at all', () => {
    expect(assertGrounded({ value: 12, sourceText: null, captured: page }).reason).toBe(
      'no_source_text',
    );
    expect(assertGrounded({ value: 12, sourceText: '   ', captured: page }).reason).toBe(
      'no_source_text',
    );
  });

  it('rejects a quote too short to identify anything', () => {
    // "0" appears on nearly every page; accepting it would let fabrication through the
    // one check designed to catch fabrication.
    expect(assertGrounded({ value: 0, sourceText: '0', captured: page }).reason).toBe(
      'source_text_too_short',
    );
  });

  it('treats an explicit null as grounded — there is nothing to point at', () => {
    const result = assertGrounded({ value: null, sourceText: null, captured: page });
    expect(result.grounded).toBe(true);
    expect(result.reason).toBe('explicit_null');
  });

  it('tolerates whitespace differences between the quote and the page', () => {
    expect(
      assertGrounded({ value: 12, sourceText: '$12    /user/month', captured: page }).grounded,
    ).toBe(true);
  });

  it('tolerates typographic characters a CMS inserts', () => {
    const typographic = 'Plans from $12 – $15 per “seat”';
    for (const quote of ['$12 - $15 per "seat"', 'Plans from $12 – $15']) {
      expect(assertGrounded({ value: 12, sourceText: quote, captured: typographic }).grounded).toBe(
        true,
      );
    }
  });

  it('is case-insensitive only after an exact match fails', () => {
    const result = assertGrounded({ value: 12, sourceText: '$12 /USER/MONTH', captured: page });
    expect(result.grounded).toBe(true);
    expect(result.reason).toBe('matched_normalised');
  });

  it('optionally requires the value itself to appear inside the quote', () => {
    // Catches a subtler failure: a real quote paired with a number that is not in it.
    const mismatched = assertGrounded({
      value: 15,
      sourceText: '$12 /user/month',
      captured: page,
      requireValueInSource: true,
    });
    expect(mismatched.grounded).toBe(false);
    expect(mismatched.reason).toBe('value_not_in_source_text');
  });

  it('accepts a formatted number when the value is unformatted', () => {
    expect(
      assertGrounded({
        value: 1299,
        sourceText: 'Annual plan $1,299',
        captured: 'Annual plan $1,299 billed yearly',
        requireValueInSource: true,
      }).grounded,
    ).toBe(true);
  });

  it('grounds non-numeric values too', () => {
    expect(
      assertGrounded({ value: 'Enterprise', sourceText: 'Enterprise Custom', captured: page })
        .grounded,
    ).toBe(true);
  });

  it('returns the normalised needle so a failure is diagnosable', () => {
    const result = assertGrounded({ value: 49, sourceText: '$49  /USER', captured: page });
    expect(result.normalisedNeedle).toBe('$49 /user');
  });
});

describe('normaliseForComparison', () => {
  it('collapses whitespace, strips zero-width characters and folds case', () => {
    expect(normaliseForComparison('  A​  B\nC ')).toBe('a b c');
  });

  it('unifies dashes and quotes', () => {
    expect(normaliseForComparison('a–b')).toBe('a-b');
    expect(normaliseForComparison('“hi”')).toBe('"hi"');
  });
});

describe('explainGrounding', () => {
  it('says nothing when a claim is grounded', () => {
    expect(explainGrounding({ grounded: true, reason: 'matched' })).toBeNull();
  });

  it('explains every failure in a sentence a person can act on', () => {
    for (const reason of [
      'no_source_text',
      'source_text_too_short',
      'source_text_not_in_dom',
      'value_not_in_source_text',
    ] as const) {
      const message = explainGrounding({ grounded: false, reason });
      expect(message?.length).toBeGreaterThan(30);
      expect(message).not.toMatch(/undefined|null|Error/);
    }
  });
});

describe('groundingFailureRate', () => {
  it('is the direct fabrication signal we alert on', () => {
    expect(
      groundingFailureRate([
        { grounded: true, reason: 'matched' },
        { grounded: false, reason: 'source_text_not_in_dom' },
        { grounded: true, reason: 'matched' },
        { grounded: false, reason: 'no_source_text' },
      ]),
    ).toBe(0.5);
  });

  it('is zero for an empty set rather than NaN', () => {
    expect(groundingFailureRate([])).toBe(0);
  });
});
