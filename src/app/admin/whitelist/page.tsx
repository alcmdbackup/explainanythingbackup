'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Navigation from '@/components/Navigation';

const WhitelistContent = dynamic(() => import('@/components/admin/WhitelistContent'), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder />,
});

const CandidatesContent = dynamic(() => import('@/components/admin/CandidatesContent'), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder />,
});

function TabLoadingPlaceholder() {
  return (
    <div className="scholar-card p-6 animate-pulse">
      <div className="h-8 w-48 bg-[var(--surface-elevated)] rounded mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded" />
        ))}
      </div>
    </div>
  );
}

type TabType = 'whitelist' | 'candidates';

function WhitelistPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get('tab') as TabType) || 'whitelist';

  const setActiveTab = (tab: TabType) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="atlas-display text-3xl mb-8">Link Management</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[var(--border-default)]">
          <button
            onClick={() => setActiveTab('whitelist')}
            data-testid="admin-whitelist-tab-whitelist"
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'whitelist'
                ? 'text-[var(--accent-gold)] border-[var(--accent-gold)]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
            }`}
          >
            Whitelist
          </button>
          <button
            onClick={() => setActiveTab('candidates')}
            data-testid="admin-whitelist-tab-candidates"
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'candidates'
                ? 'text-[var(--accent-gold)] border-[var(--accent-gold)]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
            }`}
          >
            Candidates
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'whitelist' && <WhitelistContent />}
        {activeTab === 'candidates' && <CandidatesContent />}
      </main>
    </div>
  );
}

export default function WhitelistPage() {
  return (
    <Suspense fallback={<TabLoadingPlaceholder />}>
      <WhitelistPageContent />
    </Suspense>
  );
}
