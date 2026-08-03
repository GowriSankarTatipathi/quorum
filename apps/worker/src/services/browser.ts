import {
  BrowserbaseDriver,
  FixtureDriver,
  PlaywrightDriver,
  SessionPool,
  type BrowserDriver,
  type FixturePage,
} from '@quorum/browser';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * One driver per process, chosen by configuration.
 *
 * The agent runtime never learns which one it got — that is the payoff for the driver
 * interface. Local development, CI and production differ by an environment variable
 * rather than by a parallel code path that then has to be kept in sync.
 */
function createDriver(): BrowserDriver {
  switch (env.BROWSER_DRIVER) {
    case 'browserbase':
      if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) {
        throw new Error(
          'BROWSER_DRIVER=browserbase requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID',
        );
      }
      return new BrowserbaseDriver({
        apiKey: env.BROWSERBASE_API_KEY,
        projectId: env.BROWSERBASE_PROJECT_ID,
      });
    case 'mock':
      // Registered pages are supplied by tests; an empty map here means a run would fail
      // fast rather than silently browsing nothing.
      return new FixtureDriver(new Map<string, FixturePage>(), 'about:blank');
    case 'playwright':
    default:
      return new PlaywrightDriver({ headless: env.NODE_ENV !== 'development' });
  }
}

export const browserDriver: BrowserDriver = createDriver();

export const sessionPool = new SessionPool(browserDriver, {
  maxConcurrent: env.MAX_CONCURRENT_SESSIONS,
  idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MS,
  maxSessionMs: env.MAX_RUN_DURATION_MS,
});

sessionPool.startSweeper(30_000, (ids) => {
  logger.warn({ sessionIds: ids }, 'reclaimed idle browser sessions');
});
