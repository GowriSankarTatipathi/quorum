import { describe, expect, it } from 'vitest';
import { detectTargets, estimateRun, formatDuration } from './estimate.js';

describe('detectTargets', () => {
  it('extracts and normalises explicit domains', () => {
    expect(detectTargets('pricing from https://www.ramp.com/pricing and brex.com')).toEqual([
      'ramp.com',
      'brex.com',
    ]);
  });

  it('deduplicates repeated hosts', () => {
    expect(detectTargets('ramp.com and ramp.com/pricing')).toEqual(['ramp.com']);
  });

  it('falls back to a brand list when no domains are present', () => {
    expect(detectTargets('Get pricing for Ramp, Brex, Expensify and Navan')).toEqual([
      'Ramp',
      'Brex',
      'Expensify',
      'Navan',
    ]);
  });

  it('returns nothing for a goal with neither', () => {
    expect(detectTargets('find some interesting accounting startups')).toEqual([]);
  });
});

describe('estimateRun', () => {
  it('is zero for an empty goal', () => {
    expect(estimateRun('   ', 'BALANCED').estimatedUsd).toBe(0);
  });

  it('lands near the benchmark for the flagship five-site task', () => {
    const e = estimateRun(
      'Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase',
      'BALANCED',
    );
    expect(e.targetCount).toBe(5);
    expect(e.estimatedUsd).toBeGreaterThan(0.35);
    expect(e.estimatedUsd).toBeLessThan(0.48);
    expect(e.estimatedSeconds).toBeGreaterThan(120);
    expect(e.estimatedSeconds).toBeLessThan(200);
  });

  it('costs more in careful mode, which splits steps finer', () => {
    const goal = 'pricing for ramp.com and brex.com';
    expect(estimateRun(goal, 'CAREFUL').estimatedUsd).toBeGreaterThan(
      estimateRun(goal, 'BALANCED').estimatedUsd,
    );
  });

  it('never shows $0.00 for a non-empty goal, which would read as free', () => {
    const e = estimateRun('research something vague', 'BALANCED');
    expect(e.estimatedUsd).toBeGreaterThan(0);
    expect(e.isRough).toBe(true);
  });

  it('scales steps with target count', () => {
    expect(estimateRun('a.com b.com c.com', 'BALANCED').estimatedSteps).toBe(6);
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(160)).toBe('2m 40s');
  });
});
