'use client';

/**
 * OutputModeToggle - Compact segmented control for selecting between suggest and rewrite modes
 * Redesigned for minimal vertical footprint (~32px vs previous ~100px)
 */

import { cn } from '@/lib/utils';

export type OutputMode = 'inline-diff' | 'rewrite';

interface OutputModeToggleProps {
  value: OutputMode;
  onChange: (mode: OutputMode) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Toggle between suggest (CriticMarkup inline edits) and rewrite (full regeneration)
 */
export default function OutputModeToggle({
  value,
  onChange,
  disabled = false,
  className
}: OutputModeToggleProps) {
  return (
    <div
      className={cn('flex items-center gap-3', className)}
      data-testid="output-mode-toggle"
      role="radiogroup"
      aria-label="Output mode selection"
    >
      <span className="text-sm font-ui font-medium text-[var(--text-on-primary)]">
        Mode:
      </span>
      <div className="inline-flex rounded-md border border-white/30 bg-white/15 p-1">
        <button
          type="button"
          role="radio"
          aria-checked={value === 'inline-diff'}
          data-testid="output-mode-inline-diff"
          disabled={disabled}
          onClick={() => onChange('inline-diff')}
          className={cn(
            'px-4 py-1.5 text-sm font-ui font-semibold rounded transition-all duration-150',
            'focus:outline-none focus:ring-1 focus:ring-white/30',
            value === 'inline-diff'
              ? 'bg-[var(--text-primary)] text-[var(--background)] shadow-warm-sm'
              : 'text-[var(--text-on-primary)]/80 hover:text-[var(--text-on-primary)]',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          title="Shows tracked changes you can accept or reject"
        >
          Suggest
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'rewrite'}
          data-testid="output-mode-rewrite"
          disabled={disabled}
          onClick={() => onChange('rewrite')}
          className={cn(
            'px-4 py-1.5 text-sm font-ui font-semibold rounded transition-all duration-150',
            'focus:outline-none focus:ring-1 focus:ring-white/30',
            value === 'rewrite'
              ? 'bg-[var(--text-primary)] text-[var(--background)] shadow-warm-sm'
              : 'text-[var(--text-on-primary)]/80 hover:text-[var(--text-on-primary)]',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          title="Generates a completely new version"
        >
          Rewrite
        </button>
      </div>
    </div>
  );
}
