import { describe, expect, it } from 'vitest';
import { formatUsd, price, priceMicroUsd, sumCosts } from './pricing.js';

describe('priceMicroUsd', () => {
  it('prices input and output at their distinct rates', () => {
    // sonnet: $3/Mtok in, $15/Mtok out
    expect(priceMicroUsd('claude-sonnet-4-5-20250929', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      3_000_000,
    );
    expect(priceMicroUsd('claude-sonnet-4-5-20250929', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(
      15_000_000,
    );
  });

  it('discounts cached input tokens and does not double-charge them', () => {
    const full = priceMicroUsd('claude-sonnet-4-5-20250929', { inputTokens: 100_000, outputTokens: 0 });
    const cached = priceMicroUsd('claude-sonnet-4-5-20250929', {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 100_000,
    });
    expect(cached).toBeLessThan(full);
    expect(cached).toBe(30_000); // 100k * $0.30/Mtok
  });

  it('is exact in integer micro-dollars across many small calls', () => {
    const one = price('claude-haiku-4-5-20251001', { inputTokens: 1_000, outputTokens: 200 });
    const total = sumCosts(Array.from({ length: 35 }, () => one));
    expect(total.usd).toBeCloseTo(one.usd * 35, 10);
    expect(total.inputTokens).toBe(35_000);
  });
});

describe('formatUsd', () => {
  it('keeps sub-cent costs legible instead of rendering them as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.312)).toBe('$0.312');
    expect(formatUsd(1.5)).toBe('$1.50');
  });
});
