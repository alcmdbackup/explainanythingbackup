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
 * 3. Remote flusher (all environments, flushes to /api/client-logs -> Honeycomb)
 * 4. Browser tracing (deferred via requestIdleCallback)
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
    ).catch((err) => {
      console.error('Failed to load console interceptor:', err);
    });

    // Remote flusher - flushes logs to /api/client-logs (which forwards to Honeycomb)
    // In production: only error/warn levels are sent (controlled by logConfig.ts)
    // In development: all levels are sent
    import('@/lib/logging/client/remoteFlusher').then(({ initRemoteFlusher }) => {
      cleanupFns.current.push(initRemoteFlusher());
    }).catch((err) => {
      console.error('Failed to load remote flusher:', err);
    });

    // Web Vitals collection (reports CLS, FCP, LCP, TTFB, INP to Sentry)
    // Initialized early to capture metrics as soon as possible
    // Skip in FAST_DEV mode for faster local development
    if (process.env.NEXT_PUBLIC_FAST_DEV !== 'true') {
      import('@/lib/webVitals').then(({ initWebVitals }) => {
        initWebVitals();
      }).catch((err) => {
        console.error('Failed to load Web Vitals:', err);
      });
    }

    // Browser tracing (production or when explicitly enabled)
    // Skip in FAST_DEV mode for faster local development
    // Lazy-load OTel after idle to mitigate bundle size (~60KB)
    if (process.env.NEXT_PUBLIC_FAST_DEV !== 'true') {
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
