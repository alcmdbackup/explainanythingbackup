/**
 * Panel Variant Context
 *
 * Manages the selected styling variant for AIEditorPanel and AdvancedAIEditorModal.
 * Variants only apply when Midnight Scholar theme is active.
 */
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { type PanelVariant, getVariantStyles, type VariantStyles } from '@/components/ai-panel-variants';

interface PanelVariantContextValue {
  variant: PanelVariant;
  setVariant: (v: PanelVariant) => void;
  styles: VariantStyles;
  isVariantActive: boolean; // Only true when Midnight Scholar is selected
}

const PanelVariantContext = createContext<PanelVariantContextValue | undefined>(undefined);

const STORAGE_KEY = 'ai-panel-variant';
const THEME_STORAGE_KEY = 'theme-palette';

export function PanelVariantProvider({ children }: { children: React.ReactNode }) {
  const [variant, setVariantState] = useState<PanelVariant>('mono');
  const [palette, setPalette] = useState<string>('midnight-scholar');
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const storedVariant = localStorage.getItem(STORAGE_KEY) as PanelVariant | null;
    if (storedVariant) {
      setVariantState(storedVariant);
    }
    // Read theme palette from localStorage (written by ThemeProvider)
    const storedPalette = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedPalette) {
      setPalette(storedPalette);
    }
    setMounted(true);
  }, []);

  // Subscribe to palette changes via localStorage events
  useEffect(() => {
    if (!mounted) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        setPalette(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Also poll for changes (same-tab updates don't trigger storage events)
    const checkPalette = () => {
      const currentPalette = localStorage.getItem(THEME_STORAGE_KEY);
      if (currentPalette && currentPalette !== palette) {
        setPalette(currentPalette);
      }
    };
    const interval = setInterval(checkPalette, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [mounted, palette]);

  const setVariant = useCallback((v: PanelVariant) => {
    setVariantState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }, []);

  // Variants only active when Midnight Scholar is selected AND mounted
  // (to prevent hydration mismatch, assume active until mounted)
  const isVariantActive = mounted ? palette === 'midnight-scholar' : true;

  // Get styles - use mono if not on Midnight Scholar or not yet mounted
  const styles = getVariantStyles(isVariantActive ? variant : 'mono');

  // Always wrap with Provider to ensure context is available
  // Use default 'mono' styles before mounting to prevent hydration mismatch
  return (
    <PanelVariantContext.Provider value={{ variant, setVariant, styles, isVariantActive }}>
      {children}
    </PanelVariantContext.Provider>
  );
}

export function usePanelVariant() {
  const context = useContext(PanelVariantContext);
  if (context === undefined) {
    throw new Error('usePanelVariant must be used within a PanelVariantProvider');
  }
  return context;
}
