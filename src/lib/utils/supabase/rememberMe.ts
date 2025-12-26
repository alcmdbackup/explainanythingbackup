/**
 * Remember Me preference management for Supabase auth session storage.
 *
 * Controls whether auth tokens are stored in localStorage (persists across
 * browser restarts) or sessionStorage (cleared when browser closes).
 */

const REMEMBER_ME_KEY = 'supabase_remember_me';

/**
 * Get the current remember me preference.
 * Defaults to true (localStorage) if no preference is stored.
 */
export function getRememberMe(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(REMEMBER_ME_KEY) !== 'false';
}

/**
 * Set the remember me preference.
 * @param value - true for localStorage (persist), false for sessionStorage (session-only)
 */
export function setRememberMe(value: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REMEMBER_ME_KEY, String(value));
}

/**
 * Clear the remember me preference (used on logout).
 */
export function clearRememberMe(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(REMEMBER_ME_KEY);
}

/**
 * Clear Supabase auth data from localStorage.
 * Used when switching from remembered to non-remembered session.
 */
export function clearSupabaseLocalStorage(): void {
  if (typeof window === 'undefined') return;
  // Supabase stores auth data with keys starting with 'sb-'
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('sb-')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
