'use client';

import { useTextRevealSettings } from '@/hooks/useTextRevealSettings';
import {
  TextRevealEffect,
  TEXT_REVEAL_EFFECT_OPTIONS,
} from '@/lib/textRevealAnimations';

/**
 * Settings component for selecting text reveal animation effect
 * Used in the settings page to control how streaming text appears
 */
export function TextRevealSettings() {
  const { effect, setEffect, isLoaded } = useTextRevealSettings();

  if (!isLoaded) {
    return (
      <div className="h-10 animate-pulse bg-[var(--surface-elevated)] rounded-page" />
    );
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="text-reveal-select"
        className="block text-sm font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider"
      >
        Text Reveal Animation
      </label>
      <select
        id="text-reveal-select"
        value={effect}
        onChange={(e) => setEffect(e.target.value as TextRevealEffect)}
        className="w-full rounded-page border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2.5 text-sm font-sans text-[var(--text-secondary)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)]"
      >
        {TEXT_REVEAL_EFFECT_OPTIONS.map(({ value, label, description }) => (
          <option key={value} value={value}>
            {label} - {description}
          </option>
        ))}
      </select>
      <p className="text-xs font-serif text-[var(--text-muted)] italic">
        Applied to newly generated content during streaming
      </p>
    </div>
  );
}
