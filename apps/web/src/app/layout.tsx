import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'QUEST', template: '%s · QUEST' },
  description: "Social media where you don't just watch life — you do something.",
  robots: { index: false, follow: false }, // pre-launch shell
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <a href="#main" className="q-sr-only">
          Skip to content
        </a>
        <header className="q-header">
          <Link href="/" className="q-brand" aria-label="QUEST home">
            QUEST
          </Link>
          <nav className="q-nav" aria-label="Primary">
            <Link href="/status">Status</Link>
          </nav>
        </header>
        <main id="main" className="q-container">
          {children}
        </main>
      </body>
    </html>
  );
}
