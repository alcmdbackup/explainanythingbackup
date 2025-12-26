'use client';

import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';

interface SourceChipProps {
  source: SourceChipType;
  onRemove?: () => void;
  showWarning?: boolean;
  className?: string;
}

/**
 * Displays a source URL as a compact chip with favicon, title, and domain
 * Midnight Scholar theme - Elegant bookmark-style appearance
 */
export default function SourceChip({
  source,
  onRemove,
  showWarning = false,
  className = ''
}: SourceChipProps) {
  const isLoading = source.status === 'loading';
  const isFailed = source.status === 'failed';
  const displayWarning = showWarning || isFailed;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-page',
        'bg-[var(--surface-elevated)] border border-[var(--border-default)]',
        'text-sm font-ui transition-all duration-200',
        isLoading && 'opacity-60 animate-pulse',
        isFailed && 'border-[var(--status-error)] bg-[var(--status-error)]/5',
        !isLoading && !isFailed && 'hover:border-[var(--accent-gold)] hover:shadow-warm-sm',
        className
      )}
    >
      {/* Favicon - using img for dynamic external URLs */}
      {source.favicon_url && !isLoading ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.favicon_url}
          alt=""
          className="w-4 h-4 rounded-sm"
          onError={(e) => {
            // Hide broken favicon images
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-4 h-4 rounded-sm bg-[var(--surface-secondary)]" />
      )}

      {/* Title or domain */}
      <span
        className={cn(
          'max-w-[200px] truncate',
          isFailed ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'
        )}
        title={source.title || source.url}
      >
        {isLoading ? 'Loading...' : (source.title || source.domain)}
      </span>

      {/* Domain badge (if title is shown) */}
      {source.title && !isLoading && (
        <span className="text-xs text-[var(--text-muted)] hidden sm:inline">
          {source.domain}
        </span>
      )}

      {/* Warning icon for failed fetches */}
      {displayWarning && (
        <ExclamationTriangleIcon
          className="w-4 h-4 text-[var(--status-error)] flex-shrink-0"
          title={source.error_message || 'Failed to fetch source'}
        />
      )}

      {/* Remove button */}
      {onRemove && !isLoading && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            'p-0.5 rounded-full transition-colors',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--surface-secondary)]'
          )}
          aria-label="Remove source"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
