import { useState, useEffect, useCallback } from 'react';
import { TextRevealEffect, isValidTextRevealEffect } from '@/lib/textRevealAnimations';

const STORAGE_KEY = 'text-reveal-animation';
const DEFAULT_EFFECT: TextRevealEffect = 'none';

/**
 * Hook to manage text reveal animation settings in localStorage
 * @returns { effect, setEffect, isLoaded }
 */
export function useTextRevealSettings() {
  const [effect, setEffectState] = useState<TextRevealEffect>(DEFAULT_EFFECT);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && isValidTextRevealEffect(stored)) {
        setEffectState(stored);
      }
    } catch (e) {
      console.warn('Failed to read text reveal settings from localStorage:', e);
    }
    setIsLoaded(true);
  }, []);

  const setEffect = useCallback((newEffect: TextRevealEffect) => {
    setEffectState(newEffect);
    try {
      localStorage.setItem(STORAGE_KEY, newEffect);
    } catch (e) {
      console.warn('Failed to save text reveal settings to localStorage:', e);
    }
  }, []);

  return { effect, setEffect, isLoaded };
}
