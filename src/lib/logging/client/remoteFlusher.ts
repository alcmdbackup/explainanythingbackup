/**
 * Remote Flusher - Batched log sending to server
 *
 * This module periodically flushes logs from localStorage to the
 * /api/client-logs endpoint. It uses:
 * - requestIdleCallback for non-blocking operation
 * - sendBeacon on page hide for reliable delivery
 * - Offline detection to avoid failed requests
 */

const LOG_KEY = 'client_logs';
const FLUSHED_INDEX_KEY = 'client_logs_flushed_index';

interface FlushConfig {
  /** Interval between flush attempts in milliseconds */
  flushIntervalMs: number;
  /** Maximum logs to send per batch */
  batchSize: number;
  /** Endpoint to send logs to */
  endpoint: string;
}

const DEFAULT_CONFIG: FlushConfig = {
  flushIntervalMs: 30_000,
  batchSize: 50,
  endpoint: '/api/client-logs',
};

let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the remote log flusher.
 * Returns a cleanup function for HMR/unmount.
 */
export function initRemoteFlusher(
  config: Partial<FlushConfig> = {}
): () => void {
  if (typeof window === 'undefined') return () => {};

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  let isOnline = navigator.onLine;

  const handleOnline = () => {
    isOnline = true;
  };
  const handleOffline = () => {
    isOnline = false;
  };
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  const scheduleFlush = () => {
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
        () => flushLogs(finalConfig, isOnline)
      );
    } else {
      setTimeout(() => flushLogs(finalConfig, isOnline), 0);
    }
  };

  flushTimer = setInterval(scheduleFlush, finalConfig.flushIntervalMs);

  // Flush on page hide using sendBeacon
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flushLogsSync(finalConfig);
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Async flush logs to remote endpoint.
 */
async function flushLogs(config: FlushConfig, isOnline: boolean): Promise<void> {
  if (!isOnline) return;

  try {
    const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const flushedIndex = parseInt(
      localStorage.getItem(FLUSHED_INDEX_KEY) || '0',
      10
    );

    // Get unflushed logs
    const unFlushed = logs.slice(flushedIndex, flushedIndex + config.batchSize);
    if (unFlushed.length === 0) return;

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        logs: unFlushed,
        source: 'client-flusher',
        timestamp: new Date().toISOString(),
      }),
      // Use low priority to not block critical requests
      priority: 'low' as RequestPriority,
    });

    if (response.ok) {
      // Update flushed index
      const newIndex = flushedIndex + unFlushed.length;
      localStorage.setItem(FLUSHED_INDEX_KEY, String(newIndex));

      // If we've flushed all logs, reset to save space
      if (newIndex >= logs.length) {
        localStorage.removeItem(LOG_KEY);
        localStorage.removeItem(FLUSHED_INDEX_KEY);
      }
    }
  } catch (error) {
    // Silently fail - logs will be retried on next flush
    console.debug('Remote log flush failed:', error);
  }
}

/**
 * Synchronous flush using sendBeacon for page unload.
 */
function flushLogsSync(config: FlushConfig): void {
  if (!navigator.sendBeacon) return;

  try {
    const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const flushedIndex = parseInt(
      localStorage.getItem(FLUSHED_INDEX_KEY) || '0',
      10
    );

    const unFlushed = logs.slice(flushedIndex, flushedIndex + config.batchSize);
    if (unFlushed.length === 0) return;

    const payload = JSON.stringify({
      logs: unFlushed,
      source: 'client-flusher-beacon',
      timestamp: new Date().toISOString(),
    });

    const success = navigator.sendBeacon(config.endpoint, payload);

    if (success) {
      // Update flushed index
      const newIndex = flushedIndex + unFlushed.length;
      localStorage.setItem(FLUSHED_INDEX_KEY, String(newIndex));
    }
  } catch {
    // Silently fail on unload
  }
}

// Type for priority hint in fetch
type RequestPriority = 'high' | 'low' | 'auto';
