import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read at build time so the policy names the exact origins this deployment talks to.
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
let wsOrigin = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const isDev = process.env.NODE_ENV !== 'production';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

if (!isDev && wsOrigin.startsWith('ws://')) {
  wsOrigin = wsOrigin.replace('ws://', 'wss://');
}

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Prisma's query engine is a native .node binary. Next's bundler does not follow it, so
  // the package is externalised and the generated client is traced explicitly. Without
  // this the serverless function boots and then fails on the first query with
  // "could not locate the Query Engine for runtime rhel-openssl-3.0.x".
  serverExternalPackages: ['@prisma/client', '@quorum/db'],
  // Next otherwise infers the workspace root from the nearest lockfile, which on this
  // machine resolved to the home directory and broke tracing entirely.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    '/**': ['../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*'],
  },
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
    const scriptSrc = [
      "script-src 'self' 'unsafe-inline'",
      // React Fast Refresh and the dev bundler evaluate code at runtime. Without this the
      // browser refuses to execute the client bundle at all in development — the page
      // renders from SSR and then nothing hydrates, no hooks run, and no WebSocket is
      // ever opened. Production builds do not need it and must not have it.
      isDev ? "'unsafe-eval'" : '',
    ]
      .filter(Boolean)
      .join(' ');

    const connectSrc = [
      "connect-src 'self'",
      apiOrigin,
      wsOrigin,
      // A browser treats localhost and 127.0.0.1 as different origins, and the two are
      // used interchangeably in local config. Allow both rather than depending on which
      // spelling happens to be in .env.local.
      isDev ? 'http://localhost:3001 ws://localhost:3001' : '',
      isDev ? 'http://127.0.0.1:3001 ws://127.0.0.1:3001' : '',
      // The dev server's own HMR socket.
      isDev ? 'ws://localhost:3000 ws://127.0.0.1:3000' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      // Screenshot frames arrive as blobs and data urls from the event stream.
      "img-src 'self' data: blob:",
      connectSrc,
      // Only the managed browser vendor may be framed, and only when configured.
      "frame-src 'self' https://*.browserbase.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      // Would rewrite http://localhost:3001 to https in development.
      isDev ? '' : 'upgrade-insecure-requests',
    ]
      .filter(Boolean)
      .join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev
            ? []
            : [
              {
                key: 'Strict-Transport-Security',
                value: 'max-age=63072000; includeSubDomains; preload',
              },
            ]),
        ],
      },
    ];
  },
};

export default config;
