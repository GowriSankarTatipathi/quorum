/** Sub-cent costs are the norm, so two decimals would render most of a run as $0.00. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  return `${(count / 1_000).toFixed(1)}k`;
}

/** Elapsed time as mm:ss, counted from a start timestamp. */
export function elapsedSince(startedAt: string | null, now: number): string {
  if (!startedAt) return '0:00';
  return formatDuration(Math.max(0, now - new Date(startedAt).getTime()));
}

/**
 * Confidence is shown as five discrete pips rather than a percentage. `0.87` implies two
 * significant figures we do not have; five buckets answer the question the user is
 * actually asking — should I check this?
 */
export function confidenceToPips(confidence: number): number {
  if (confidence >= 0.95) return 5;
  if (confidence >= 0.85) return 4;
  if (confidence >= 0.7) return 3;
  if (confidence >= 0.5) return 2;
  return 1;
}

export function formatEventTime(ts: string, startedAt: string | null): string {
  if (!startedAt) return new Date(ts).toLocaleTimeString();
  const delta = new Date(ts).getTime() - new Date(startedAt).getTime();
  const seconds = Math.max(0, delta) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
