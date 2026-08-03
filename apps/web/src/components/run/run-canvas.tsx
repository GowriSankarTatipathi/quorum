'use client';

import { Button } from '@quorum/ui';
import { Download, History, Loader2, Pause, Play, Square } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { elapsedSince, formatTokens, formatUsd } from '@/lib/format';
import { useRunStream } from '@/hooks/use-run-stream';
import { controlRun, getExportUrl, requestExport } from '@/server/runs/actions';
import { useRunStore, type StepView } from '@/stores/run-store';
import { AgentStatusStrip } from './agent-status-strip';
import { AgentStream } from './agent-stream';
import { ApprovalModal } from './approval-modal';
import { BrowserViewport } from './browser-viewport';
import { ClaimsTable } from './claims-table';
import { EventLog } from './event-log';
import { PlanReview } from './plan-review';

export interface RunCanvasProps {
  runId: string;
  accessToken: string | null;
  initialStatus: string;
  initialSteps: StepView[];
  planHash: string | null;
  goal: string;
  startedAt: string | null;
}

/**
 * The main screen.
 *
 * Split down the middle: intent on the left, reality on the right. Everything else is
 * subordinate to keeping those two visible simultaneously, because the question the user
 * is really asking — is it doing what it says? — can only be answered by seeing both.
 */
export function RunCanvas(props: RunCanvasProps) {
  /**
   * Narrow selectors, not the whole store.
   *
   * Subscribing to the store object re-rendered this component — and therefore the entire
   * split screen — on every one of the 20–40 events a second a fast agent emits. Each
   * panel already subscribes to exactly what it draws, so the shell only needs the
   * handful of values in its own header.
   */
  const storeStatus = useRunStore((state) => state.status);
  const steps = useRunStore((state) => state.steps);
  const spentUsd = useRunStore((state) => state.spentUsd);
  const inputTokens = useRunStore((state) => state.inputTokens);
  const outputTokens = useRunStore((state) => state.outputTokens);
  const reset = useRunStore((state) => state.reset);
  const hydrateSteps = useRunStore((state) => state.hydrateSteps);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    reset(props.runId);
    hydrateSteps(props.initialSteps);
    // Intentionally run once per run id: the store is a projection of the stream, and
    // re-seeding it on every render would discard live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runId]);

  useRunStream(props.runId, props.accessToken);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const status = storeStatus === 'CREATED' ? props.initialStatus : storeStatus;
  const planSteps = steps.size > 0 ? [...steps.values()] : props.initialSteps;
  const running = ['EXECUTING', 'VERIFYING', 'RECOVERING', 'CRITIQUE'].includes(status);

  /**
   * Request, then fetch the link. The workbook is built in the worker, so the button
   * reflects that honestly rather than pretending the file already exists.
   */
  const exportRun = () => {
    setExporting(true);
    setNotice(null);
    void requestExport(props.runId, 'xlsx').then(async (queued) => {
      if (!queued.ok) {
        setNotice(queued.message);
        setExporting(false);
        return;
      }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const result = await getExportUrl(props.runId, 'xlsx');
        if ('url' in result) {
          window.location.assign(result.url);
          setExporting(false);
          return;
        }
      }
      setNotice('The export is taking longer than expected. Try again in a moment.');
      setExporting(false);
    });
  };

  const control = (action: 'pause' | 'resume' | 'stop') => {
    startTransition(() => {
      void controlRun(props.runId, action);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      // Space is the emergency brake, and an emergency brake must be reachable without
      // aiming.
      if (e.code === 'Space' && running) {
        e.preventDefault();
        control('pause');
      }
      if (e.code === 'Space' && status === 'PAUSED') {
        e.preventDefault();
        control('resume');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        control('stop');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, status]);

  if (status === 'AWAITING_APPROVAL' && props.planHash) {
    return <PlanReview runId={props.runId} planHash={props.planHash} steps={planSteps} />;
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-5 py-2.5">
        <p className="truncate text-sm" title={props.goal}>
          {props.goal}
        </p>
        <p className="ml-auto flex items-center gap-3 font-mono text-[11px] tabular-nums text-fg-subtle">
          <span className="uppercase">{status.toLowerCase().replace('_', ' ')}</span>
          <span>{elapsedSince(props.startedAt, now)}</span>
          <span>{formatTokens(inputTokens + outputTokens)} tok</span>
          <span>{formatUsd(spentUsd)}</span>
        </p>
        <div className="flex items-center gap-1">
          {status === 'PAUSED' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                control('resume');
              }}
            >
              <Play aria-hidden /> Resume
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || !running}
              onClick={() => {
                control('pause');
              }}
            >
              <Pause aria-hidden /> Pause
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              control('stop');
            }}
          >
            <Square aria-hidden /> Stop
          </Button>
          <Button variant="ghost" size="sm" onClick={exportRun} disabled={exporting}>
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            Export
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/runs/${props.runId}/replay`}>
              <History aria-hidden /> Replay
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[55%_45%]">
        <div className="flex min-h-0 flex-col border-r border-hairline">
          <div className="min-h-0 flex-1 overflow-auto">
            <AgentStream />
          </div>
          <div className="h-48 shrink-0">
            <EventLog />
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3 p-3">
          <div className="min-h-0 flex-1">
            <BrowserViewport />
          </div>
          <div className="min-h-0 max-h-[45%] overflow-hidden rounded-[var(--radius-panel)] border border-hairline">
            <ClaimsTable />
          </div>
          <div className="shrink-0 px-1">
            <AgentStatusStrip />
          </div>
        </div>
      </div>

      {notice && (
        <p role="status" className="border-t border-hairline px-5 py-2 text-xs text-review">
          {notice}
        </p>
      )}

      {notice && (
        <p role="status" className="border-t border-hairline px-5 py-2 text-xs text-review">
          {notice}
        </p>
      )}

      <ApprovalModal runId={props.runId} />
    </div>
  );
}
