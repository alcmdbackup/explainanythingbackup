'use client';

import dynamic from 'next/dynamic';
import Navigation from '@/components/Navigation';

// Dynamically import the settings content with no SSR to avoid hydration issues
const SettingsContent = dynamic(() => import('./SettingsContent'), {
  ssr: false,
  loading: () => (
    <div className="scholar-card p-6 space-y-6 animate-pulse">
      <div className="space-y-3">
        <div className="h-4 w-24 bg-[var(--surface-elevated)] rounded" />
        <div className="h-10 bg-[var(--surface-elevated)] rounded" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-20 bg-[var(--surface-elevated)] rounded" />
        <div className="h-9 w-24 bg-[var(--surface-elevated)] rounded" />
      </div>
    </div>
  ),
});

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="atlas-display text-3xl mb-8">Settings</h1>
        <SettingsContent />
      </main>
    </div>
  );
}
