'use client';

import { useState, useCallback } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';

interface SourceInputProps {
  onSourceAdded: (source: SourceChipType) => void;
  disabled?: boolean;
  maxSources?: number;
  currentCount?: number;
  className?: string;
}

/**
 * URL input field for adding source URLs
 * Fetches metadata from API and returns SourceChipType
 */
export default function SourceInput({
  onSourceAdded,
  disabled = false,
  maxSources = 5,
  currentCount = 0,
  className = ''
}: SourceInputProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAtLimit = currentCount >= maxSources;

  const validateUrl = (input: string): boolean => {
    try {
      const parsed = new URL(input);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();

    const trimmedUrl = url.trim();
    if (!trimmedUrl || isLoading || disabled || isAtLimit) return;

    // Validate URL format
    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL (starting with http:// or https://)');
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

    try {
      const response = await fetchWithTracing('/api/fetchSourceMetadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl })
      });

      const result = await response.json();

      if (result.success && result.data) {
        // Update with fetched data - parent should handle updating the loading chip
        onSourceAdded(result.data);
      } else {
        // Update with error state
        const errorChip: SourceChipType = {
          ...loadingChip,
          status: 'failed',
          error_message: result.error || 'Failed to fetch source'
        };
        onSourceAdded(errorChip);
      }
    } catch {
      // Update with error state
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
    }
  };

  if (isAtLimit) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        Maximum {maxSources} sources reached
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste source URL..."
          data-testid="source-url-input"
          disabled={disabled || isLoading}
          className={cn(
            'flex-1 px-3 py-2 rounded-page text-sm',
            'bg-[var(--surface-input)] border border-[var(--border-default)]',
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:outline-none focus:border-[var(--accent-gold)] focus:ring-1 focus:ring-[var(--accent-gold)] focus:bg-[var(--surface-secondary)]',
            'transition-colors duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-[var(--status-error)]'
          )}
        />
        <Button
          type="button"
          onClick={() => handleSubmit()}
          disabled={disabled || isLoading || !url.trim()}
          variant="outline"
          data-testid="source-add-button"
          className="shrink-0 h-auto py-2 px-3 text-sm"
        >
          {isLoading ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <PlusIcon className="w-4 h-4" />
          )}
          <span className="sr-only sm:not-sr-only sm:ml-1">Add</span>
        </Button>
      </div>
      {error && (
        <p className="text-xs text-[var(--status-error)]">{error}</p>
      )}
    </div>
  );
}
