import { AUTONOMY_MODES, type AutonomyMode } from '@quorum/core';
import { redirect } from 'next/navigation';
import { createRun } from '@/server/runs/actions';
import { auth } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isMode = (value: string): value is AutonomyMode =>
  (AUTONOMY_MODES as readonly string[]).includes(value);

/**
 * The bridge from the goal composer to a run.
 *
 * Creation happens on the server so the access token never reaches the browser, and the
 * page immediately redirects to the run — there is no intermediate state worth rendering.
 */
export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const params = await searchParams;
  const goal = typeof params.goal === 'string' ? params.goal : '';
  const rawMode = typeof params.mode === 'string' ? params.mode : 'BALANCED';

  if (!session?.user.id) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/runs/new?goal=${encodeURIComponent(goal)}`)}`,
    );
  }
  if (goal.trim().length < 12) redirect('/');

  await createRun(goal, isMode(rawMode) ? rawMode : 'BALANCED');
  return null;
}
