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
          // Visible 3-sided border + rounded top corners give each button a tab
          // shape. `-mb-px` overlaps the container's border-b so the tab sits ON
          // the line. First tab drops its right border so the two tabs share an
          // edge (no double border).
          'border border-r-0 border-[var(--border-default)] rounded-tl-page -mb-px',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30',
          value === 'inline-diff'
            // Active: gold text + filled bg; bottom border matches the bg so it
            // "breaks through" the container's border-b and merges with the
            // content area below — classic tab look.
            ? 'bg-[var(--surface-elevated)] text-[var(--accent-gold)] border-b-[var(--surface-elevated)]'
            : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]',
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
          // Mirror of the first tab — keeps right border, rounds the top-right.
          'border border-[var(--border-default)] rounded-tr-page -mb-px',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30',
          value === 'rewrite'
            ? 'bg-[var(--surface-elevated)] text-[var(--accent-gold)] border-b-[var(--surface-elevated)]'
            : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        title="Generates a completely new version"
      >
        Rewrite
      </button>
    </div>
  );
}
