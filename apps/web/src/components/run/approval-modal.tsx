'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Button, Kbd } from '@quorum/ui';
import { Info, ShieldAlert } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { decideApproval } from '@/server/runs/actions';
import { useRunStore } from '@/stores/run-store';

const LEVEL_NAMES: Record<number, string> = {
  0: 'L0 · read',
  1: 'L1 · navigate',
  2: 'L2 · change something',
  3: 'L3 · irreversible',
  4: 'L4 · credentials or payment',
};

/**
 * The blocking gate.
 *
 * It shows the exact payload, editable, rather than a description of it — approving a
 * described action is theatre, approving a shown one is control. It also states *why* it
 * stopped and at what level: if a person cannot predict when they will be interrupted,
 * interruptions feel arbitrary and they turn them off.
 */
export function ApprovalModal({ runId }: { runId: string }) {
  const approval = useRunStore((state) => state.pendingApproval);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scopeAll, setScopeAll] = useState(false);
  const [payload, setPayload] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!approval?.payload) {
      setPayload({});
      return;
    }
    setPayload(
      Object.fromEntries(
        Object.entries(approval.payload).map(([key, value]) => [key, String(value)]),
      ),
    );
  }, [approval]);

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    if (!approval) return;
    setError(null);
    startTransition(() => {
      void decideApproval(
        runId,
        approval.approvalId,
        decision,
        Object.keys(payload).length > 0 ? payload : null,
        scopeAll ? 'SIMILAR_IN_RUN' : 'SINGLE',
      ).then((result) => {
        if (!result.ok) setError(result.message);
      });
    });
  };

  useEffect(() => {
    if (!approval) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decide('APPROVED');
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') decide('REJECTED');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval, payload, scopeAll]);

  if (!approval) return null;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-hairline bg-overlay p-5 shadow-2xl"
          onEscapeKeyDown={(e) => {
            // The run is blocked on this decision; dismissing it would leave the browser
            // waiting with no way back to the question.
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-review" aria-hidden />
            <Dialog.Title className="text-sm font-medium">Approval required</Dialog.Title>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-fg-subtle">
              {LEVEL_NAMES[approval.trustLevel] ?? `L${String(approval.trustLevel)}`}
            </span>
          </div>

          <Dialog.Description className="mt-3 text-sm leading-relaxed text-fg-muted">
            {approval.reason}
          </Dialog.Description>

          {Object.keys(payload).length > 0 && (
            <div className="mt-4 space-y-2 rounded-[var(--radius-control)] border border-hairline p-3">
              {Object.entries(payload).map(([key, value]) => (
                <label key={key} className="flex items-center gap-3 text-xs">
                  <span className="w-28 shrink-0 text-fg-subtle">{key}</span>
                  <input
                    value={value}
                    onChange={(e) => {
                      setPayload((current) => ({ ...current, [key]: e.target.value }));
                    }}
                    className="flex-1 rounded border border-hairline bg-raised px-2 py-1 font-mono text-xs text-fg outline-none focus:border-[var(--color-action)]/60"
                  />
                </label>
              ))}
            </div>
          )}

          <p className="mt-3 flex gap-2 text-xs leading-relaxed text-fg-subtle">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Why this is gated: actions at this level cannot be undone from our side, so a person
            signs for them.
          </p>

          {error && (
            <p role="alert" className="mt-3 text-xs text-failed">
              {error}
            </p>
          )}

          <label className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={scopeAll}
              onChange={(e) => {
                setScopeAll(e.target.checked);
              }}
            />
            {/* Scoped to this run, never global: blanket permissions are how approval
                systems quietly stop meaning anything. */}
            Auto-approve similar actions for the rest of this run
          </label>

          <div className="mt-5 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                decide('REJECTED');
              }}
            >
              Reject &amp; skip <Kbd>⌘⌫</Kbd>
            </Button>
            <Button
              variant="commit"
              size="md"
              className="ml-auto"
              disabled={pending}
              onClick={() => {
                decide('APPROVED');
              }}
            >
              Approve <Kbd className="border-black/20 bg-black/10 text-black/70">⌘↵</Kbd>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
