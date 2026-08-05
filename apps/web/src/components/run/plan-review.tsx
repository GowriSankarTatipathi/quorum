'use client';

import { Button, Kbd, cn } from '@quorum/ui';
import { AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { formatUsd } from '@/lib/format';
import { approvePlan } from '@/server/runs/actions';
import type { StepView } from '@/stores/run-store';

const RISK_STYLE: Record<string, string> = {
  LOW: 'text-fg-subtle',
  MEDIUM: 'text-review',
  HIGH: 'text-failed',
};

/**
 * The plan as a document, not a chat message.
 *
 * You approve documents; you skim chat. Numbered steps, declared output shapes and per-step
 * risk make the review a deliberate act — and this is the cheapest place in the whole
 * product to correct an agent, before it has spent ninety seconds acting on a
 * misunderstanding.
 */
export function PlanReview({
  runId,
  planHash,
  steps,
}: {
  runId: string;
  planHash: string;
  steps: StepView[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const totalUsd = steps.reduce((sum, step) => sum + (step.estimatedUsd ?? 0), 0);
  const totalMs = steps.reduce((sum, step) => sum + (step.estimatedMs ?? 0), 0);
  const irreversible = steps.filter((step) => step.riskLevel === 'HIGH');
  const medium = steps.filter((step) => step.riskLevel === 'MEDIUM');

  const approve = useCallback(() => {
    setError(null);
    startTransition(() => {
      void approvePlan(runId, planHash).then((result) => {
        if (!result.ok) setError(result.message);
      });
    });
  }, [runId, planHash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') approve();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [approve]);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-sm font-medium uppercase tracking-wide text-fg-muted">Plan</h1>
        <p className="font-mono text-xs text-fg-subtle">
          {steps.length} steps · ~{Math.round(totalMs / 1000)}s · ~{formatUsd(totalUsd)}
        </p>
      </header>

      <ol className="space-y-0">
        {steps.map((step) => (
          <li key={step.index} className="relative pl-12">
            <span className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-hairline font-mono text-[11px] text-fg-subtle">
              {String(step.index + 1).padStart(2, '0')}
            </span>
            <div className="border-b border-hairline pb-4 pt-1.5">
              <p className="text-sm">{step.objective}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
                <span>⬡ {step.agentPath.join(' → ')}</span>
                {step.estimatedMs !== null && <span>~{Math.round(step.estimatedMs / 1000)}s</span>}
                {step.estimatedUsd !== null && <span>~{formatUsd(step.estimatedUsd)}</span>}
                <span className={cn(RISK_STYLE[step.riskLevel])}>
                  {step.riskLevel === 'HIGH'
                    ? '⚠ needs your signature'
                    : `○ ${step.riskLevel.toLowerCase()}`}
                </span>
              </p>
              {step.targetUrl && (
                <p className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
                  {step.targetUrl}
                </p>
              )}
              {step.notes && (
                // The Planner predicting its own difficulties reads as competence; hitting
                // them silently reads as fragility.
                <p className="mt-1.5 flex gap-1.5 text-xs text-fg-muted">
                  <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {step.notes}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex items-start gap-2 text-xs leading-relaxed">
        {irreversible.length > 0 ? (
          <>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-review" aria-hidden />
            <p className="text-review">
              {medium.length > 0 &&
                `${String(medium.length)} medium-risk step${medium.length === 1 ? '' : 's'}. `}
              {/* The one sentence that lets a cautious user click Approve: the fear is not
                  "will it be slow", it is "will it do something I cannot take back". */}
              Step{irreversible.length === 1 ? '' : 's'}{' '}
              {irreversible.map((step) => String(step.index + 1)).join(', ')} may submit data — I
              will stop and ask before that happens. Nothing else here is irreversible.
            </p>
          </>
        ) : (
          <>
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-verified" aria-hidden />
            <p className="text-fg-muted">
              {medium.length > 0 &&
                `${String(medium.length)} medium-risk step${medium.length === 1 ? '' : 's'}. `}
              No irreversible actions in this plan.
            </p>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs text-failed">
          {error}
        </p>
      )}

      <form
        action={async () => {
          const result = await approvePlan(runId, planHash);
          if (!result.ok) setError(result.message);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await approvePlan(runId, planHash);
            if (!result.ok) setError(result.message);
          });
        }}
        className="mt-6 flex items-center gap-2"
      >
        <p className="font-mono text-[10px] text-fg-subtle">plan {planHash.slice(0, 12)}</p>
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="ml-auto"
          disabled={pending}
        >
          Approve &amp; run
          <Kbd className="border-white/25 bg-white/10 text-white/80">⌘↵</Kbd>
        </Button>
      </form>
    </div>
  );
}
