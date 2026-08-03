import { Button } from '@quorum/ui';
import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-5">
        <Link href="/" className="flex items-center gap-2">
          <span aria-hidden className="text-sm text-[var(--color-action)]">
            ◆
          </span>
          <span className="text-sm font-semibold tracking-wide">QUORUM</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/account">Account</Link>
          </Button>
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
