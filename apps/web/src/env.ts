import 'server-only';
import { z } from 'zod';

/**
 * Server-side environment for the web app, validated at module load.
 *
 * `server-only` makes importing this from a client component a build error, which is
 * the mechanical guarantee that a secret cannot reach the browser bundle by accident.
 * Client-visible configuration lives in `src/lib/env.ts` and is deliberately separate.
 */
const ServerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),

    /** Encrypts the NextAuth session cookie. */
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    /** Signs API access tokens. Separate from AUTH_SECRET on purpose: compromising the
     *  cookie key should not also let an attacker mint API credentials. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    AUTH_URL: z.string().url().default('http://localhost:3000'),
    AUTH_TRUST_HOST: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_SERVER_HOST: z.string().optional(),
    EMAIL_SERVER_PORT: z.coerce.number().int().positive().optional(),
    EMAIL_SERVER_USER: z.string().optional(),
    EMAIL_SERVER_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('QUORUM <no-reply@quorum.local>'),

    ACCESS_TOKEN_TTL_S: z.coerce.number().int().positive().max(3600).default(900),
    REFRESH_TOKEN_TTL_S: z.coerce.number().int().positive().default(2_592_000),
  })
  .superRefine((env, ctx) => {
    const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);
    const emailConfigured = Boolean(env.EMAIL_SERVER_HOST) && Boolean(env.EMAIL_SERVER_PORT);

    // Half-configured Google is worse than none: the button renders, the user clicks it,
    // and the failure surfaces as an opaque callback error.
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.',
      });
    }

    if (!googleConfigured && !emailConfigured) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message:
          'No sign-in method is configured. Set Google OAuth credentials, or EMAIL_SERVER_HOST and EMAIL_SERVER_PORT for magic links.',
      });
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid web server environment:\n${issues}`);
  }
  return parsed.data;
}

let cached: ServerEnv | null = null;

/**
 * Validation is deferred to first access rather than performed at import.
 *
 * `next build` imports every route module to collect page data, so eager validation
 * would make a build require production secrets — and a build that needs secrets is a
 * build that cannot run in a clean CI container or a preview environment. Deferring
 * keeps the guarantee that matters (nothing serves a request under invalid config)
 * without inventing a dependency the build does not actually have.
 */
export function getServerEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}

/** Behaves like a plain object; the first property read triggers validation. */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get: (_target, property): unknown => Reflect.get(getServerEnv(), property),
  has: (_target, property) => property in getServerEnv(),
  ownKeys: () => Reflect.ownKeys(getServerEnv()),
  getOwnPropertyDescriptor: (_target, property) =>
    Reflect.getOwnPropertyDescriptor(getServerEnv(), property),
});

export const isGoogleEnabled = (env: ServerEnv = getServerEnv()): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);

export const isMagicLinkEnabled = (env: ServerEnv = getServerEnv()): boolean =>
  Boolean(env.EMAIL_SERVER_HOST) && Boolean(env.EMAIL_SERVER_PORT);
