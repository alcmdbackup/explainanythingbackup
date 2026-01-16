'use client';

/**
 * PanelVariantContext - Manages AI Editor Panel design variant selection
 * Persists choice to localStorage for user preference retention
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { PanelVariant, PANEL_VARIANTS, DEFAULT_PANEL_VARIANT, type PanelVariantConfig } from '@/components/ai-panel-variants';

const STORAGE_KEY = 'ai-panel-variant';

interface PanelVariantContextType {
  variant: PanelVariant;
  setVariant: (variant: PanelVariant) => void;
  config: PanelVariantConfig;
}

const PanelVariantContext = createContext<PanelVariantContextType | undefined>(undefined);

interface PanelVariantProviderProps {
  children: ReactNode;
}

export function PanelVariantProvider({ children }: PanelVariantProviderProps) {
  const [variant, setVariantState] = useState<PanelVariant>(DEFAULT_PANEL_VARIANT);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in PANEL_VARIANTS) {
      setVariantState(stored as PanelVariant);
    }
    setIsHydrated(true);
  }, []);

  // Save to localStorage when variant changes
  const setVariant = (newVariant: PanelVariant) => {
    setVariantState(newVariant);
    localStorage.setItem(STORAGE_KEY, newVariant);
  };

  const config = PANEL_VARIANTS[variant];

  // Prevent hydration mismatch by using default until client-side hydration
  const value: PanelVariantContextType = {
    variant: isHydrated ? variant : DEFAULT_PANEL_VARIANT,
    setVariant,
    config: isHydrated ? config : PANEL_VARIANTS[DEFAULT_PANEL_VARIANT],
  };

  return (
    <PanelVariantContext.Provider value={value}>
      {children}
    </PanelVariantContext.Provider>
  );
}

export function usePanelVariant(): PanelVariantContextType {
  const context = useContext(PanelVariantContext);
  if (context === undefined) {
    throw new Error('usePanelVariant must be used within a PanelVariantProvider');
  }
  return context;
}

// Export hook for optional usage (won't throw if outside provider)
export function usePanelVariantOptional(): PanelVariantContextType | undefined {
  return useContext(PanelVariantContext);
}
