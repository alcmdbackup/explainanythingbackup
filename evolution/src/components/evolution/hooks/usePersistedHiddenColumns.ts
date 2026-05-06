// SSR-safe localStorage-backed Set<string> state for column-visibility pickers.
// Extracted from runs/page.tsx so the same dual-effect pattern (load-after-mount
// + write-after-load) doesn't get re-implemented per page.
//
// Fix #51 (use_playwright_find_ux_issues_bugs_20260501): used by both
// runs/page.tsx and arena/[topicId]/page.tsx.

'use client';

import { useEffect, useState } from 'react';

/**
 * Returns [hidden, setHidden] for a Set<string> persisted to
 * `window.localStorage[storageKey]` as a JSON array.
 *
 * Initial render is always an empty Set (matches SSR) so there's no hydration
 * mismatch. The persisted value is loaded in useEffect after mount, then a
 * second effect persists subsequent updates. Trade-off: a brief flash of "all
 * columns visible" on first paint before the saved subset snaps in.
 */
export function usePersistedHiddenColumns(storageKey: string): [Set<string>, (next: Set<string>) => void] {
  const [hidden, setHiddenState] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);

  // Load persisted state after mount (avoids SSR/CSR mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setHiddenState(new Set(JSON.parse(raw) as string[]));
    } catch {
      // localStorage unavailable or value corrupt — ignore.
    }
    setLoaded(true);
  }, [storageKey]);

  // Persist subsequent updates, but only after the initial load — otherwise the
  // empty initializer would overwrite the saved subset before the load effect
  // has run.
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(hidden)));
    } catch {
      // ignore
    }
  }, [hidden, loaded, storageKey]);

  return [hidden, setHiddenState];
}
