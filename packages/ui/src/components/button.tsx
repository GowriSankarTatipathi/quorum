import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Variants are semantic, not decorative. `commit` exists so that a control which
 * performs an irreversible action (Trust Ladder L3+) never renders identically to an
 * ordinary primary button — the visual weight of a control should match the weight of
 * what it does.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-action)] text-white hover:brightness-95',
        secondary:
          'bg-[var(--color-raised)] text-[var(--color-fg)] border border-[var(--color-hairline)] hover:bg-[var(--color-overlay)]',
        ghost:
          'text-[var(--color-fg-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-fg)]',
        commit: 'bg-[var(--color-review)] text-black font-semibold hover:brightness-110',
        danger: 'bg-[var(--color-failed)] text-white hover:brightness-110',
        link: 'text-[var(--color-action)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'min-h-11 px-3 text-sm sm:min-h-9',
        md: 'min-h-11 px-3.5',
        lg: 'h-11 px-5 text-base',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a Next.js `<Link>`) while keeping button styles. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      // Buttons inside a form default to `submit`, which is exactly the accidental
      // irreversible action this product exists to prevent.
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    />
  );
});

export { buttonVariants };
