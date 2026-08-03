import type { AutonomyMode } from '../enums.js';

/**
 * Pre-submit cost and duration estimate.
 *
 * Agent products feel financially unbounded, and that feeling suppresses usage more
 * than the actual price does. Showing a number BEFORE the user commits converts an
 * anxiety into a decision — so this runs client-side, instantly, with no LLM call.
 *
 * The model is deliberately simple and calibrated against the benchmark run in the
 * design document (§17.3): 5 sites / 7 steps / ~2m40s / ~$0.40.
 */

/** Per-site marginal cost: one browse turn plus one extraction plus sampled verification. */
const USD_PER_SITE = 0.055;
/** Fixed cost of the Planner, Critic and Formatter — paid once regardless of size. */
const USD_FIXED_AGENTS = 0.144;
/** Browser infrastructure, billed by the minute. */
const USD_PER_MINUTE_BROWSER = 0.01;
/** Seconds of browser work per target site, measured on the benchmark. */
const SECONDS_PER_SITE = 26;
const SECONDS_FIXED = 30;

/** `careful` splits steps finer for more inspection points, which costs more turns. */
const MODE_MULTIPLIER: Record<AutonomyMode, number> = {
  CAREFUL: 1.25,
  BALANCED: 1.0,
  AUTONOMOUS: 0.95,
};

const URL_PATTERN = /\bhttps?:\/\/[^\s,]+|\b[a-z0-9-]+\.(?:com|io|co|net|org|ai|dev|app)\b/gi;

/** Extracts explicit domains and, failing that, capitalised brand-like tokens. */
export function detectTargets(goal: string): string[] {
  const urls = goal.match(URL_PATTERN) ?? [];
  const hosts = urls.map((u) => {
    const withScheme = u.startsWith('http') ? u : `https://${u}`;
    try {
      return new URL(withScheme).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return u.toLowerCase();
    }
  });
  if (hosts.length > 0) return [...new Set(hosts)];

  // No explicit domains: infer entity count from a comma/and-separated brand list.
  const listMatch = goal.match(
    /(?:for|from|on|of)\s+([A-Z][\w.&-]*(?:\s*(?:,|and)\s*[A-Z][\w.&-]*)+)/,
  );
  if (listMatch?.[1]) {
    return [
      ...new Set(
        listMatch[1]
          .split(/\s*(?:,|and)\s*/)
          .map((s) => s.trim())
          .filter((s) => s.length > 1),
      ),
    ];
  }
  return [];
}

export interface RunEstimate {
  targetCount: number;
  estimatedSteps: number;
  estimatedSeconds: number;
  estimatedUsd: number;
  /** True when we could not detect targets and fell back to a default assumption. */
  isRough: boolean;
}

export function estimateRun(goal: string, mode: AutonomyMode): RunEstimate {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    return {
      targetCount: 0,
      estimatedSteps: 0,
      estimatedSeconds: 0,
      estimatedUsd: 0,
      isRough: false,
    };
  }

  const detected = detectTargets(trimmed);
  const isRough = detected.length === 0;
  // A goal with no detectable targets still costs something; assume a small research
  // task rather than showing $0.00, which would read as "free" and then surprise them.
  const targetCount = isRough
    ? Math.min(4, Math.max(1, Math.ceil(trimmed.length / 90)))
    : detected.length;

  const multiplier = MODE_MULTIPLIER[mode];
  const usd = (USD_FIXED_AGENTS + targetCount * USD_PER_SITE) * multiplier;
  const seconds = Math.round((SECONDS_FIXED + targetCount * SECONDS_PER_SITE) * multiplier);
  const browserUsd = (seconds / 60) * USD_PER_MINUTE_BROWSER;

  return {
    targetCount,
    // One resolve step, one per target, plus verification and formatting.
    estimatedSteps: targetCount + 3,
    estimatedSeconds: seconds,
    estimatedUsd: Math.round((usd + browserUsd) * 100) / 100,
    isRough,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
