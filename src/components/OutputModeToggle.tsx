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
      <span className="text-xs font-ui text-[var(--text-muted)]">
        Mode:
      </span>
      <div className="inline-flex rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-0.5">
        <button
          type="button"
          role="radio"
          aria-checked={value === 'inline-diff'}
          data-testid="output-mode-inline-diff"
          disabled={disabled}
          onClick={() => onChange('inline-diff')}
          className={cn(
            'px-2.5 py-1 text-xs font-ui rounded transition-all duration-150',
            'focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]/30',
            value === 'inline-diff'
              ? 'bg-[var(--accent-gold)]/15 text-[var(--accent-copper)] shadow-warm-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
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
            'px-2.5 py-1 text-xs font-ui rounded transition-all duration-150',
            'focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]/30',
            value === 'rewrite'
              ? 'bg-[var(--accent-gold)]/15 text-[var(--accent-copper)] shadow-warm-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
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
