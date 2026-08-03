import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { RunCanvas } from '@/components/run/run-canvas';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import { auth } from '@/server/auth';
import type { StepView } from '@/stores/run-store';

export const metadata: Metadata = { title: 'Run — QUORUM' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunDetail {
  run: {
    id: string;
    goal: string;
    status: string;
    planHash: string | null;
    startedAt: string | null;
  };
  steps: StepView[];
}

/**
 * Server-rendered shell around one live client island.
 *
 * The frame and every already-completed step paint immediately with real content while the
 * island attaches its WebSocket. Refreshing mid-run therefore shows a populated run rather
 * than a spinner — which matters enormously, because the user refreshing is usually a user
 * anxious about whether their work survived.
 */
export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await auth();
  if (!session?.user.id) redirect(`/signin?callbackUrl=/runs/${runId}`);

  let detail: RunDetail;
  try {
    detail = await apiFetch<RunDetail>(`/v1/runs/${runId}`);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  return (
    <RunCanvas
      runId={detail.run.id}
      // The access token stays server-side for API calls, but the WebSocket handshake
      // cannot carry headers, so this one short-lived token reaches the client.
      accessToken={session.accessToken ?? null}
      initialStatus={detail.run.status}
      initialSteps={detail.steps}
      planHash={detail.run.planHash}
      goal={detail.run.goal}
      startedAt={detail.run.startedAt}
    />
  );
}
