import * as React from 'react';
import { cn } from '../lib/utils';

/** Keyboard hint. The product is keyboard-first, so shortcuts are shown, not hidden. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--color-hairline)] bg-[var(--color-raised)] px-1.5 font-mono text-[10px] font-medium text-[var(--color-fg-subtle)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
