/**
 * Search panel for the home page Search tab.
 * Contains query input, inline sources row, and tag selector.
 */
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type SourceChipType } from '@/lib/schemas/schemas';
import HomeSourcesRow from './HomeSourcesRow';
import HomeTagSelector, { type HomeTagState } from './HomeTagSelector';

interface HomeSearchPanelProps {
  sources: SourceChipType[];
  onSourcesChange: (sources: SourceChipType[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
}

export default function HomeSearchPanel({
  sources,
  onSourcesChange,
  query,
  onQueryChange,
  className = ''
}: HomeSearchPanelProps) {
  const [tagState, setTagState] = useState<HomeTagState>({
    difficulty: 'intermediate',
    length: 'standard',
    simpleTags: []
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSubmitting) return;

    setIsSubmitting(true);

    // Store sources in sessionStorage for results page
    const validSources = sources.filter(s => s.status === 'success');
    if (validSources.length > 0) {
      sessionStorage.setItem('pendingSources', JSON.stringify(validSources));
    } else {
      sessionStorage.removeItem('pendingSources');
    }

    // Convert tag state to additionalRules format
    const rules: string[] = [];
    if (tagState.difficulty !== 'intermediate') {
      rules.push(`difficulty: ${tagState.difficulty}`);
    }
    if (tagState.length !== 'standard') {
      rules.push(`length: ${tagState.length}`);
    }
    rules.push(...tagState.simpleTags);

    if (rules.length > 0) {
      sessionStorage.setItem('pendingTags', JSON.stringify(rules));
    } else {
      sessionStorage.removeItem('pendingTags');
    }

    try {
      router.push(`/results?q=${encodeURIComponent(query.trim())}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [query, sources, tagState, isSubmitting, router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Source handlers
  const handleSourceAdded = useCallback((source: SourceChipType) => {
    // Check if this is an update to an existing source (by URL)
    const existingIndex = sources.findIndex(s => s.url === source.url);

    if (existingIndex >= 0) {
      // Update existing chip (loading -> success/failed)
      const newSources = [...sources];
      newSources[existingIndex] = source;
      onSourcesChange(newSources);
    } else {
      // Add new source chip
      onSourcesChange([...sources, source]);
    }
  }, [sources, onSourcesChange]);

  const handleSourceRemoved = useCallback((index: number) => {
    const newSources = sources.filter((_, i) => i !== index);
    onSourcesChange(newSources);
  }, [sources, onSourcesChange]);

  return (
    <form
      onSubmit={handleSubmit}
      role="tabpanel"
      id="search-panel"
      aria-labelledby="search-tab"
      className={`w-full ${className}`}
    >
      {/* Query textarea */}
      <div className="relative group">
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="home-search-input"
          className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-6 py-4 text-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-body resize-none rounded-none search-focus-glow"
          placeholder="What would you like to learn?"
          maxLength={150}
          rows={1}
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={isSubmitting || !query.trim()}
          data-testid="home-search-submit"
          className="absolute right-3 top-1/2 -translate-y-1/2 atlas-button disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="atlas-loading-dots">
              <span className="atlas-loading-dot"></span>
              <span className="atlas-loading-dot"></span>
              <span className="atlas-loading-dot"></span>
            </span>
          ) : 'Search'}
        </button>
      </div>

      {/* Sources row - always visible */}
      <div className="mt-2">
        <HomeSourcesRow
          sources={sources}
          onSourceAdded={handleSourceAdded}
          onSourceRemoved={handleSourceRemoved}
          disabled={isSubmitting}
        />
      </div>

      {/* Tags row */}
      <div className="mt-2">
        <HomeTagSelector
          state={tagState}
          onChange={setTagState}
          disabled={isSubmitting}
        />
      </div>
    </form>
  );
}
