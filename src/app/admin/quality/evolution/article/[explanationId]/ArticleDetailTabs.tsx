// Client-side tab bar for article detail page: Runs, Attribution, and Variants tabs.
// Each tab lazily loads its own data via server actions on selection.

'use client';

import { useState } from 'react';
import { ArticleRunsTimeline } from '@evolution/components/evolution/article/ArticleRunsTimeline';
import { ArticleAgentAttribution } from '@evolution/components/evolution/article/ArticleAgentAttribution';
import { ArticleVariantsList } from '@evolution/components/evolution/article/ArticleVariantsList';

type TabId = 'runs' | 'attribution' | 'variants';

const TABS: { id: TabId; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'variants', label: 'Variants' },
];

interface ArticleDetailTabsProps {
  explanationId: number;
}

export function ArticleDetailTabs({ explanationId }: ArticleDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('runs');

  return (
    <div>
      <div className="flex gap-1 border-b border-[var(--border-default)] mb-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-[var(--accent-gold)] border-b-2 border-[var(--accent-gold)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'runs' && <ArticleRunsTimeline explanationId={explanationId} />}
      {activeTab === 'attribution' && <ArticleAgentAttribution explanationId={explanationId} />}
      {activeTab === 'variants' && <ArticleVariantsList explanationId={explanationId} />}
    </div>
  );
}
