'use client';

/**
 * OutputModeToggle - Radio toggle to select between inline diff and rewrite modes
 * Used in AI editing panel to let users choose output format
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
 * Toggle between inline diff (CriticMarkup edits in place) and rewrite (full regeneration)
 */
export default function OutputModeToggle({
  value,
  onChange,
  disabled = false,
  className
}: OutputModeToggleProps) {
  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-testid="output-mode-toggle"
      role="radiogroup"
      aria-label="Output mode selection"
    >
      <label className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider">
        Output Mode
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === 'inline-diff'}
          data-testid="output-mode-inline-diff"
          disabled={disabled}
          onClick={() => onChange('inline-diff')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-ui rounded-md border transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/20',
            value === 'inline-diff'
              ? 'bg-[var(--accent-gold)]/10 border-[var(--accent-gold)] text-[var(--accent-copper)]'
              : 'bg-[var(--surface-elevated)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className="flex flex-col items-center gap-1">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span>Inline Diff</span>
          </div>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'rewrite'}
          data-testid="output-mode-rewrite"
          disabled={disabled}
          onClick={() => onChange('rewrite')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-ui rounded-md border transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/20',
            value === 'rewrite'
              ? 'bg-[var(--accent-gold)]/10 border-[var(--accent-gold)] text-[var(--accent-copper)]'
              : 'bg-[var(--surface-elevated)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className="flex flex-col items-center gap-1">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Rewrite</span>
          </div>
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {value === 'inline-diff'
          ? 'Shows tracked changes you can accept/reject'
          : 'Generates a completely new version'}
      </p>
    </div>
  );
}
