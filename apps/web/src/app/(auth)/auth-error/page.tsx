import { Button } from '@quorum/ui';
import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sign-in problem — QUORUM' };

/**
 * Auth.js error codes are developer-facing. Each is mapped to a sentence that tells the
 * person what happened and what to do, because "Configuration" on a red page is how a
 * user decides a product is broken.
 */
const MESSAGES: Record<string, { title: string; detail: string }> = {
  Configuration: {
    title: 'Sign-in is not configured',
    detail:
      'This deployment has no working sign-in method. If you run it, set Google OAuth credentials or SMTP settings and restart.',
  },
  AccessDenied: {
    title: 'That account cannot sign in',
    detail: 'Your workspace owner may have removed your access. Ask them to re-invite you.',
  },
  AccountDisabled: {
    title: 'This account is disabled',
    detail: 'Contact your workspace owner to have it re-enabled.',
  },
  Verification: {
    title: 'That link has expired',
    detail: 'Sign-in links work once and last 15 minutes. Request a fresh one.',
  },
  OAuthAccountNotLinked: {
    title: 'That email is already registered',
    detail:
      'This address was first used with a different sign-in method. Use the original method to keep the account under one identity.',
  },
  Default: {
    title: 'Something went wrong signing in',
    detail: 'Try again. If it keeps happening, contact your workspace owner.',
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.error === 'string' ? params.error : 'Default';
  const { title, detail } = MESSAGES[code] ?? MESSAGES.Default!;

  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full border border-hairline bg-raised">
        <AlertTriangle className="size-5 text-review" aria-hidden />
      </div>
      <h1 className="text-lg font-medium tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{detail}</p>
      <p className="mt-4 font-mono text-[11px] text-fg-subtle">{code}</p>
      <Button variant="secondary" size="sm" className="mt-6" asChild>
        <Link href="/signin">Back to sign in</Link>
      </Button>
    </div>
  );
}
