import { Button } from '@quorum/ui';
import { MailCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Check your email — QUORUM' };

export default async function VerifyRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const email = typeof params.email === 'string' ? params.email : null;

  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full border border-hairline bg-raised">
        <MailCheck className="size-5 text-verified" aria-hidden />
      </div>
      <h1 className="text-lg font-medium tracking-tight">Check your email</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        {email ? (
          <>
            We sent a sign-in link to <span className="font-mono text-fg">{email}</span>.
          </>
        ) : (
          <>We sent you a sign-in link.</>
        )}{' '}
        It works once and expires in 15 minutes.
      </p>
      <p className="mt-4 text-xs text-fg-subtle">
        Not there? Check spam, and confirm the address is the one your workspace uses.
      </p>
      <Button variant="ghost" size="sm" className="mt-6" asChild>
        <Link href="/signin">Use a different address</Link>
      </Button>
    </div>
  );
}
