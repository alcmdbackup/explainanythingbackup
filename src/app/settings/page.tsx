'use client';

/**
 * Settings page with theme customization controls.
 * Uses dynamic import to prevent hydration mismatch with theme state.
 */

import dynamic from 'next/dynamic';
import Navigation from '@/components/Navigation';

// Dynamically import the settings content with no SSR to avoid hydration issues
const SettingsContent = dynamic(() => import('./SettingsContent'), {
  ssr: false,
  loading: () => (
    <div className="space-y-8 animate-pulse">
      {/* Palette grid skeleton */}
      <div className="space-y-4">
        <div className="h-5 w-32 bg-[var(--surface-elevated)] rounded" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-[var(--surface-elevated)] rounded-book" />
          ))}
        </div>
      </div>
      {/* Mode toggle skeleton */}
      <div className="space-y-4">
        <div className="h-5 w-24 bg-[var(--surface-elevated)] rounded" />
        <div className="flex gap-3">
          <div className="h-10 w-24 bg-[var(--surface-elevated)] rounded-book" />
          <div className="h-10 w-24 bg-[var(--surface-elevated)] rounded-book" />
        </div>
      </div>
    </div>
  ),
});

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <main className="container mx-auto max-w-2xl px-4 py-12">
        {/* Page header with decorative flourish */}
        <header className="mb-10">
          <h1 className="font-display text-3xl font-bold text-[var(--text-primary)] mb-2">
            Settings
          </h1>
          <p className="text-[var(--text-muted)] font-body">
            Customize your reading experience
          </p>
          <div className="title-flourish mt-4" />
        </header>

        <SettingsContent />
      </main>
    </div>
  );
}
