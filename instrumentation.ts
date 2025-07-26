import { trace } from '@opentelemetry/api';

// Create custom tracers for different parts of your application
const llmTracer = trace.getTracer('explainanything-llm');
const dbTracer = trace.getTracer('explainanything-database');
const vectorTracer = trace.getTracer('explainanything-vector');
const appTracer = trace.getTracer('explainanything-application');

export async function register() {
  console.log('🔧 Next.js instrumentation hook registered')
  
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 OpenTelemetry custom instrumentation enabled')
    console.log('📡 Traces going to:', process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  }

  // Instrument global fetch for additional API call tracking
  if (typeof global !== 'undefined' && global.fetch) {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      
      // Only trace external API calls (Pinecone, etc.)
      if (url.includes('pinecone.io')) {
        console.log('🔍 Tracing Pinecone fetch call:', url);
        return vectorTracer.startActiveSpan(`fetch ${url}`, async (span) => {
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
        return dbTracer.startActiveSpan(`fetch ${url}`, async (span) => {
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
    process.on('unhandledRejection', (reason, promise) => {
      const span = trace.getActiveSpan();
      if (span) {
        span.recordException(reason as Error);
        span.setStatus({ code: 2, message: 'Unhandled promise rejection' });
      }
    });
  }
}

// Export utility functions for custom spans in your application code
export function createLLMSpan(name: string, attributes: Record<string, string | number>) {
  return llmTracer.startSpan(name, { attributes });
}

export function createDBSpan(name: string, attributes: Record<string, string | number>) {
  return dbTracer.startSpan(name, { attributes });
}

export function createVectorSpan(name: string, attributes: Record<string, string | number>) {
  return vectorTracer.startSpan(name, { attributes });
}

export function createAppSpan(name: string, attributes: Record<string, string | number>) {
  return appTracer.startSpan(name, { attributes });
} 