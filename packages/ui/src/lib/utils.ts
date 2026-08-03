import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, resolving Tailwind conflicts so a caller-supplied
 * `className` reliably overrides a component's defaults instead of losing to
 * stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
