import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scout — ingredient check',
  description:
    'Check whether a nearby restaurant or grocery product contains ingredients you avoid — and what to order instead.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2B3440',
};

const NAV = [
  { href: '/', label: 'Nearby' },
  { href: '/scan', label: 'Scan' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@600;700&family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:bg-slate-ink focus:px-3 focus:py-2 focus:text-bone"
        >
          Skip to content
        </a>

        <header className="border-b-2 border-slate-ink">
          <div className="mx-auto flex max-w-field items-baseline justify-between px-4 py-3">
            <Link href="/" className="font-display text-2xl uppercase tracking-[0.18em]">
              Scout
            </Link>
            <span className="label-caps text-slate-muted">Ingredient check</span>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-field px-4 py-5">
          {children}
        </main>

        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-slate-ink bg-bone"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ul className="mx-auto flex max-w-field">
            {NAV.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className="label-caps block px-2 py-4 text-center hover:bg-slate-ink hover:text-bone"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </body>
    </html>
  );
}
