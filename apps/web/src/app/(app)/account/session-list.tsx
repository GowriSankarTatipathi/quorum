'use client';

import { Button, cn } from '@quorum/ui';
import { Loader2, LogOut, Monitor } from 'lucide-react';
import { useState, useTransition } from 'react';
import { revokeAllSessions, revokeSession } from '@/server/auth/actions';

export interface SessionRow {
  familyId: string;
  isCurrent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  startedAt: string;
  expiresAt: string;
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = (familyId: string) => {
    setBusyId(familyId);
    setError(null);
    startTransition(() => {
      void revokeSession(familyId).then((result) => {
        if (!result.ok) setError(result.message);
        setBusyId(null);
      });
    });
  };

  return (
    <section aria-labelledby="sessions-heading">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 id="sessions-heading" className="text-sm font-medium">
            Active sessions
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            Each device holds its own token family. Signing one out leaves the others alone.
          </p>
        </div>
        <form
          action={async () => {
            await revokeAllSessions();
          }}
        >
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            <LogOut aria-hidden />
            Sign out everywhere
          </Button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-xs text-failed">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[var(--color-hairline)] rounded-[var(--radius-panel)] border border-hairline">
        {sessions.map((session) => (
          <li key={session.familyId} className="flex items-center gap-3 px-4 py-3">
            <Monitor className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {describeClient(session.userAgent)}
                {session.isCurrent && (
                  <span className="ml-2 rounded border border-[var(--color-verified)]/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-verified">
                    this device
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                {session.ipAddress ?? 'unknown address'} · started{' '}
                {new Date(session.startedAt).toLocaleString()}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                revoke(session.familyId);
              }}
              disabled={pending && busyId === session.familyId}
              className={cn(busyId === session.familyId && 'opacity-60')}
            >
              {pending && busyId === session.familyId ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              {session.isCurrent ? 'Sign out' : 'Revoke'}
            </Button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-fg-subtle">
            No other active sessions.
          </li>
        )}
      </ul>
    </section>
  );
}

/** User-agent strings are unreadable; this yields something a person can recognise. */
function describeClient(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Firefox\//.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const platform = /Macintosh/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
      ? 'Windows'
      : /Linux/.test(userAgent)
        ? 'Linux'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Android/.test(userAgent)
            ? 'Android'
            : 'Unknown platform';
  return `${browser} on ${platform}`;
}
