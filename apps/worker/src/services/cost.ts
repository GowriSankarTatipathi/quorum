export { llmCallRepository, runRepository } from '@quorum/db';

/**
 * Dollars arrive from the router as a JavaScript number; the database stores integer
 * micro-dollars. Rounding at this one boundary keeps the two representations consistent
 * and stops a float remainder from accumulating across ~35 calls per run.
 */
export function usdToMicroUsdSafe(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.round(usd * 1_000_000);
}
