// /edit/runs/[runId] page (Phase 2 of build_website_for_evolutiOn_20260626).
// Server component for SEO meta + privacy headers; delegates the polling +
// diff rendering to a client child.
//
// Privacy headers (defense-in-depth against URL-leak via referrer / browser-history
// sync to Google/iCloud / URL-shorteners): set via generateMetadata's noindex/nofollow
// + dynamic headers() returning Referrer-Policy: no-referrer + Cache-Control: private,
// no-store. UUIDs are unguessable, but these reduce the blast radius if a URL leaks.

import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import EditRunViewer from './EditRunViewer';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ runId: string }>;
}): Promise<Metadata> {
  const { runId } = await params;
  return {
    title: 'Result — ExplainAnything Edit',
    description: 'Your evolved text with a side-by-side diff against the original.',
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
    other: {
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
    alternates: {
      canonical: `/edit/runs/${runId}`,
    },
  };
}

export default async function EditRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture">
      <Navigation showSearchBar={false} />
      <main className="container mx-auto px-8 max-w-5xl py-8">
        <div className="mb-6">
          <a href="/edit" className="atlas-ui text-sm text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors">
            ← Edit another
          </a>
        </div>
        <EditRunViewer runId={runId} />
        <div className="mt-12 pt-6 border-t border-[var(--border-default)]">
          <p className="atlas-body text-sm text-[var(--text-muted)] text-center">
            Your text and the result are saved so we can improve the system.
            Don&apos;t paste anything sensitive.
          </p>
        </div>
      </main>
    </div>
  );
}
