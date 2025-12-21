'use client';

import dynamic from 'next/dynamic';
import Navigation from '@/components/Navigation';

const WhitelistContent = dynamic(() => import('@/components/admin/WhitelistContent'), {
  ssr: false,
  loading: () => (
    <div className="scholar-card p-6 animate-pulse">
      <div className="h-8 w-48 bg-[var(--surface-elevated)] rounded mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded" />
        ))}
      </div>
    </div>
  ),
});

export default function WhitelistPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="atlas-display text-3xl mb-8">Link Whitelist</h1>
        <WhitelistContent />
      </main>
    </div>
  );
}
