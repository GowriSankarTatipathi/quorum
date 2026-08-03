import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QUORUM fixtures',
  description: 'Deterministic pages reproducing the failure modes real sites exhibit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
