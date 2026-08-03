'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/api-client';

export interface RunActionResult {
  ok: boolean;
  message: string;
}

interface CreatedRun {
  id: string;
}

export async function createRun(goal: string, mode: string): Promise<void> {
  const run = await apiFetch<CreatedRun>('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ goal, mode }),
  });
  redirect(`/runs/${run.id}`);
}

/**
 * Approve a plan, bound to the hash of what was rendered.
 *
 * If the plan changed between render and click the API refuses, which closes the gap in
 * which someone approves a plan they never read.
 */
export async function approvePlan(runId: string, planHash: string): Promise<RunActionResult> {
  try {
    await apiFetch(`/v1/runs/${runId}/plan/approve`, {
      method: 'POST',
      body: JSON.stringify({ planHash }),
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, message: 'Running.' };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function controlRun(
  runId: string,
  action: 'pause' | 'resume' | 'stop',
): Promise<RunActionResult> {
  try {
    await apiFetch(`/v1/runs/${runId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, message: `Run ${action}d.` };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function raiseBudget(runId: string, additionalUsd: number): Promise<RunActionResult> {
  try {
    await apiFetch(`/v1/runs/${runId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'raise_budget', additionalUsd }),
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, message: 'Budget raised.' };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function decideApproval(
  runId: string,
  approvalId: string,
  decision: 'APPROVED' | 'REJECTED',
  editedPayload: Record<string, unknown> | null,
  scope: 'SINGLE' | 'SIMILAR_IN_RUN',
): Promise<RunActionResult> {
  try {
    await apiFetch(`/v1/approvals/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, editedPayload, scope, runId }),
    });
    return { ok: true, message: decision === 'APPROVED' ? 'Approved.' : 'Skipped.' };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** API errors already carry a sentence written for a person; anything else gets a generic
 *  one rather than leaking an internal message into the interface. */
function describe(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'Something went wrong. Try again.';
}

export async function requestExport(
  runId: string,
  format: 'xlsx' | 'csv' | 'json',
): Promise<RunActionResult> {
  try {
    await apiFetch(`/v1/runs/${runId}/export`, {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
    return { ok: true, message: 'Building your export…' };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Returns a short-lived signed URL, or a sentence explaining why there isn't one yet. */
export async function getExportUrl(
  runId: string,
  format: 'xlsx' | 'csv' | 'json',
): Promise<{ ok: true; url: string; filename: string } | RunActionResult> {
  try {
    const result = await apiFetch<{ url: string; filename: string }>(
      `/v1/runs/${runId}/export?format=${format}`,
    );
    return { ok: true, url: result.url, filename: result.filename };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}
