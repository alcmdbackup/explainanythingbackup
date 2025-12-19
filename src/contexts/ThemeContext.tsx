'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemePalette =
  | 'midnight-scholar'
  | 'venetian-archive'
  | 'oxford-blue'
  | 'sepia-chronicle'
  | 'monastery-green'
  | 'prussian-ink';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  palette: ThemePalette;
  mode: ThemeMode;
  setPalette: (p: ThemePalette) => void;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY_PALETTE = 'theme-palette';
const STORAGE_KEY_MODE = 'theme-mode';

export const THEME_PALETTES: { value: ThemePalette; label: string; description: string }[] = [
  { value: 'midnight-scholar', label: 'Midnight Scholar', description: 'Gold & copper, cream & navy' },
  { value: 'venetian-archive', label: 'Venetian Archive', description: 'Burgundy & hunter green' },
  { value: 'oxford-blue', label: 'Oxford Blue', description: 'Teal & leather brown' },
  { value: 'sepia-chronicle', label: 'Sepia Chronicle', description: 'Burnt sienna & coffee' },
  { value: 'monastery-green', label: 'Monastery Green', description: 'Moss green & antique gold' },
  { value: 'prussian-ink', label: 'Prussian Ink', description: 'Prussian blue & cardinal red' },
];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = useState<ThemePalette>('midnight-scholar');
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const storedPalette = localStorage.getItem(STORAGE_KEY_PALETTE) as ThemePalette | null;
    const storedMode = localStorage.getItem(STORAGE_KEY_MODE) as ThemeMode | null;

    if (storedPalette && THEME_PALETTES.some(t => t.value === storedPalette)) {
      setPaletteState(storedPalette);
    }
    if (storedMode === 'light' || storedMode === 'dark') {
      setModeState(storedMode);
    }
    setMounted(true);
  }, []);

  // Apply classes to document
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    // Remove all theme classes
    THEME_PALETTES.forEach(t => root.classList.remove(`theme-${t.value}`));
    root.classList.remove('dark');

    // Add current theme class
    root.classList.add(`theme-${palette}`);
    if (mode === 'dark') {
      root.classList.add('dark');
    }
  }, [palette, mode, mounted]);

  const setPalette = useCallback((p: ThemePalette) => {
    setPaletteState(p);
    localStorage.setItem(STORAGE_KEY_PALETTE, p);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY_MODE, m);
  }, []);

  const toggleMode = useCallback(() => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
  }, [mode, setMode]);

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ palette, mode, setPalette, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
