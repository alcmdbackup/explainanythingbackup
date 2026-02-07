/**
 * Unified search + paste combobox for source management.
 * Combines URL pasting with discovered source browsing in a single Radix Popover input.
 */
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { PlusIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { type DiscoveredSource } from '@/lib/services/sourceDiscovery';
import {
  getPopularSourcesByTopicAction,
  getSimilarArticleSourcesAction,
} from '@/actions/actions';
import useSourceSubmit from '@/hooks/useSourceSubmit';

export interface SourceComboboxProps {
  explanationId?: number;
  topicId?: number | null;
  onSourceAdded: (source: SourceChipType) => void;
  existingUrls: string[];
  maxSources: number;
  currentCount: number;
  disabled?: boolean;
}

/** Returns true when text starts with http:// or https:// */
function isUrlLike(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

export default function SourceCombobox({
  explanationId,
  topicId,
  onSourceAdded,
  existingUrls,
  maxSources,
  currentCount,
  disabled = false,
}: SourceComboboxProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [discoveredSources, setDiscoveredSources] = useState<DiscoveredSource[]>([]);
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(false);
  const lastLoadedExplanationIdRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const { submitUrl, isSubmitting, error, clearError } = useSourceSubmit(onSourceAdded);

  const isAtLimit = currentCount >= maxSources;
  const existingUrlSet = useMemo(() => new Set(existingUrls), [existingUrls]);

  // ─── Discovery data fetch ──────────────────────────────────────────────
  useEffect(() => {
    if (!explanationId || lastLoadedExplanationIdRef.current === explanationId) return;

    let cancelled = false;
    lastLoadedExplanationIdRef.current = explanationId;
    setIsLoadingDiscovery(true);

    (async () => {
      try {
        const [popularResult, similarResult] = await Promise.all([
          topicId
            ? getPopularSourcesByTopicAction({ topicId, limit: 5 })
            : Promise.resolve({ data: [] as DiscoveredSource[], error: null }),
          getSimilarArticleSourcesAction({ explanationId, limit: 5 }),
        ]);

        if (cancelled) return;

        // Deduplicate by source_cache_id
        const seen = new Set<number>();
        const merged: DiscoveredSource[] = [];
        for (const src of [...popularResult.data, ...similarResult.data]) {
          if (!seen.has(src.source_cache_id)) {
            seen.add(src.source_cache_id);
            merged.push(src);
          }
        }
        setDiscoveredSources(merged);
      } catch {
        // Graceful degradation — combobox works without discovery
      } finally {
        if (!cancelled) setIsLoadingDiscovery(false);
      }
    })();

    return () => { cancelled = true; };
  }, [explanationId, topicId]);

  // ─── Filtered sources ──────────────────────────────────────────────────
  const filteredSources = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return discoveredSources;
    return discoveredSources.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(query)) ||
        s.domain.toLowerCase().includes(query) ||
        s.url.toLowerCase().includes(query)
    );
  }, [inputValue, discoveredSources]);

  // ─── Build option list for keyboard nav ────────────────────────────────
  // Row 0 = "Add as URL" action (always present when text typed)
  // Rows 1..N = filtered discovered sources
  const hasText = inputValue.trim().length > 0;
  const urlDetected = isUrlLike(inputValue);
  const showAddRow = hasText;
  const optionCount = (showAddRow ? 1 : 0) + filteredSources.length;

  // ─── Handlers ──────────────────────────────────────────────────────────
  const handleAddUrl = useCallback(async () => {
    const url = inputValue.trim();
    if (!url) return;
    await submitUrl(url);
    setInputValue('');
    setIsOpen(false);
  }, [inputValue, submitUrl]);

  const handleAddDiscovered = useCallback((source: DiscoveredSource) => {
    const chip: SourceChipType = {
      url: source.url,
      title: source.title,
      favicon_url: source.favicon_url,
      domain: source.domain,
      status: 'success',
      error_message: null,
      source_cache_id: source.source_cache_id,
    };
    onSourceAdded(chip);
    setInputValue('');
    setIsOpen(false);
  }, [onSourceAdded]);

  const handleSelect = useCallback((index: number) => {
    if (showAddRow && index === 0) {
      handleAddUrl();
      return;
    }
    const sourceIndex = showAddRow ? index - 1 : index;
    const source = filteredSources[sourceIndex];
    if (source && !existingUrlSet.has(source.url)) {
      handleAddDiscovered(source);
    }
  }, [showAddRow, filteredSources, existingUrlSet, handleAddUrl, handleAddDiscovered]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % optionCount);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + optionCount) % optionCount);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < optionCount) {
          handleSelect(activeIndex);
        } else if (hasText) {
          handleAddUrl();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(Math.max(0, optionCount - 1));
        break;
    }
  }, [isOpen, optionCount, activeIndex, hasText, handleAddUrl, handleSelect]);

  // Reset active index when options change
  useEffect(() => {
    setActiveIndex(-1);
  }, [inputValue]);

  const listboxId = 'source-combobox-listbox';
  const getOptionId = (idx: number) => `source-combobox-option-${idx}`;

  if (isAtLimit) {
    return (
      <div className="text-sm text-[var(--text-muted)]">
        Maximum {maxSources} sources reached
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Anchor asChild>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                clearError();
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => {
                if (!isOpen) setIsOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search or paste URL..."
              disabled={disabled || isSubmitting}
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
              aria-autocomplete="list"
              data-testid="source-combobox-input"
              className={cn(
                'w-full px-3 py-2 pr-8 rounded-page text-sm',
                'bg-[var(--surface-input)] border border-[var(--border-default)]',
                'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:border-[var(--accent-gold)] focus:ring-1 focus:ring-[var(--accent-gold)] focus:bg-[var(--surface-secondary)]',
                'transition-colors duration-200',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                error && 'border-[var(--status-error)]'
              )}
            />
            {isSubmitting && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </Popover.Anchor>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e: Event) => e.preventDefault()}
            onCloseAutoFocus={(e: Event) => e.preventDefault()}
            className={cn(
              'z-50 w-[var(--radix-popover-trigger-width)] max-h-64 overflow-y-auto',
              'bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg',
              'animate-in fade-in-0 zoom-in-95'
            )}
          >
            <div
              ref={listboxRef}
              role="listbox"
              id={listboxId}
              aria-label="Source suggestions"
              data-testid="source-combobox-listbox"
            >
              {/* Hint or "Add as URL" row */}
              {!hasText && (
                <div
                  role="option"
                  aria-selected={false}
                  aria-disabled={true}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)]"
                  data-testid="source-combobox-hint"
                >
                  <span>🔗</span>
                  <span>Paste a URL to add</span>
                </div>
              )}

              {showAddRow && (
                <div
                  role="option"
                  id={getOptionId(0)}
                  aria-selected={activeIndex === 0}
                  tabIndex={-1}
                  onClick={handleAddUrl}
                  data-testid="source-combobox-add-url"
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors',
                    activeIndex === 0
                      ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]',
                    urlDetected && 'font-medium'
                  )}
                >
                  <PlusIcon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">
                    {urlDetected
                      ? `Add ${inputValue.trim()}`
                      : `Add as URL: "${inputValue.trim()}"`}
                  </span>
                </div>
              )}

              {/* Discovered sources */}
              {isLoadingDiscovery && filteredSources.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--text-muted)]">
                  <span className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                  <span>Finding sources...</span>
                </div>
              )}

              {!urlDetected && filteredSources.map((source, i) => {
                const optIdx = showAddRow ? i + 1 : i;
                const alreadyAdded = existingUrlSet.has(source.url);

                return (
                  <div
                    key={source.source_cache_id}
                    role="option"
                    id={getOptionId(optIdx)}
                    aria-selected={activeIndex === optIdx}
                    aria-disabled={alreadyAdded}
                    tabIndex={-1}
                    onClick={() => !alreadyAdded && handleAddDiscovered(source)}
                    data-testid={`source-combobox-item-${source.source_cache_id}`}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 transition-colors',
                      alreadyAdded
                        ? 'opacity-50 cursor-not-allowed'
                        : 'cursor-pointer',
                      activeIndex === optIdx && !alreadyAdded
                        ? 'bg-[var(--accent-gold)]/10'
                        : !alreadyAdded && 'hover:bg-[var(--surface-secondary)]'
                    )}
                  >
                    {/* Favicon */}
                    <div className="flex-shrink-0 w-5 h-5 rounded overflow-hidden bg-[var(--surface-page)] flex items-center justify-center">
                      {source.favicon_url ? (
                        <img src={source.favicon_url} alt="" className="w-4 h-4" loading="lazy" />
                      ) : (
                        <span className="text-xs font-ui text-[var(--text-muted)] uppercase">
                          {source.domain.charAt(0)}
                        </span>
                      )}
                    </div>

                    {/* Title + domain */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-body text-[var(--text-primary)] truncate">
                        {source.title || source.domain}
                      </p>
                      <p className="text-xs font-ui text-[var(--text-muted)]">
                        {source.domain}
                        {source.frequency > 0 && (
                          <> &middot; {source.frequency} {source.frequency === 1 ? 'citation' : 'citations'}</>
                        )}
                      </p>
                    </div>

                    {/* Add icon or checkmark */}
                    {alreadyAdded ? (
                      <span className="text-xs text-[var(--text-muted)]">Added</span>
                    ) : (
                      <PlusIcon className="w-4 h-4 flex-shrink-0 text-[var(--accent-gold)]" />
                    )}
                  </div>
                );
              })}

              {/* No results state */}
              {!isLoadingDiscovery && !hasText && discoveredSources.length === 0 && (
                <div className="px-3 py-3 text-sm text-[var(--text-muted)] text-center">
                  No source suggestions available
                </div>
              )}

              {hasText && !urlDetected && filteredSources.length === 0 && discoveredSources.length > 0 && (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)] text-center">
                  No matching sources found
                </div>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error && (
        <p className="text-xs text-[var(--status-error)]" data-testid="source-combobox-error">
          {error}
        </p>
      )}
    </div>
  );
}
