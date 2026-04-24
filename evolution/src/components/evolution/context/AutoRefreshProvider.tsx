'use client';
// Shared auto-refresh context for evolution run detail tabs.
// Provides a synchronized refresh tick so all tabs update in unison,
// with tab visibility awareness and manual refresh support.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

interface AutoRefreshContextValue {
  /** Increments on each refresh tick. Use as useEffect dependency to trigger refetch. */
  refreshKey: number;
  /** When the last successful refresh completed. */
  lastRefreshed: Date | null;
  /** Whether auto-refresh is active (run is in progress). */
  isActive: boolean;
  /** Manually trigger an immediate refresh across all tabs. */
  triggerRefresh: () => void;
  /** Call after a successful data fetch to update the indicator timestamp. */
  reportRefresh: () => void;
  /** Call on fetch failure to show a toast notification. */
  reportError: (message: string) => void;
}

const FALLBACK: AutoRefreshContextValue = {
  refreshKey: 0,
  lastRefreshed: null,
  isActive: false,
  triggerRefresh: () => {},
  reportRefresh: () => {},
  reportError: () => {},
};

const AutoRefreshContext = createContext<AutoRefreshContextValue>(FALLBACK);

/** Hook to access shared refresh state. Returns safe fallback if used outside the provider. */
export function useAutoRefresh(): AutoRefreshContextValue {
  return useContext(AutoRefreshContext);
}

export function AutoRefreshProvider({
  children,
  isActive,
  intervalMs = 5000,
}: {
  children: ReactNode;
  isActive: boolean;
  intervalMs?: number;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const wasActiveRef = useRef(isActive);

  // Trigger one final refresh when run completes (isActive transitions true→false).
  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      setRefreshKey(k => k + 1);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  // Auto-increment refreshKey on interval for active runs.
  // Pauses when tab is hidden; triggers immediate refresh on visibility restore.
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => setRefreshKey(k => k + 1), intervalMs);

    const handleVisibility = () => {
      if (!document.hidden) {
        setRefreshKey(k => k + 1);
      }
    };
    // B095: `visibilitychange` fires on hide/unhide but NOT on same-tab back/forward
    // navigation — the tab stays visible across history traversal, so a user navigating
    // away from a run-detail page and back a minute later sees stale data until the
    // next poll tick. `pageshow` fires on every show, including bfcache restores, so
    // listening to it in addition ensures an immediate refresh on history navigation.
    const handlePageShow = () => {
      setRefreshKey(k => k + 1);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [isActive, intervalMs]);

  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const reportRefresh = useCallback(() => setLastRefreshed(new Date()), []);

  const reportError = useCallback((message: string) => {
    toast.error(`Refresh failed: ${message}`);
  }, []);

  return (
    <AutoRefreshContext.Provider
      value={{ refreshKey, lastRefreshed, isActive, triggerRefresh, reportRefresh, reportError }}
    >
      {children}
    </AutoRefreshContext.Provider>
  );
}

/** Indicator showing "Updated Xs ago" with a manual refresh button. */
export function RefreshIndicator() {
  const { lastRefreshed, isActive, triggerRefresh } = useAutoRefresh();
  const [ago, setAgo] = useState('');

  useEffect(() => {
    if (!lastRefreshed) return;
    const update = () => {
      const secs = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
      if (secs < 5) setAgo('just now');
      else if (secs < 60) setAgo(`${secs}s ago`);
      else setAgo(`${Math.floor(secs / 60)}m ago`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lastRefreshed]);

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]" data-testid="refresh-indicator">
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" title="Auto-refreshing" />
      )}
      {lastRefreshed && <span data-testid="refresh-ago">Updated {ago}</span>}
      <button
        onClick={triggerRefresh}
        className="px-2 py-0.5 rounded border border-[var(--border-default)] hover:bg-[var(--surface-elevated)] transition-colors"
        title="Refresh now"
        data-testid="manual-refresh-btn"
      >
        ↻ Refresh
      </button>
    </div>
  );
}
