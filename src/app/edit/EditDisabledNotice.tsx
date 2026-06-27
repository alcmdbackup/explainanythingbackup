// Renders when PUBLIC_EDIT_DISABLED='true'. Server-side check in /edit page.tsx
// short-circuits the form so visitors see a friendly notice instead of an error.

import Navigation from '@/components/Navigation';

export default function EditDisabledNotice() {
  return (
    <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture">
      <Navigation showSearchBar={false} />
      <div className="flex-1 flex items-center justify-center">
        <main className="container mx-auto px-8 max-w-2xl text-center">
          <h1 className="atlas-display-section text-[var(--text-primary)] mb-6">
            Temporarily unavailable
          </h1>
          <p className="atlas-body text-[var(--text-muted)]">
            The /edit surface is offline for maintenance. Check back later.
          </p>
        </main>
      </div>
    </div>
  );
}
