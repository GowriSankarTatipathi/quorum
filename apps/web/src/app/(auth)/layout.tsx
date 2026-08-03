import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center px-5">
        <Link href="/" className="flex items-center gap-2">
          <span aria-hidden className="text-sm text-[var(--color-action)]">
            ◆
          </span>
          <span className="text-sm font-semibold tracking-wide">QUORUM</span>
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
