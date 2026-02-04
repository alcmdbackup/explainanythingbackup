/**
 * URL input field for adding source URLs.
 * Delegates validation and metadata fetching to useSourceSubmit hook.
 */
'use client';

import { useState } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import useSourceSubmit from '@/hooks/useSourceSubmit';

interface SourceInputProps {
  onSourceAdded: (source: SourceChipType) => void;
  disabled?: boolean;
  maxSources?: number;
  currentCount?: number;
  className?: string;
}

export default function SourceInput({
  onSourceAdded,
  disabled = false,
  maxSources = 5,
  currentCount = 0,
  className = ''
}: SourceInputProps) {
  const [url, setUrl] = useState('');
  const { submitUrl, isSubmitting, error, clearError } = useSourceSubmit(onSourceAdded);

  const isAtLimit = currentCount >= maxSources;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim() || isSubmitting || disabled || isAtLimit) return;
    await submitUrl(url);
    setUrl('');
  };

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
            clearError();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste source URL..."
          data-testid="source-url-input"
          disabled={disabled || isSubmitting}
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
          disabled={disabled || isSubmitting || !url.trim()}
          variant="outline"
          data-testid="source-add-button"
          className="shrink-0 h-auto py-2 px-3 text-sm"
        >
          {isSubmitting ? (
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
