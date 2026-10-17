'use client';

import { Button } from '@quorum/ui';
import { ArrowUp, BookOpen, Loader2, ShieldCheck } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { askKnowledge, type KnowledgeAnswer } from '@/server/knowledge/actions';

interface ConversationTurn {
  question: string;
  answer: string;
  abstained: boolean;
  sources: KnowledgeAnswer['sources'];
  toolsUsed: string[];
}

const EXAMPLES = [
  'How does QUORUM stop an agent from submitting a form without approval?',
  'How are extracted claims checked against the page?',
  'Which services make up the QUORUM architecture?',
];

export function KnowledgeAssistant() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submitQuestion(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 3 || pending) return;

    setError(null);
    startTransition(async () => {
      const response = await askKnowledge(trimmed);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setTurns((current) => [
        ...current,
        {
          question: trimmed,
          answer: response.result.answer,
          abstained: response.result.abstained,
          sources: response.result.sources,
          toolsUsed: response.result.toolsUsed,
        },
      ]);
      setQuestion('');
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-8">
        <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-fg-subtle">
          <BookOpen className="size-3.5" aria-hidden />
          Product documentation
        </p>
        <h1 className="text-2xl font-medium tracking-tight">Ask QUORUM</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
          Ask how the product works. Answers use the curated QUORUM docs, cite their sources, and
          say when the docs do not support an answer.
        </p>
      </header>

      <div className="mb-5 space-y-4" aria-live="polite" aria-relevant="additions">
        {turns.map((turn, index) => (
          <article
            key={`${index}-${turn.question}`}
            className="space-y-3 rounded-[var(--radius-panel)] border border-hairline p-4"
          >
            <h2 className="text-sm font-medium">{turn.question}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
              {turn.answer}
            </p>
            {turn.sources.length > 0 && (
              <details className="border-t border-hairline pt-3">
                <summary className="cursor-pointer text-xs text-fg-subtle">
                  Sources ({turn.sources.length}) · tool: {turn.toolsUsed.join(', ')}
                </summary>
                <ul className="mt-3 space-y-3">
                  {turn.sources.map((source) => (
                    <li
                      key={source.id}
                      className="rounded-[var(--radius-control)] bg-raised px-3 py-2.5"
                    >
                      <p className="text-xs font-medium">
                        [{source.id}] {source.title}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-fg-subtle">{source.path}</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">
                        {source.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {turn.abstained && (
              <p className="border-t border-hairline pt-2 text-xs text-review">
                No supported documentation answer was available.
              </p>
            )}
          </article>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-xs text-failed">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitQuestion(question);
        }}
        className="rounded-[var(--radius-panel)] border border-hairline bg-raised focus-within:border-[var(--color-action)]/50"
      >
        <label htmlFor="knowledge-question" className="sr-only">
          Ask a question about QUORUM
        </label>
        <textarea
          ref={inputRef}
          id="knowledge-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submitQuestion(question);
            }
          }}
          maxLength={1_000}
          rows={3}
          placeholder="Ask about runs, claims, approvals, or architecture…"
          className="w-full resize-y bg-transparent px-4 py-3.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <ShieldCheck className="size-3.5 text-verified" aria-hidden />
            QUORUM docs only · don’t include confidential data
          </span>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={pending || question.trim().length < 3}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
            {pending ? 'Searching' : 'Ask'}
          </Button>
        </div>
      </form>

      {turns.length === 0 && (
        <div className="mt-8">
          <p className="mb-2 text-xs uppercase tracking-wider text-fg-subtle">Try asking</p>
          <ul className="space-y-1">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(example);
                    inputRef.current?.focus();
                  }}
                  className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-raised hover:text-fg"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
