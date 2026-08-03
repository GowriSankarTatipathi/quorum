import { Button } from '@quorum/ui';
import Link from 'next/link';
import { GoalComposer } from '@/components/goal-composer';

/**
 * The empty state is one centred input, not a dashboard. An empty dashboard with a
 * dozen zeroed KPI cards is the most common way a product signals "you have not done
 * anything valuable yet"; the first-run job is to get one sentence typed, and every
 * pixel not helping with that is hurting.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-5">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-sm text-[var(--color-action)]">
            ◆
          </span>
          <span className="text-sm font-semibold tracking-wide">QUORUM</span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">Runs</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/recipes">Recipes</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/usage">Usage</Link>
          </Button>
        </nav>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-5 py-16">
        <GoalComposer />
      </main>

      <footer className="shrink-0 border-t border-hairline px-5 py-3 text-center font-mono text-[11px] text-fg-subtle">
        seven agents · claim-level provenance · human approval gates
      </footer>
    </div>
  );
}
