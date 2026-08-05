/**
 * Exact conversion between Postgres `DECIMAL` and integer micro-dollars.
 *
 * `Number("0.000004")` is not exactly 0.000004, and a run makes ~35 LLM calls whose
 * costs are summed and shown beside a total. Going through float means the total can
 * disagree with the sum of its line items by a fraction of a cent — which is precisely
 * the class of defect a product sold to accountants cannot ship. Parsing the decimal
 * string digit-by-digit keeps every value exact.
 */

export const MICRO_PER_USD = 1_000_000;

/** Decimal-like values stringify meaningfully; anything else is not a number. */
function stringify(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function')
    return (value as { toString: () => string }).toString();
  return '';
}

/**
 * Prisma returns Decimal as an object with a `toString`, or as a string, or a number —
 * and every column is `unknown` until the client is generated. The parameter is
 * therefore `unknown` and validated at runtime, which is honest about where the value
 * comes from and removes a cast from every one of the ~20 call sites.
 */
export type DecimalLike = unknown;

/** Parse a decimal value into integer micro-dollars, without floating point. */
export function decimalToMicroUsd(value: DecimalLike): number {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : stringify(value);
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  // Scientific notation can appear when a JS number round-trips through String().
  if (/e/i.test(unsigned)) {
    const asNumber = Number(unsigned);
    if (!Number.isFinite(asNumber)) return 0;
    const micros = Math.round(asNumber * MICRO_PER_USD);
    return negative ? -micros : micros;
  }

  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return 0;

  // Pad or round the fractional part to exactly six digits.
  const sixDigits = fraction.padEnd(7, '0').slice(0, 7);
  const truncated = Number(sixDigits.slice(0, 6));
  const roundingDigit = Number(sixDigits[6] ?? '0');
  const fractionMicros = truncated + (roundingDigit >= 5 ? 1 : 0);

  const micros = Number(whole || '0') * MICRO_PER_USD + fractionMicros;
  return negative ? -micros : micros;
}

/** Render integer micro-dollars back to a decimal string Postgres accepts. */
export function microUsdToDecimalString(micros: number): string {
  const negative = micros < 0;
  const abs = Math.abs(Math.round(micros));
  const whole = Math.floor(abs / MICRO_PER_USD);
  const fraction = String(abs % MICRO_PER_USD).padStart(6, '0');
  return `${negative ? '-' : ''}${String(whole)}.${fraction}`;
}

/** Lossy on purpose, and only for display. Never sum these. */
export function microUsdToNumber(micros: number): number {
  return micros / MICRO_PER_USD;
}

/** Confidence is DECIMAL(4,3) — three decimal places, so this is exact within a double. */
export function decimalToConfidence(value: DecimalLike): number | null {
  if (value == null) return null;
  return decimalToMicroUsd(value) / MICRO_PER_USD;
}
