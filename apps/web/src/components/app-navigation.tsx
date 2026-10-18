'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const links = [
  { href: '/', label: 'New task' },
  { href: '/runs', label: 'Tasks' },
  { href: '/knowledge', label: 'Documentation Q&A' },
  { href: '/account', label: 'Account' },
];
export function AppNavigation() {
  const path = usePathname();
  const navigation = links.map((link) => (
    <Link
      key={link.href}
      href={link.href}
      aria-current={
        (link.href === '/' ? path === '/' : path.startsWith(link.href)) ? 'page' : undefined
      }
      className="rounded-md px-3 py-2.5 text-sm text-fg-muted hover:bg-raised hover:text-fg aria-[current=page]:bg-raised aria-[current=page]:text-fg"
    >
      {link.label}
    </Link>
  ));
  return (
    <header className="relative z-20 flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-hairline bg-canvas px-5">
      <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-wide">
        <span aria-hidden className="text-action">
          ◆
        </span>{' '}
        QUORUM
      </Link>
      <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
        {navigation}
      </nav>
      <details key={path} className="relative md:hidden">
        <summary className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm">
          Menu
        </summary>
        <nav
          aria-label="Mobile navigation"
          className="absolute right-0 top-12 flex w-60 flex-col rounded-lg border border-hairline bg-canvas p-2 shadow-xl"
        >
          {navigation}
        </nav>
      </details>
    </header>
  );
}
