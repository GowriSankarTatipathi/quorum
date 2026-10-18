'use client';

import { estimateRun, formatDuration, type AutonomyMode } from '@quorum/core';
import { Button, Kbd, cn } from '@quorum/ui';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createRun, readRuntime } from '@/server/runs/actions';

const MODES: { value: AutonomyMode; label: string; hint: string }[] = [
  { value: 'CAREFUL', label: 'Careful', hint: 'Ask before anything that changes the page' },
  { value: 'BALANCED', label: 'Balanced', hint: 'Ask before anything irreversible' },
  { value: 'AUTONOMOUS', label: 'Autonomous', hint: 'Fewest interruptions, same hard limits' },
];

const EXAMPLES = [
  'Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase — plan name, monthly price per user, and what is in the free tier.',
  'Research the top 10 AI accounting startups founded after 2023, with funding raised and headquarters.',
  'Collect the latest published sales-tax nexus thresholds for California, Texas and New York.',
];

export function GoalComposer({ initialGoal = '' }: { initialGoal?: string }) {
  const [goal, setGoal] = useState(initialGoal);
  const [mode, setMode] = useState<AutonomyMode>('BALANCED');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [availability, setAvailability] = useState<'ready' | 'offline' | 'unknown' | 'checking'>(
    'checking',
  );
  const submission = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    if (!initialGoal) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('quorum-task-draft') ?? 'null') as {
          goal?: string;
          mode?: AutonomyMode;
          requestId?: string;
        } | null;
        if (saved?.goal) {
          setGoal(saved.goal);
          if (saved.requestId && saved.mode)
            submission.current = {
              signature: JSON.stringify({ goal: saved.goal, mode: saved.mode }),
              key: saved.requestId,
            };
        }
        if (MODES.some((m) => m.value === saved?.mode)) setMode(saved!.mode!);
      } catch {
        /* Draft storage is optional. */
      }
    }
    let active = true;
    const refresh = () => {
      void readRuntime().then((r) => {
        if (active) setAvailability(r.state);
      });
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initialGoal]);
  function submit() {
    if (pending || goal.trim().length < 12) return;
    const signature = JSON.stringify({ goal: goal.trim(), mode });
    if (submission.current?.signature !== signature)
      submission.current = { signature, key: crypto.randomUUID() };
    const key = submission.current.key;
    try {
      sessionStorage.setItem(
        'quorum-task-draft',
        JSON.stringify({ goal: goal.trim(), mode, requestId: key }),
      );
    } catch {
      /* Optional. */
    }
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createRun(goal.trim(), mode, key);
      } catch {
        setError(
          'The connection was interrupted. Your draft is saved. Try again; the same submission will not create a second task.',
        );
        return;
      }
      if (!result.ok) {
        setError(result.message);
        setSignInRequired(result.signInRequired);
        return;
      }
      try {
        sessionStorage.removeItem('quorum-task-draft');
      } catch {
        /* Optional. */
      }
      router.push(`/runs/${result.id}`);
    });
  }

  const estimate = useMemo(() => estimateRun(goal, mode), [goal, mode]);

  const syncState = () => {
    if (textareaRef.current && textareaRef.current.value !== goal) {
      setGoal(textareaRef.current.value);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="w-full max-w-2xl"
      aria-busy={pending}
    >
      <input type="hidden" name="mode" value={mode} />

      <h1 className="mb-8 text-center text-2xl font-medium tracking-tight text-fg">
        Turn a research task into evidence
      </h1>

      <p className="-mt-4 mb-6 text-center text-base leading-relaxed text-fg-muted">
        Describe the websites and information you need. Review a plan, watch the agents work, then
        inspect and export the results.
      </p>
      <p
        role="status"
        className="mb-4 rounded-lg border border-hairline px-4 py-3 text-sm text-fg-muted"
      >
        {availability === 'ready'
          ? 'Agents are available. Your task will start with a plan for your approval.'
          : availability === 'offline'
            ? 'No worker is available. You can save a task to the queue; planning starts when a worker reconnects.'
            : availability === 'checking'
              ? 'Checking worker availability…'
              : 'Worker availability could not be checked. You can save a task; it will wait in the queue until a worker is available.'}
      </p>
      <div className="rounded-[var(--radius-panel)] border border-hairline bg-raised transition-colors focus-within:border-[var(--color-action)]/50">
        <label htmlFor="goal" className="sr-only">
          Describe the task in plain English
        </label>
        <textarea
          id="goal"
          name="goal"
          ref={textareaRef}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={syncState}
          onKeyDown={(e) => {
            syncState();
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (textareaRef.current && textareaRef.current.value.trim().length >= 12) {
                textareaRef.current.form?.requestSubmit();
              }
            }
          }}
          minLength={12}
          maxLength={4000}
          disabled={pending}
          required
          rows={4}
          placeholder="Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase…"
          className="w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-3 py-2.5">
          <div className="flex items-center gap-1" role="group" aria-label="Autonomy mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                disabled={pending}
                title={m.hint}
                onClick={() => setMode(m.value)}
                className={cn(
                  'rounded-[var(--radius-control)] min-h-11 px-2.5 py-2 text-sm transition-colors duration-150',
                  mode === m.value ? 'bg-overlay text-fg' : 'text-fg-subtle hover:text-fg-muted',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
            <span
              className="font-mono text-xs text-fg-subtle tabular-nums"
              aria-live="polite"
              aria-label={
                estimate.estimatedUsd > 0
                  ? `Estimated cost ${estimate.estimatedUsd.toFixed(2)} dollars, about ${formatDuration(estimate.estimatedSeconds)}`
                  : 'No estimate yet'
              }
            >
              {estimate.estimatedUsd > 0
                ? `${estimate.isRough ? '≈' : '~'}$${estimate.estimatedUsd.toFixed(2)} · ${formatDuration(estimate.estimatedSeconds)}`
                : '—'}
            </span>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pending || goal.trim().length < 12}
              onClick={syncState}
            >
              {pending ? 'Creating plan…' : 'Create plan'}
              <Kbd className="border-white/25 bg-white/10 text-white/80">⌘↵</Kbd>
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-review p-4 text-sm">
          <p>{error}</p>
          {signInRequired && (
            <Link className="mt-2 inline-block underline" href="/signin?callbackUrl=%2Fruns%2Fnew">
              Sign in and return to your saved draft
            </Link>
          )}
        </div>
      )}
      <p className="mt-3 text-center text-sm text-fg-muted">
        {MODES.find((m) => m.value === mode)?.hint}. Creating a plan uses model credits.
      </p>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
        <ShieldCheck className="size-3.5 text-verified" aria-hidden />
        Nothing irreversible happens without your approval — in every mode.
      </p>

      <p className="mt-4 text-center text-sm text-fg-muted">
        Looking for product help?{' '}
        <Link href="/knowledge" className="text-fg underline">
          Ask the documentation
        </Link>
        .
      </p>
      <div className="mt-8">
        <p className="mb-3 text-xs uppercase tracking-wider text-fg-subtle">Try</p>
        <ul className="space-y-1.5">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setGoal(example);
                  textareaRef.current?.focus();
                }}
                className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
