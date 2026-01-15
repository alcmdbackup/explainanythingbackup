'use client';

/**
 * PanelVariantSelector - Dropdown to switch between AI panel design variants
 * Compact design that fits in the page header area
 */

import { usePanelVariant } from '@/contexts/PanelVariantContext';
import { PANEL_VARIANT_OPTIONS, type PanelVariant } from './ai-panel-variants';
import { cn } from '@/lib/utils';

interface PanelVariantSelectorProps {
  className?: string;
  disabled?: boolean;
}

export default function PanelVariantSelector({
  className,
  disabled = false
}: PanelVariantSelectorProps) {
  const { variant, setVariant } = usePanelVariant();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label
        htmlFor="panel-variant-select"
        className="text-xs font-ui text-[var(--text-muted)] whitespace-nowrap"
      >
        Panel Style:
      </label>
      <select
        id="panel-variant-select"
        value={variant}
        onChange={(e) => setVariant(e.target.value as PanelVariant)}
        disabled={disabled}
        data-testid="panel-variant-select"
        className={cn(
          'rounded-md border border-[var(--border-default)]/50',
          'bg-[var(--surface-secondary)] px-2.5 py-1',
          'text-xs font-ui text-[var(--text-secondary)]',
          'transition-all duration-200',
          'hover:border-[var(--accent-gold)]/50',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/20 focus:border-[var(--accent-gold)]/50',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {PANEL_VARIANT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
