/**
 * Browser Tracing - OpenTelemetry setup for client-side tracing
 *
 * This module provides browser-side distributed tracing using OpenTelemetry.
 * It enables client traces to be visible in Honeycomb, correlated with server traces.
 *
 * Features:
 * - Lazy loading via dynamic imports (reduces bundle impact)
 * - OTLP export via /api/traces proxy (bypasses CORS restrictions)
 *
 * Prerequisites:
 * - NEXT_PUBLIC_ENABLE_BROWSER_TRACING=true (or production mode)
 */

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize browser tracing with OpenTelemetry.
 * Uses dynamic imports for code splitting.
 */
export function initBrowserTracing(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const shouldTrace =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_ENABLE_BROWSER_TRACING === 'true';

    if (!shouldTrace) {
      initialized = true;
      return;
    }

    try {
      // Dynamic imports for code splitting (~60KB gzipped)
      const [
        webTraceModule,
        otlpModule,
        traceBaseModule,
        apiModule,
      ] = await Promise.all([
        import('@opentelemetry/sdk-trace-web'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/sdk-trace-base'),
        import('@opentelemetry/api'),
      ]);

      const { WebTracerProvider } = webTraceModule;
      const { OTLPTraceExporter } = otlpModule;
      const { BatchSpanProcessor, SimpleSpanProcessor } = traceBaseModule;
      const { diag, DiagConsoleLogger, DiagLogLevel } = apiModule;

      // Only show warnings and errors in console
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

      // Use local proxy to bypass CORS restrictions
      // The proxy at /api/traces forwards to the OTLP backend with server-side auth
      const exporter = new OTLPTraceExporter({
        url: '/api/traces',
        headers: {},
      });

      // Create span processor (BatchSpanProcessor for efficiency)
      let spanProcessor;
      try {
        spanProcessor = new BatchSpanProcessor(exporter);
      } catch {
        // Fall back to SimpleSpanProcessor if BatchSpanProcessor fails
        spanProcessor = new SimpleSpanProcessor(exporter);
      }

      // Create provider with span processors in constructor (v2.x API)
      const provider = new WebTracerProvider({
        spanProcessors: [spanProcessor],
      });

      provider.register();
      initialized = true;

      console.debug('Browser tracing initialized (via /api/traces proxy)');
    } catch (error) {
      console.warn('Failed to initialize browser tracing:', error);
      initialized = true;
    }
  })();

  return initPromise;
}

/**
 * Get the tracer for creating spans in client code.
 * Returns a no-op tracer if tracing is not initialized.
 */
export async function getBrowserTracer(): Promise<ReturnType<typeof import('@opentelemetry/api').trace.getTracer>> {
  await initBrowserTracing();

  const { trace } = await import('@opentelemetry/api');
  return trace.getTracer('browser-client');
}

/**
 * Check if browser tracing is initialized.
 */
export function isBrowserTracingInitialized(): boolean {
  return initialized;
}
