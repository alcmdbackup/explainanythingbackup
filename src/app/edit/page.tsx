// /edit page (Phase 2 of build_website_for_evolutiOn_20260626).
// Server component — fetches the public strategy whitelist server-side and
// passes them as initial props to the EditForm client child. Avoids the
// loading-flash that mount-on-fetch would produce.

import { listPublicStrategiesAction, type PublicStrategySummary } from '@evolution/services/strategyRegistryActions';
import Navigation from '@/components/Navigation';
import EditForm from './EditForm';
import EditDisabledNotice from './EditDisabledNotice';

export const metadata = {
  title: 'Edit anything — ExplainAnything',
  description: 'Paste an article, pick how it should be improved, see the result side-by-side.',
};

// Force dynamic rendering on every request. Without this, Next.js App Router
// defaults to static rendering: the page is built once at deploy time with
// whatever `listPublicStrategiesAction` returned then, baked into static HTML,
// and served as a static asset regardless of DB state. Admin flips of
// `public_visible` would never appear until a code-triggered redeploy.
// The listPublicStrategiesAction itself has a 60s in-memory cache, so the
// "every request" cost is bounded.
export const dynamic = 'force-dynamic';

export default async function EditPage(): Promise<JSX.Element> {
  // Operational kill switch — if PUBLIC_EDIT_DISABLED=true, show a static
  // "temporarily unavailable" page instead of the form. The action also
  // rejects with 503 as a defense-in-depth backstop.
  if (process.env.PUBLIC_EDIT_DISABLED === 'true') {
    return <EditDisabledNotice />;
  }

  let strategies: PublicStrategySummary[] = [];
  try {
    const result = await listPublicStrategiesAction();
    if (result?.success && result.data) {
      strategies = result.data;
    }
  } catch {
    strategies = [];
  }

  return (
    <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture">
      <Navigation showSearchBar={false} />
      <div className="flex-1 flex items-center justify-center">
        <main id="main-content" className="container mx-auto px-8 max-w-2xl py-12">
          <div className="text-center mb-8">
            <h1 className="atlas-display-section text-[var(--text-primary)] mb-4 atlas-animate-fade-up stagger-1">
              Edit anything
            </h1>
            <p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
              Paste an article. Pick how it should be improved.
              We&apos;ll rewrite it and show you exactly what changed.
            </p>
          </div>
          <div className="atlas-animate-fade-up stagger-3">
            <EditForm initialStrategies={strategies} />
          </div>
          <div className="mt-12 pt-6 border-t border-[var(--border-default)]">
            <p className="atlas-body text-sm text-[var(--text-muted)] text-center">
              Your text and the result are saved so we can improve the system.
              Don&apos;t paste anything sensitive.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
