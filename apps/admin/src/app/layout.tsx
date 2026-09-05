import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'QUEST Admin', template: '%s · QUEST Admin' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <a href="#main" className="q-sr-only">
          Skip to content
        </a>
        <header className="q-header">
          <Link href="/" className="q-brand" aria-label="QUEST admin home">
            QUEST · Admin
          </Link>
          <nav className="q-nav" aria-label="Primary">
            <Link href="/">Overview</Link>
          </nav>
        </header>
        <main id="main" className="q-container">
          {children}
        </main>
      </body>
    </html>
  );
}
