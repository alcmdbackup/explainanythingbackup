'use client';

/**
 * PanelVariantContext - Manages AI Editor Panel design variant selection.
 *
 * Resolution priority (first match wins):
 *   1. URL search param `?panelVariant=…` (for A/B testing, shareable)
 *   2. localStorage `ai-panel-variant` (per-user preference)
 *   3. DEFAULT_PANEL_VARIANT
 *
 * URL param is re-evaluated on every navigation. setVariant() still writes to
 * localStorage so user preference persists across sessions when no URL param
 * is present.
 */

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  PanelVariant,
  PANEL_VARIANTS,
  DEFAULT_PANEL_VARIANT,
  resolvePanelVariant,
  type PanelVariantConfig,
} from '@/components/ai-panel-variants';

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
  const searchParams = useSearchParams();
  const urlVariantRaw = searchParams.get('panelVariant');

  const [storedVariant, setStoredVariant] = useState<PanelVariant>(DEFAULT_PANEL_VARIANT);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount — defensive: hasOwnProperty.call instead
  // of `in` (the same Object.prototype-key attack that affected
  // editor-panel-variants applies here for localStorage).
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && Object.prototype.hasOwnProperty.call(PANEL_VARIANTS, stored)) {
      setStoredVariant(stored as PanelVariant);
    }
    setIsHydrated(true);
  }, []);

  // URL param wins, then localStorage, then default. resolvePanelVariant
  // returns DEFAULT for unknown / null / Object.prototype keys.
  const variant: PanelVariant = useMemo(() => {
    if (urlVariantRaw) return resolvePanelVariant(urlVariantRaw);
    return isHydrated ? storedVariant : DEFAULT_PANEL_VARIANT;
  }, [urlVariantRaw, storedVariant, isHydrated]);

  // setVariant writes to localStorage; URL param (if any) still takes
  // precedence on next render.
  const setVariant = (newVariant: PanelVariant) => {
    setStoredVariant(newVariant);
    localStorage.setItem(STORAGE_KEY, newVariant);
  };

  const config = PANEL_VARIANTS[variant];

  const value: PanelVariantContextType = {
    variant,
    setVariant,
    config,
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
