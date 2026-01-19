/**
 * Next.js instrumentation hook for OpenTelemetry and Sentry integration.
 * Initializes tracing, logging, and error tracking for the application.
 */
import * as Sentry from '@sentry/nextjs';
import type { Tracer, Span } from '@opentelemetry/api';

// Lazy-initialized tracers (created after Sentry sets up OpenTelemetry)
let llmTracer: Tracer | null = null;
let dbTracer: Tracer | null = null;
let vectorTracer: Tracer | null = null;
let appTracer: Tracer | null = null;
let traceModule: typeof import('@opentelemetry/api') | null = null;

export async function register() {
  // Production safeguard: FAST_DEV must NEVER run in production
  if (process.env.NODE_ENV === 'production' && process.env.FAST_DEV === 'true' && !process.env.CI) {
    console.error('FATAL: FAST_DEV cannot be enabled in production');
    return; // Graceful degradation instead of crash
  }

  // FAST_DEV mode: Skip all observability initialization for faster local development
  if (process.env.FAST_DEV === 'true') {
    console.log('⚡ FAST_DEV: Skipping OpenTelemetry and Sentry initialization');
    return;
  }

  console.log('🔧 Next.js instrumentation hook registered')

  // Initialize Sentry based on runtime (MUST be first, before any OpenTelemetry usage)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    console.log('🛡️ Sentry server config loaded');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
    console.log('🛡️ Sentry edge config loaded');
  }

  // NOW import OpenTelemetry and create tracers (after Sentry has set it up)
  traceModule = await import('@opentelemetry/api');
  const { trace } = traceModule;

  llmTracer = trace.getTracer('explainanything-llm');
  dbTracer = trace.getTracer('explainanything-database');
  vectorTracer = trace.getTracer('explainanything-vector');
  appTracer = trace.getTracer('explainanything-application');

  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 OpenTelemetry custom instrumentation enabled')
    console.log('📡 Traces going to:', process.env.OTEL_EXPORTER_OTLP_ENDPOINT)

    // Initialize automatic server logging system (Node.js runtime only)
    if (process.env.NEXT_RUNTIME !== 'edge') {
      try {
        const { initializeAutoLogging } = await import('@/lib/logging/server/automaticServerLoggingBase');
        initializeAutoLogging();
        console.log('🔧 Automatic logging system initialized');
      } catch (error) {
        console.warn('⚠️ Failed to initialize automatic logging:', error);
      }
    } else {
      console.log('⚠️ Automatic logging skipped (Edge Runtime detected)');
    }
  }

  // Instrument global fetch for additional API call tracking
  if (typeof global !== 'undefined' && global.fetch) {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      // Only trace external API calls (Pinecone, etc.)
      // Note: vectorTracer/dbTracer are guaranteed non-null here because they were initialized above
      if (url.includes('pinecone.io')) {
        console.log('🔍 Tracing Pinecone fetch call:', url);
        return vectorTracer!.startActiveSpan(`fetch ${url}`, async (span) => {
          span.setAttributes({
            'http.method': init?.method || 'GET',
            'http.url': url,
            'http.target.service': 'pinecone',
            'pinecone.api.type': url.includes('/query') ? 'query' : url.includes('/upsert') ? 'upsert' : 'other'
          });

          try {
            const response = await originalFetch(input, init);
            span.setAttributes({
              'http.status_code': response.status,
              'http.response.size': response.headers.get('content-length') || '0'
            });
            return response;
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
          } finally {
            span.end();
          }
        });
      } else if (url.includes('supabase.co')) {
        console.log('🗄️ Tracing Supabase call:', url);
        return dbTracer!.startActiveSpan(`fetch ${url}`, async (span) => {
          span.setAttributes({
            'http.method': init?.method || 'GET',
            'http.url': url,
            'http.target.service': 'supabase'
          });

          try {
            const response = await originalFetch(input, init);
            span.setAttributes({
              'http.status_code': response.status,
              'http.response.size': response.headers.get('content-length') || '0'
            });
            return response;
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
          } finally {
            span.end();
          }
        });
      }

      return originalFetch(input, init);
    };
  }

  // Set up error tracking (only in Node.js runtime, not Edge Runtime)
  if (typeof process !== 'undefined' &&
      typeof process.on === 'function' &&
      process.env.NEXT_RUNTIME !== 'edge') {
    process.on('unhandledRejection', (reason) => {
      const span = traceModule?.trace.getActiveSpan();
      if (span) {
        span.recordException(reason as Error);
        span.setStatus({ code: 2, message: 'Unhandled promise rejection' });
      }
    });
  }
}

// No-op span for FAST_DEV mode - implements minimal Span interface
const noopSpan: Span = {
  spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
  setAttribute: () => noopSpan,
  setAttributes: () => noopSpan,
  addEvent: () => noopSpan,
  addLink: () => noopSpan,
  addLinks: () => noopSpan,
  setStatus: () => noopSpan,
  updateName: () => noopSpan,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
};

// Export utility functions for custom spans in your application code
// Returns no-op span when FAST_DEV is enabled (tracers not initialized)
export function createLLMSpan(name: string, attributes: Record<string, string | number>): Span {
  if (!llmTracer) return noopSpan;
  return llmTracer.startSpan(name, { attributes });
}

export function createDBSpan(name: string, attributes: Record<string, string | number>): Span {
  if (!dbTracer) return noopSpan;
  return dbTracer.startSpan(name, { attributes });
}

export function createVectorSpan(name: string, attributes: Record<string, string | number>): Span {
  if (!vectorTracer) return noopSpan;
  return vectorTracer.startSpan(name, { attributes });
}

export function createAppSpan(name: string, attributes: Record<string, string | number>): Span {
  if (!appTracer) return noopSpan;
  return appTracer.startSpan(name, { attributes });
}

// Capture React Server Component errors for Sentry
// This is required for proper error reporting in RSC
export const onRequestError = Sentry.captureRequestError;
