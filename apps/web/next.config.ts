import type { NextConfig } from 'next';

// Read at build time so the policy names the exact origins this deployment talks to.
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const wsOrigin = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artifact: one fewer
  // build step, and a change in @quorum/ui is reflected in dev without a rebuild.
  transpilePackages: ['@quorum/ui', '@quorum/core', '@quorum/events'],
  experimental: { optimizePackageImports: ['lucide-react'] },
  poweredByHeader: false,
  async headers() {
    /**
     * The interface renders screenshots streamed from a run and, on Browserbase, embeds a
     * live browser view. Both are enumerated explicitly rather than loosened globally:
     * this application displays pages it does not control, so the blast radius of a
     * permissive policy is larger here than in an ordinary app.
     */
    const csp = [
      "default-src 'self'",
      // Next injects inline bootstrap scripts; styles come from Tailwind's runtime layer.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      // Screenshot frames arrive as blobs and data urls from the event stream.
      "img-src 'self' data: blob:",
      `connect-src 'self' ${apiOrigin} ${wsOrigin}`,
      // Only the managed browser vendor may be framed, and only when configured.
      "frame-src 'self' https://*.browserbase.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default config;
