import type { NextConfig } from 'next';

/**
 * The fixture site exists so CI tests OUR handling of hard pages, not the internet's
 * uptime. Real sites change, rate-limit and go down, which produces flaky tests that
 * engineers learn to ignore — and an ignored suite is worse than none.
 */
const config: NextConfig = { reactStrictMode: true, poweredByHeader: false };
export default config;
