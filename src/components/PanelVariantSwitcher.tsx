/**
 * Panel Variant Switcher
 *
 * Dropdown component for switching between AI panel styling variants.
 * Only visible/functional when Midnight Scholar theme is active.
 */
'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePanelVariant } from '@/contexts/PanelVariantContext';
import { PANEL_VARIANTS, type PanelVariant } from '@/components/ai-panel-variants';
import { cn } from '@/lib/utils';

interface PanelVariantSwitcherProps {
  className?: string;
}

export function PanelVariantSwitcher({ className }: PanelVariantSwitcherProps) {
  const { variant, setVariant, isVariantActive } = usePanelVariant();

  // Don't render if variants aren't active (not on Midnight Scholar)
  if (!isVariantActive) {
    return null;
  }

  const variantOptions = Object.entries(PANEL_VARIANTS) as [PanelVariant, { label: string; description: string }][];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label
        htmlFor="panel-variant-select"
        className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap"
      >
        Panel Style
      </label>
      <Select value={variant} onValueChange={(value) => setVariant(value as PanelVariant)}>
        <SelectTrigger
          id="panel-variant-select"
          className="w-[140px] h-8 text-xs font-ui bg-[var(--surface-elevated)] border-[var(--border-default)] focus:ring-[var(--accent-gold)]/20"
        >
          <SelectValue placeholder="Select variant" />
        </SelectTrigger>
        <SelectContent className="bg-[var(--surface-elevated)] border-[var(--border-default)]">
          {variantOptions.map(([value, { label, description }]) => (
            <SelectItem
              key={value}
              value={value}
              className="text-xs font-ui focus:bg-[var(--accent-gold)]/10 focus:text-[var(--accent-copper)]"
            >
              <div className="flex flex-col">
                <span>{label}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
