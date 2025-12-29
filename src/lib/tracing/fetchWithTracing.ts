/**
 * Fetch with Tracing - W3C traceparent header injection
 *
 * This module provides a fetch wrapper that injects W3C trace context headers,
 * enabling distributed tracing between client and server.
 *
 * Usage:
 *   import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';
 *   const response = await fetchWithTracing('/api/endpoint', { method: 'POST' });
 */

import { context, propagation, trace } from '@opentelemetry/api';

/**
 * Wraps fetch to inject W3C traceparent header for distributed tracing.
 *
 * @param input - URL or Request object
 * @param init - Request options
 * @returns Response from fetch
 */
export async function fetchWithTracing(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const tracer = trace.getTracer('browser-fetch');
  const url = typeof input === 'string' ? input : input.toString();

  return tracer.startActiveSpan(`fetch ${url}`, async (span) => {
    try {
      const headers: Record<string, string> = {};

      // Inject W3C trace context (traceparent, tracestate)
      propagation.inject(context.active(), headers);

      const mergedInit: RequestInit = {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers || {}),
        },
      };

      const response = await fetch(input, mergedInit);

      // Record span attributes
      span.setAttribute('http.status_code', response.status);
      span.setAttribute('http.url', url);
      span.setAttribute('http.method', init?.method || 'GET');

      if (!response.ok) {
        span.setAttribute('error', true);
        span.setAttribute('http.error', response.statusText);
      }

      return response;
    } catch (error) {
      span.recordException(error as Error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a traced fetch function with a custom tracer name.
 *
 * @param tracerName - Name for the tracer (appears in traces)
 * @returns A fetch function that injects trace context
 */
export function createTracedFetch(
  tracerName: string
): typeof fetchWithTracing {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const tracer = trace.getTracer(tracerName);
    const url = typeof input === 'string' ? input : input.toString();

    return tracer.startActiveSpan(`fetch ${url}`, async (span) => {
      try {
        const headers: Record<string, string> = {};
        propagation.inject(context.active(), headers);

        const mergedInit: RequestInit = {
          ...init,
          headers: {
            ...headers,
            ...(init?.headers || {}),
          },
        };

        const response = await fetch(input, mergedInit);

        span.setAttribute('http.status_code', response.status);
        span.setAttribute('http.url', url);
        span.setAttribute('http.method', init?.method || 'GET');

        if (!response.ok) {
          span.setAttribute('error', true);
        }

        return response;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute('error', true);
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Type for the traceparent header value.
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 */
export type TraceparentHeader = string;

/**
 * Extract trace context headers for manual injection.
 * Useful when you need to pass trace context through non-fetch mechanisms.
 */
export function getTraceContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}
