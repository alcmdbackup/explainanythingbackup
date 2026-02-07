// Context wrapper for auto-polling data refresh with tab visibility awareness.
// Pauses polling when tab is hidden and supports AbortController for in-flight requests.
'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface AutoRefreshContextValue {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  refresh: () => void;
}

const AutoRefreshContext = createContext<AutoRefreshContextValue>({
  lastUpdated: null,
  isRefreshing: false,
  refresh: () => {},
});

export function useAutoRefresh() {
  return useContext(AutoRefreshContext);
}

export function AutoRefreshProvider({
  children,
  onRefresh,
  intervalMs = 15_000,
  enabled = true,
}: {
  children: ReactNode;
  onRefresh: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
}) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const doRefresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRefreshing(true);
    try {
      await onRefreshRef.current(controller.signal);
      if (!controller.signal.aborted) {
        setLastUpdated(new Date());
      }
    } catch {
      // Swallow abort errors silently
    } finally {
      if (!controller.signal.aborted) {
        setIsRefreshing(false);
      }
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (enabled) {
      timerRef.current = setInterval(doRefresh, intervalMs);
    }
  }, [doRefresh, intervalMs, enabled]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
  }, []);

  // Initial load + start polling
  useEffect(() => {
    doRefresh();
    startPolling();

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        doRefresh();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [doRefresh, startPolling, stopPolling]);

  const refresh = useCallback(() => {
    doRefresh();
    startPolling();
  }, [doRefresh, startPolling]);

  return (
    <AutoRefreshContext.Provider value={{ lastUpdated, isRefreshing, refresh }}>
      {children}
    </AutoRefreshContext.Provider>
  );
}

export function RefreshIndicator() {
  const { lastUpdated, isRefreshing, refresh } = useAutoRefresh();
  const seconds = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null;

  return (
    <button
      onClick={refresh}
      className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      data-testid="refresh-indicator"
    >
      {isRefreshing ? (
        <span className="animate-spin">&#8635;</span>
      ) : (
        <span>&#8635;</span>
      )}
      {seconds !== null && <span>Updated {seconds}s ago</span>}
    </button>
  );
}
