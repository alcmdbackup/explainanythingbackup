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
      className={cn('flex w-full border-b border-[var(--border-default)]', className)}
      data-testid="output-mode-toggle"
      role="radiogroup"
      aria-label="Output mode selection"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'inline-diff'}
        data-testid="output-mode-inline-diff"
        disabled={disabled}
        onClick={() => onChange('inline-diff')}
        className={cn(
          'flex-1 py-3 text-base font-ui font-medium text-center transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30',
          // -mb-px overlays the active tab's underline onto the container's bottom
          // border, producing the classic tabbed look where the active tab feels
          // connected to the content area below.
          value === 'inline-diff'
            ? 'text-[var(--accent-gold)] border-b-2 border-[var(--accent-gold)] -mb-px'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
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
          'flex-1 py-3 text-base font-ui font-medium text-center transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30',
          value === 'rewrite'
            ? 'text-[var(--accent-gold)] border-b-2 border-[var(--accent-gold)] -mb-px'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        title="Generates a completely new version"
      >
        Rewrite
      </button>
    </div>
  );
}
