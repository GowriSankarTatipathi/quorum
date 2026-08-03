import { describe, expect, it } from 'vitest';
import {
  decimalToConfidence,
  decimalToMicroUsd,
  microUsdToDecimalString,
  microUsdToNumber,
} from './money.js';

describe('decimalToMicroUsd', () => {
  it('converts whole and fractional dollars exactly', () => {
    expect(decimalToMicroUsd('1')).toBe(1_000_000);
    expect(decimalToMicroUsd('0.5')).toBe(500_000);
    expect(decimalToMicroUsd('0.000004')).toBe(4);
    expect(decimalToMicroUsd('12.345678')).toBe(12_345_678);
  });

  it('is exact where float is not — the reason this function exists', () => {
    // Summing 0.1 + 0.2 as doubles yields 0.30000000000000004.
    const total = decimalToMicroUsd('0.1') + decimalToMicroUsd('0.2');
    expect(total).toBe(300_000);
    expect(microUsdToDecimalString(total)).toBe('0.300000');
  });

  it('keeps a 35-call run total equal to the sum of its line items', () => {
    const perCall = decimalToMicroUsd('0.004137');
    const total = Array.from({ length: 35 }).reduce<number>((sum) => sum + perCall, 0);
    expect(total).toBe(144_795);
    expect(microUsdToDecimalString(total)).toBe('0.144795');
  });

  it('rounds half-up at the seventh decimal rather than truncating silently', () => {
    expect(decimalToMicroUsd('0.0000005')).toBe(1);
    expect(decimalToMicroUsd('0.0000004')).toBe(0);
  });

  it('handles Prisma Decimal objects via toString', () => {
    expect(decimalToMicroUsd({ toString: () => '2.500000' })).toBe(2_500_000);
  });

  it('handles negatives, used for credits and refunds', () => {
    expect(decimalToMicroUsd('-0.25')).toBe(-250_000);
    expect(microUsdToDecimalString(-250_000)).toBe('-0.250000');
  });

  it('handles scientific notation from a round-tripped JS number', () => {
    expect(decimalToMicroUsd(String(1e-6))).toBe(1);
  });

  it('treats null, empty and malformed input as zero rather than NaN', () => {
    expect(decimalToMicroUsd(null)).toBe(0);
    expect(decimalToMicroUsd(undefined)).toBe(0);
    expect(decimalToMicroUsd('')).toBe(0);
    expect(decimalToMicroUsd('not a number')).toBe(0);
  });
});

describe('microUsdToDecimalString', () => {
  it('always pads to six decimal places so Postgres never widens the scale', () => {
    expect(microUsdToDecimalString(0)).toBe('0.000000');
    expect(microUsdToDecimalString(1)).toBe('0.000001');
    expect(microUsdToDecimalString(1_000_000)).toBe('1.000000');
  });

  it('round-trips every value', () => {
    for (const micros of [0, 1, 999_999, 1_000_000, 12_345_678, -4_200]) {
      expect(decimalToMicroUsd(microUsdToDecimalString(micros))).toBe(micros);
    }
  });
});

describe('microUsdToNumber', () => {
  it('is for display only', () => {
    expect(microUsdToNumber(310_000)).toBeCloseTo(0.31, 10);
  });
});

describe('decimalToConfidence', () => {
  it('reads DECIMAL(4,3) confidence values', () => {
    expect(decimalToConfidence('0.940')).toBeCloseTo(0.94, 10);
    expect(decimalToConfidence('1.000')).toBe(1);
    expect(decimalToConfidence('0.000')).toBe(0);
  });
});
