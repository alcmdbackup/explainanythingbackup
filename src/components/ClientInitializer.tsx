'use client';

import { useEffect, useRef } from 'react';

/**
 * ClientInitializer - Client-side initialization component
 *
 * This component initializes client-side logging and tracing systems.
 * It must be rendered in a client component context (layout.tsx uses 'use client' children).
 *
 * Initialization order:
 * 1. Console interceptor (synchronous, immediate)
 * 2. Error handlers (synchronous, immediate)
 * 3. Remote flusher (dev only, delayed)
 * 4. Browser tracing (production, deferred via requestIdleCallback)
 */
export function ClientInitializer() {
  const initialized = useRef(false);
  const cleanupFns = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Synchronous init - console interceptor and error handlers
    import('@/lib/logging/client/consoleInterceptor').then(
      ({ initConsoleInterceptor, initErrorHandlers }) => {
        cleanupFns.current.push(initConsoleInterceptor());
        cleanupFns.current.push(initErrorHandlers());
      }
    );

    // Remote flusher (dev only) - flushes logs to /api/client-logs
    if (process.env.NODE_ENV === 'development') {
      import('@/lib/logging/client/remoteFlusher').then(({ initRemoteFlusher }) => {
        cleanupFns.current.push(initRemoteFlusher());
      });
    }

    // Browser tracing (production or when explicitly enabled)
    // Lazy-load OTel after idle to mitigate bundle size (~60KB)
    if ('requestIdleCallback' in window) {
      const idleId = (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(
        async () => {
          const { initBrowserTracing } = await import('@/lib/tracing/browserTracing');
          initBrowserTracing();
        },
        { timeout: 5000 }
      );
      cleanupFns.current.push(() =>
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId)
      );
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(async () => {
        const { initBrowserTracing } = await import('@/lib/tracing/browserTracing');
        initBrowserTracing();
      }, 5000);
    }

    // HMR cleanup
    return () => {
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      initialized.current = false;
    };
  }, []);

  return null;
}
