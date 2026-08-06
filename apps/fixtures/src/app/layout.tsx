import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QUORUM fixtures',
  description: 'Deterministic pages reproducing the failure modes real sites exhibit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Grammarly and similar extensions inject data-gr-* attributes into body after
          the server HTML lands but before hydration. Not something the app can prevent,
          and scoped to this element only, so real mismatches inside still surface. */}
      <body className="min-h-dvh bg-white text-neutral-900 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
