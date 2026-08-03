import { capabilitiesFromUser, describePermission } from '@quorum/auth';
import { TrustLevel, TRUST_EXPLANATIONS, explainApprovalDenial } from '@quorum/core';
import { refreshTokenRepository } from '@quorum/db';
import { Button } from '@quorum/ui';
import { Check, ShieldCheck, ShieldX, X } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { signOutCurrentSession } from '@/server/auth/actions';
import { SessionList, type SessionRow } from './session-list';

export const metadata: Metadata = { title: 'Account — QUORUM' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APPROVAL_LEVELS = [
  TrustLevel.L0_READ,
  TrustLevel.L1_NAV,
  TrustLevel.L2_MUTATE,
  TrustLevel.L3_COMMIT,
  TrustLevel.L4_EXTERNAL,
];

const LEVEL_LABELS: Record<TrustLevel, string> = {
  [TrustLevel.L0_READ]: 'Read the page',
  [TrustLevel.L1_NAV]: 'Navigate and paginate',
  [TrustLevel.L2_MUTATE]: 'Type, select, toggle',
  [TrustLevel.L3_COMMIT]: 'Submit a form',
  [TrustLevel.L4_EXTERNAL]: 'Credentials and payment',
};

export default async function AccountPage() {
  const session = await auth();
  // Middleware already gated this route; re-checking here is defence in depth, because
  // a matcher change is a one-line mistake and this page reads real data.
  if (!session?.user.id) redirect('/signin?callbackUrl=/account');

  const user = session.user;
  const capabilities = capabilitiesFromUser(
    {
      id: user.id,
      orgId: user.orgId,
      email: user.email ?? '',
      name: user.name ?? null,
      image: user.image ?? null,
      role: user.role,
      approvalAuthority: user.approvalAuthority,
      maxApprovalTrustLevel: user.maxApprovalTrustLevel,
      tokenVersion: 0,
    },
    user.orgMaxApprovalTrustLevel,
  );

  const families = await refreshTokenRepository.listActiveFamilies(user.id);
  const sessions: SessionRow[] = families.map((family) => ({
    familyId: family.familyId,
    isCurrent: family.familyId === session.familyId,
    userAgent: family.userAgent,
    ipAddress: family.ipAddress,
    startedAt: family.createdAt.toISOString(),
    expiresAt: family.expiresAt.toISOString(),
  }));

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-12">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium tracking-tight">{user.name ?? user.email}</h1>
          <p className="mt-1 font-mono text-xs text-fg-subtle">{user.email}</p>
        </div>
        <form
          action={async () => {
            'use server';
            await signOutCurrentSession();
          }}
        >
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      {session.error && (
        <p
          role="alert"
          className="mb-8 rounded-[var(--radius-control)] border border-[var(--color-review)]/40 px-3 py-2 text-xs text-review"
        >
          Your session needs refreshing ({session.error}). Sign out and back in to continue.
        </p>
      )}

      <section aria-labelledby="role-heading" className="mb-10">
        <h2 id="role-heading" className="mb-3 text-sm font-medium">
          Role and permissions
        </h2>
        <div className="rounded-[var(--radius-panel)] border border-hairline">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <span className="text-sm text-fg-muted">Role</span>
            <span className="font-mono text-xs uppercase tracking-wide">{user.role}</span>
          </div>
          <ul className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-2">
            {capabilities.permissions.map((permission) => (
              <li key={permission} className="flex items-center gap-2 text-sm text-fg-muted">
                <Check className="size-3.5 shrink-0 text-verified" aria-hidden />
                {describePermission(permission)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="approval-heading" className="mb-10">
        <h2 id="approval-heading" className="mb-1 text-sm font-medium">
          Approval authority
        </h2>
        <p className="mb-3 text-xs leading-relaxed text-fg-muted">
          Approval is tracked separately from what you can read or change. It is the one capability
          whose misuse is legally material, so it is granted by Trust Ladder level rather than
          folded into your role.
        </p>

        <div className="rounded-[var(--radius-panel)] border border-hairline">
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
            {capabilities.canApproveAnything ? (
              <ShieldCheck className="size-4 text-verified" aria-hidden />
            ) : (
              <ShieldX className="size-4 text-review" aria-hidden />
            )}
            <span className="text-sm">
              {capabilities.approvalCeiling === null
                ? 'You cannot approve agent actions'
                : `You can approve up to L${String(capabilities.approvalCeiling)}`}
            </span>
            {user.approvalAuthority !== 'INHERIT' && (
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
                {user.approvalAuthority}
              </span>
            )}
          </div>

          <ul className="divide-y divide-[var(--color-hairline)]">
            {APPROVAL_LEVELS.map((level) => {
              const allowed =
                capabilities.approvalCeiling !== null && level <= capabilities.approvalCeiling;
              const denial = explainApprovalDenial(
                {
                  role: user.role,
                  approvalAuthority: user.approvalAuthority,
                  maxApprovalTrustLevel: user.maxApprovalTrustLevel,
                },
                level,
                { maxApprovalTrustLevel: user.orgMaxApprovalTrustLevel },
              );
              return (
                <li key={level} className="flex items-start gap-3 px-4 py-2.5">
                  {allowed ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-verified" aria-hidden />
                  ) : (
                    <X className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-fg-subtle">L{level}</span>{' '}
                      {LEVEL_LABELS[level]}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {allowed ? TRUST_EXPLANATIONS[level] : denial}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <SessionList sessions={sessions} />
    </div>
  );
}
