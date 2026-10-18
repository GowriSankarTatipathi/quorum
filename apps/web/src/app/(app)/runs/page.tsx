import { Button } from '@quorum/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatUsd } from '@/lib/format';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import { auth } from '@/server/auth';

export const metadata: Metadata = { title: 'Runs — QUORUM' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunSummary {
  id: string;
  goal: string;
  status: string;
  spentUsd: number;
  createdAt: string;
}

const STATUS_COLOUR: Record<string, string> = {
  COMPLETED: 'text-verified',
  FAILED: 'text-failed',
  CANCELLED: 'text-fg-subtle',
  PAUSED: 'text-review',
  AWAITING_APPROVAL: 'text-review',
};

export default async function RunsPage() {
  const session = await auth();
  if (!session?.user.id || !session.accessToken || session.error)
    redirect('/signin?callbackUrl=/runs');

  let runs: RunSummary[];
  try {
    ({ runs } = await apiFetch<{ runs: RunSummary[] }>('/v1/runs?limit=50'));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      redirect('/signin?callbackUrl=/runs');
    }
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight">Runs</h1>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/">New run</Link>
        </Button>
      </header>

      {runs.length === 0 ? (
        <p className="rounded-[var(--radius-panel)] border border-hairline px-4 py-10 text-center text-sm text-fg-subtle">
          No runs yet. Describe a task on the home page to start one.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] rounded-[var(--radius-panel)] border border-hairline">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{run.goal}</span>
                <span
                  className={`shrink-0 font-mono text-[11px] uppercase ${STATUS_COLOUR[run.status] ?? 'text-fg-subtle'}`}
                >
                  {run.status === 'COMPLETED'
                    ? 'finished · review results'
                    : run.status === 'CREATED'
                      ? 'queued'
                      : run.status.toLowerCase().replaceAll('_', ' ')}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
                  {formatUsd(run.spentUsd)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
