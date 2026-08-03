import { MODELS, type ModelId } from './models.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface CallCost {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  usd: number;
}

export const ZERO_COST: CallCost = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  usd: 0,
};

/**
 * Costs are money and are shown to the user, so they are computed in integer
 * micro-dollars and only converted at the edge. Accumulating floating-point dollars
 * across ~35 LLM calls per run drifts; a product sold to accountants cannot show a
 * total that disagrees with the sum of its line items.
 */
export function priceMicroUsd(model: ModelId, usage: TokenUsage): number {
  const m = MODELS[model];
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const micros =
    (freshInput * m.inputPerMTok) / 1e6 +
    (cached * m.cachedInputPerMTok) / 1e6 +
    (usage.outputTokens * m.outputPerMTok) / 1e6;
  return Math.round(micros * 1e6);
}

export function price(model: ModelId, usage: TokenUsage): CallCost {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    usd: microUsdToUsd(priceMicroUsd(model, usage)),
  };
}

export const microUsdToUsd = (micros: number): number => micros / 1e6;
export const usdToMicroUsd = (usd: number): number => Math.round(usd * 1e6);

export function sumCosts(costs: readonly CallCost[]): CallCost {
  return costs.reduce<CallCost>(
    (acc, c) => ({
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      cachedInputTokens: acc.cachedInputTokens + c.cachedInputTokens,
      usd: acc.usd + c.usd,
    }),
    { ...ZERO_COST },
  );
}

/** Display helper: sub-cent costs are common, so 2dp would render everything as $0.00. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
