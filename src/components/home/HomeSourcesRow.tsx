/**
 * Compact inline sources row for the home page search panel.
 * Always visible (no collapse toggle) with inline URL input expansion.
 */
'use client';

import { useState, useCallback } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { SourceChip } from '@/components/sources';
import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';
import { cn } from '@/lib/utils';

interface HomeSourcesRowProps {
  sources: SourceChipType[];
  onSourceAdded: (source: SourceChipType) => void;
  onSourceRemoved: (index: number) => void;
  maxSources?: number;
  disabled?: boolean;
  className?: string;
}

export default function HomeSourcesRow({
  sources,
  onSourceAdded,
  onSourceRemoved,
  maxSources = 5,
  disabled = false,
  className = ''
}: HomeSourcesRowProps) {
  const [showInput, setShowInput] = useState(false);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAtLimit = sources.length >= maxSources;
  const hasFailedSources = sources.some(s => s.status === 'failed');

  const validateUrl = (input: string): boolean => {
    try {
      const parsed = new URL(input);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  const handleAddClick = useCallback(() => {
    if (!isAtLimit && !disabled) {
      setShowInput(true);
      setError(null);
    }
  }, [isAtLimit, disabled]);

  const handleSubmit = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isLoading || disabled || isAtLimit) return;

    // Validate URL format
    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL');
      return;
    }

    setError(null);
    setIsLoading(true);

    // Create loading chip immediately for optimistic UI
    const loadingChip: SourceChipType = {
      url: trimmedUrl,
      title: null,
      favicon_url: null,
      domain: new URL(trimmedUrl).hostname.replace(/^www\./, ''),
      status: 'loading',
      error_message: null
    };
    onSourceAdded(loadingChip);
    setUrl('');
    setShowInput(false);

    try {
      const response = await fetchWithTracing('/api/fetchSourceMetadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl })
      });

      const result = await response.json();

      if (result.success && result.data) {
        onSourceAdded(result.data);
      } else {
        const errorChip: SourceChipType = {
          ...loadingChip,
          status: 'failed',
          error_message: result.error || 'Failed to fetch source'
        };
        onSourceAdded(errorChip);
      }
    } catch {
      const errorChip: SourceChipType = {
        ...loadingChip,
        status: 'failed',
        error_message: 'Network error'
      };
      onSourceAdded(errorChip);
    } finally {
      setIsLoading(false);
    }
  }, [url, isLoading, disabled, isAtLimit, onSourceAdded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setShowInput(false);
      setUrl('');
      setError(null);
    }
  };

  const handleCancel = useCallback(() => {
    setShowInput(false);
    setUrl('');
    setError(null);
  }, []);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-sm text-[var(--text-muted)]">Sources:</span>

      {/* Source chips */}
      {sources.map((source, index) => (
        <SourceChip
          key={`${source.url}-${index}`}
          source={source}
          onRemove={() => onSourceRemoved(index)}
          showWarning={source.status === 'failed'}
        />
      ))}

      {/* Counter when 3+ sources */}
      {sources.length >= 3 && (
        <span className="text-xs text-[var(--text-muted)]">
          ({sources.length}/{maxSources})
        </span>
      )}

      {/* Add URL button or inline input */}
      {!isAtLimit && (
        showInput ? (
          <div className="flex items-center gap-1">
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Paste URL..."
              autoFocus
              disabled={disabled || isLoading}
              data-testid="home-source-url-input"
              className={cn(
                'w-48 px-2 py-1 text-sm rounded-page',
                'bg-[var(--surface-input)] border border-[var(--border-default)]',
                'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:border-[var(--accent-gold)]',
                'transition-colors duration-200',
                error && 'border-[var(--status-error)]'
              )}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || isLoading || !url.trim()}
              data-testid="home-source-add-button"
              className="px-2 py-1 text-xs font-ui text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-page transition-all duration-200 hover:shadow-warm disabled:opacity-40"
            >
              {isLoading ? (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                'Add'
              )}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-2 py-1 text-xs font-ui text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddClick}
            disabled={disabled}
            data-testid="home-add-source-button"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-sm',
              'text-[var(--text-muted)] hover:text-[var(--accent-gold)]',
              'transition-colors duration-200',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add URL
          </button>
        )
      )}

      {/* Error message */}
      {error && (
        <span className="text-xs text-[var(--status-error)]">{error}</span>
      )}

      {/* Failed sources indicator */}
      {hasFailedSources && (
        <span data-testid="sources-failed-message" className="text-xs text-[var(--status-error)]">
          (some sources failed to load)
        </span>
      )}
    </div>
  );
}
