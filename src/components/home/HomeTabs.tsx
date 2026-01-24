/**
 * Tab component for switching between Search and Import modes on the home page.
 * Uses underline indicator styling for a minimal, clean appearance.
 */
'use client';

import { cn } from '@/lib/utils';

export type HomeTab = 'search' | 'import';

interface HomeTabsProps {
  activeTab: HomeTab;
  onTabChange: (tab: HomeTab) => void;
  className?: string;
}

export default function HomeTabs({
  activeTab,
  onTabChange,
  className = ''
}: HomeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Content creation modes"
      className={cn('flex items-center justify-center gap-8 mb-6', className)}
    >
      <button
        role="tab"
        aria-selected={activeTab === 'search'}
        aria-controls="search-panel"
        id="search-tab"
        data-testid="home-tab-search"
        onClick={() => onTabChange('search')}
        className={cn(
          'relative pb-2 text-sm font-ui transition-colors duration-200',
          activeTab === 'search'
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        )}
      >
        Search
        {activeTab === 'search' && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-gold)]" />
        )}
      </button>
      <button
        role="tab"
        aria-selected={activeTab === 'import'}
        aria-controls="import-panel"
        id="import-tab"
        data-testid="home-tab-import"
        onClick={() => onTabChange('import')}
        className={cn(
          'relative pb-2 text-sm font-ui transition-colors duration-200',
          activeTab === 'import'
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        )}
      >
        Import
        {activeTab === 'import' && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-gold)]" />
        )}
      </button>
    </div>
  );
}
