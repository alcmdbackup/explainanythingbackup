'use client';

/**
 * Settings page content with scholarly design system styling.
 * Provides theme palette, appearance mode, and text animation controls.
 */

import { useTheme, THEME_PALETTES, type ThemePalette } from '@/contexts/ThemeContext';
import { Sun, Moon, Check } from 'lucide-react';
import { TextRevealSettings } from '@/components/TextRevealSettings';
import { cn } from '@/lib/utils';

// Color swatches for each theme palette for visual preview
const PALETTE_COLORS: Record<ThemePalette, { primary: string; secondary: string }> = {
  'midnight-scholar': { primary: '#d4a853', secondary: '#b87333' },
  'venetian-archive': { primary: '#8b2942', secondary: '#2d5a4a' },
  'oxford-blue': { primary: '#1b4965', secondary: '#774936' },
  'sepia-chronicle': { primary: '#8b5a2b', secondary: '#5c4033' },
  'monastery-green': { primary: '#4a6741', secondary: '#8b6508' },
  'prussian-ink': { primary: '#003153', secondary: '#c41e3a' },
  'coral-harbor': { primary: '#fe5f55', secondary: '#f19a3e' },
};

export default function SettingsContent() {
  const { palette, mode, setPalette, toggleMode } = useTheme();

  return (
    <div className="space-y-8">
      {/* Theme Palette Selection - Visual Grid */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Theme Palette
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Choose a color scheme that suits your reading environment
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEME_PALETTES.map((theme) => {
            const isSelected = palette === theme.value;
            const colors = PALETTE_COLORS[theme.value];

            return (
              <button
                key={theme.value}
                onClick={() => setPalette(theme.value)}
                className={cn(
                  'group relative p-4 rounded-book border text-left transition-all duration-300',
                  'hover:shadow-warm hover:-translate-y-0.5',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)]',
                  isSelected
                    ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)] shadow-warm'
                    : 'border-[var(--border-default)] bg-[var(--surface-secondary)] hover:border-[var(--border-strong)]'
                )}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[var(--accent-gold)] flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}

                {/* Color swatches */}
                <div className="flex gap-2 mb-3">
                  <div
                    className="w-8 h-8 rounded-full shadow-inner border border-black/10"
                    style={{ backgroundColor: colors.primary }}
                  />
                  <div
                    className="w-8 h-8 rounded-full shadow-inner border border-black/10"
                    style={{ backgroundColor: colors.secondary }}
                  />
                </div>

                {/* Theme info */}
                <div className="space-y-0.5">
                  <span className={cn(
                    'font-ui font-medium text-sm block',
                    isSelected ? 'text-[var(--accent-gold)]' : 'text-[var(--text-primary)]'
                  )}>
                    {theme.label}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {theme.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Divider */}
      <div className="flourish-divider" />

      {/* Appearance Mode Toggle */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Appearance
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Switch between light and dark modes
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Light mode button */}
          <button
            onClick={() => mode !== 'light' && toggleMode()}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-book border transition-all duration-300',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)]',
              mode === 'light'
                ? 'bg-[var(--accent-gold)] border-[var(--accent-gold)] text-white shadow-warm'
                : 'bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]'
            )}
          >
            <Sun className="h-4 w-4" />
            <span className="font-ui text-sm font-medium">Light</span>
          </button>

          {/* Dark mode button */}
          <button
            onClick={() => mode !== 'dark' && toggleMode()}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-book border transition-all duration-300',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)]',
              mode === 'dark'
                ? 'bg-[var(--accent-gold)] border-[var(--accent-gold)] text-white shadow-warm'
                : 'bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]'
            )}
          >
            <Moon className="h-4 w-4" />
            <span className="font-ui text-sm font-medium">Dark</span>
          </button>
        </div>
      </section>

      {/* Divider */}
      <div className="flourish-divider" />

      {/* Text Reveal Animation */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Animations
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Customize how content appears on screen
          </p>
        </div>
        <TextRevealSettings />
      </section>

      {/* Divider */}
      <div className="flourish-divider" />

      {/* Live Theme Preview */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Preview
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            See how your selected theme looks
          </p>
        </div>

        <div className="p-6 rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture space-y-4">
          {/* Accent color bars */}
          <div className="flex gap-2">
            <div className="flex-1 h-3 rounded-full bg-[var(--accent-gold)]" />
            <div className="flex-1 h-3 rounded-full bg-[var(--accent-copper)]" />
          </div>

          {/* Typography preview */}
          <div className="space-y-2">
            <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Sample Heading
            </h3>
            <p className="font-body text-sm text-[var(--text-secondary)] leading-relaxed">
              This is how body text appears with your current theme settings. The scholarly aesthetic emphasizes readability and warmth.
            </p>
            <p className="font-ui text-xs text-[var(--text-muted)]">
              Muted caption text
            </p>
          </div>

          {/* Button preview */}
          <div className="flex gap-2 pt-2">
            <span className="inline-flex items-center px-3 py-1.5 rounded-page text-xs font-ui font-medium bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-white shadow-warm-sm">
              Primary
            </span>
            <span className="inline-flex items-center px-3 py-1.5 rounded-page text-xs font-ui font-medium border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
              Secondary
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
