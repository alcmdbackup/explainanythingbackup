'use client';

import { useTheme, THEME_PALETTES, type ThemePalette } from '@/contexts/ThemeContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextRevealSettings } from '@/components/TextRevealSettings';

export default function SettingsContent() {
  const { palette, mode, setPalette, toggleMode } = useTheme();

  return (
    <div className="scholar-card p-6 space-y-6">
      {/* Theme Palette Selection */}
      <div className="space-y-3">
        <label className="atlas-ui text-sm font-medium text-[var(--text-primary)]">
          Theme Palette
        </label>
        <Select value={palette} onValueChange={(value) => setPalette(value as ThemePalette)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a theme" />
          </SelectTrigger>
          <SelectContent>
            {THEME_PALETTES.map((theme) => (
              <SelectItem key={theme.value} value={theme.value}>
                <div className="flex flex-col">
                  <span className="font-medium">{theme.label}</span>
                  <span className="text-xs text-[var(--text-muted)]">{theme.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Light/Dark Mode Toggle */}
      <div className="space-y-3">
        <label className="atlas-ui text-sm font-medium text-[var(--text-primary)]">
          Appearance
        </label>
        <div className="flex items-center gap-4">
          <Button
            variant={mode === 'light' ? 'default' : 'outline'}
            size="sm"
            onClick={() => toggleMode()}
            className="flex items-center gap-2"
          >
            {mode === 'light' ? (
              <>
                <Sun className="h-4 w-4" />
                Light
              </>
            ) : (
              <>
                <Moon className="h-4 w-4" />
                Dark
              </>
            )}
          </Button>
          <span className="text-sm text-[var(--text-muted)]">
            Click to switch to {mode === 'light' ? 'dark' : 'light'} mode
          </span>
        </div>
      </div>

      {/* Text Reveal Animation */}
      <div className="space-y-3">
        <TextRevealSettings />
      </div>

      {/* Theme Preview */}
      <div className="space-y-3 pt-4 border-t border-[var(--border-default)]">
        <label className="atlas-ui text-sm font-medium text-[var(--text-primary)]">
          Preview
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-default)]">
            <div className="w-full h-2 rounded bg-[var(--accent-gold)] mb-2" />
            <div className="w-3/4 h-2 rounded bg-[var(--accent-copper)]" />
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-default)]">
            <p className="text-sm text-[var(--text-primary)]">Primary Text</p>
            <p className="text-xs text-[var(--text-secondary)]">Secondary Text</p>
            <p className="text-xs text-[var(--text-muted)]">Muted Text</p>
          </div>
        </div>
      </div>
    </div>
  );
}
