import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QUORUM — browser agents that never act alone',
  description:
    'Delegate browser research and data entry to a team of AI agents, watch them work, approve anything consequential, and export results you can trace back to the source.',
  applicationName: 'QUORUM',
};

export const viewport: Viewport = {
  themeColor: '#0A0A0B',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark by default: the primary screen is a browser viewport (mostly white)
    // surrounded by chrome, and a dark surround makes the page the visual subject.
    <html lang="en" className="dark" suppressHydrationWarning>
      {/* Extensions such as Grammarly inject data-gr-* attributes into html and body
          after the server HTML lands but before hydration. The app cannot prevent it,
          and the suppression is scoped to these two elements only — real mismatches
          anywhere inside the tree still surface. */}
      <body className="min-h-dvh bg-base text-fg antialiased" suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-overlay)] focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
