import { AppNavigation } from '@/components/app-navigation';
import { GoalComposer } from '@/components/goal-composer';
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNavigation />
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-12 sm:py-20">
        <GoalComposer />
      </main>
      <footer className="border-t border-hairline px-5 py-4 text-center text-xs text-fg-muted">
        Research with evidence. Review the plan before agents browse.
      </footer>
    </div>
  );
}
