'use client';

import { estimateRun, formatDuration, type AutonomyMode } from '@quorum/core';
import { Button, Kbd, cn } from '@quorum/ui';
import { ArrowRight, Mic, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

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

export function GoalComposer() {
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<AutonomyMode>('BALANCED');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Estimated before commitment, computed locally, with no LLM call — a number the
  // user sees while deciding is worth more than a precise one they see afterwards.
  const estimate = useMemo(() => estimateRun(goal, mode), [goal, mode]);
  const ready = goal.trim().length > 12;

  const submit = () => {
    if (!ready) return;
    // Creation happens on the server so the API access token never reaches the browser.
    window.location.assign(`/runs/new?goal=${encodeURIComponent(goal)}&mode=${mode}`);
  };

  return (
    <div className="w-full max-w-2xl">
      <h1 className="mb-8 text-center text-2xl font-medium tracking-tight text-fg">
        What should the agents do?
      </h1>

      <div className="rounded-[var(--radius-panel)] border border-hairline bg-raised transition-colors focus-within:border-[var(--color-action)]/50">
        <label htmlFor="goal" className="sr-only">
          Describe the task in plain English
        </label>
        <textarea
          id="goal"
          ref={textareaRef}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          rows={4}
          placeholder="Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase…"
          className="w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-3 py-2.5">
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Autonomy mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                title={m.hint}
                onClick={() => setMode(m.value)}
                className={cn(
                  'rounded-[var(--radius-control)] px-2.5 py-1 text-xs transition-colors duration-150',
                  mode === m.value ? 'bg-overlay text-fg' : 'text-fg-subtle hover:text-fg-muted',
                )}
              >
                {m.label}
              </button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              className="ml-1"
              aria-label="Dictate the goal"
              title="Dictate the goal"
            >
              <Mic aria-hidden />
            </Button>
          </div>

          <div className="flex items-center gap-3">
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
            <Button variant="primary" size="sm" onClick={submit} disabled={!ready}>
              Plan
              <Kbd className="border-white/25 bg-white/10 text-white/80">⌘↵</Kbd>
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
        <ShieldCheck className="size-3.5 text-verified" aria-hidden />
        Nothing irreversible happens without your approval — in every mode.
      </p>

      <div className="mt-10">
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
    </div>
  );
}
