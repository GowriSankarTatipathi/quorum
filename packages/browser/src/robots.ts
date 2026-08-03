export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

/** Matches this product's identity; a run is attributable, not anonymous. */
export const USER_AGENT_TOKEN = 'quorum';

/**
 * Parse robots.txt for our user-agent, falling back to the wildcard group.
 *
 * We honour robots.txt because we are selling into a regulated, reputation-driven
 * profession: "the agent ignored robots.txt" is a headline our customer cannot afford,
 * and the honest default happens to be the correct one. A blocked page is surfaced to
 * the human as a policy decision they can override with a logged justification, rather
 * than silently skipped or silently fetched.
 */
export function parseRobots(text: string): RobotsPolicy {
  const lines = text.split('\n');
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelayMs: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line.length === 0) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules, per the spec.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    if (field === 'disallow') current.rules.push({ type: 'disallow', path: value });
    else if (field === 'allow') current.rules.push({ type: 'allow', path: value });
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  const specific = groups.find((group) => group.agents.includes(USER_AGENT_TOKEN));
  const wildcard = groups.find((group) => group.agents.includes('*'));
  const chosen = specific ?? wildcard;

  return { rules: chosen?.rules ?? [], crawlDelayMs: chosen?.crawlDelayMs ?? null };
}

/** Longest-match wins, and Allow beats Disallow at equal length — the documented rule. */
export function isPathAllowed(policy: RobotsPolicy, pathname: string): boolean {
  let best: { rule: RobotsRule; length: number } | null = null;

  for (const rule of policy.rules) {
    // An empty Disallow means "allow everything" and matches nothing.
    if (rule.path.length === 0) continue;
    if (!matchesPattern(rule.path, pathname)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
      best = { rule, length };
    }
  }

  return best === null || best.rule.type === 'allow';
}

/** Supports the two wildcards robots.txt actually uses: `*` and a trailing `$`. */
function matchesPattern(pattern: string, pathname: string): boolean {
  if (!pattern.includes('*') && !pattern.endsWith('$')) return pathname.startsWith(pattern);

  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(pathname);
}

export const ALLOW_ALL: RobotsPolicy = { rules: [], crawlDelayMs: null };

export function isUrlAllowed(policy: RobotsPolicy, url: string): boolean {
  try {
    const parsed = new URL(url);
    return isPathAllowed(policy, `${parsed.pathname}${parsed.search}`);
  } catch {
    // An unparseable URL is not something to fetch optimistically.
    return false;
  }
}
