'use client';

import { type SourceChipType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';
import SourceChip from './SourceChip';
import SourceInput from './SourceInput';

interface SourceListProps {
  sources: SourceChipType[];
  onSourceAdded: (source: SourceChipType) => void;
  onSourceRemoved: (index: number) => void;
  maxSources?: number;
  disabled?: boolean;
  showInput?: boolean;
  className?: string;
}

/**
 * Container for source chips with input field
 * Displays list of sources and allows adding/removing
 */
export default function SourceList({
  sources,
  onSourceAdded,
  onSourceRemoved,
  maxSources = 5,
  disabled = false,
  showInput = true,
  className = ''
}: SourceListProps) {
  const hasFailedSources = sources.some(s => s.status === 'failed');

  // Handle source updates (replace loading chip with fetched data)
  const handleSourceAdded = (source: SourceChipType) => {
    // Check if this is an update to an existing loading source
    const existingIndex = sources.findIndex(
      s => s.url === source.url && s.status === 'loading'
    );

    if (existingIndex >= 0 && source.status !== 'loading') {
      // This is an update to an existing loading chip
      // Parent should handle this via onSourceAdded
    }

    onSourceAdded(source);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Source chips */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((source, index) => (
            <SourceChip
              key={`${source.url}-${index}`}
              source={source}
              onRemove={() => onSourceRemoved(index)}
              showWarning={source.status === 'failed'}
            />
          ))}
        </div>
      )}

      {/* Count indicator */}
      {sources.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>{sources.length}/{maxSources} sources</span>
          {hasFailedSources && (
            <span data-testid="sources-failed-message" className="text-[var(--status-error)]">
              (some sources failed to load)
            </span>
          )}
        </div>
      )}

      {/* Input field */}
      {showInput && (
        <SourceInput
          onSourceAdded={handleSourceAdded}
          disabled={disabled}
          maxSources={maxSources}
          currentCount={sources.length}
        />
      )}

      {/* Empty state */}
      {sources.length === 0 && !showInput && (
        <p className="text-sm text-[var(--text-muted)]">
          No sources added
        </p>
      )}
    </div>
  );
}
