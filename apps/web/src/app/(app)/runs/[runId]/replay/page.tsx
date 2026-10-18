import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ReplayCanvas } from '@/components/run/replay-canvas';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import { auth } from '@/server/auth';
import type { StreamEvent } from '@/stores/run-store';

export const metadata: Metadata = { title: 'Replay — QUORUM' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunDetail {
  run: { id: string; goal: string };
}

export default async function ReplayPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await auth();
  if (!session?.user.id || !session.accessToken || session.error)
    redirect(`/signin?callbackUrl=/runs/${runId}/replay`);

  try {
    const [detail, history] = await Promise.all([
      apiFetch<RunDetail>(`/v1/runs/${runId}`),
      // Fetched whole on the server: a completed run's log is a few hundred events, and
      // paginating it would make the scrubber lie about the length of what it can show.
      apiFetch<{ events: StreamEvent[] }>(`/v1/runs/${runId}/events?after=0&limit=1000`),
    ]);

    return <ReplayCanvas runId={detail.run.id} goal={detail.run.goal} events={history.events} />;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      redirect(`/signin?callbackUrl=/runs/${runId}/replay`);
    }
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
}
