// Active-span wrapper extracted to a leaf module so that Agent.ts (pipeline code reachable
// from client-bundle chains via entityRegistry → EntityMetricsTab) doesn't transitively pull
// in instrumentation.ts and its server-only logging deps (server_utilities → 'fs').

import { trace, type Span, type Tracer } from '@opentelemetry/api';

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

let cachedTracer: Tracer | null = null;
function getAppTracer(): Tracer | null {
  if (process.env.FAST_DEV === 'true') return null;
  if (cachedTracer) return cachedTracer;
  cachedTracer = trace.getTracer('explainanything-application');
  return cachedTracer;
}

export async function withActiveSpan<T>(
  name: string,
  attributes: Record<string, string | number>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getAppTracer();
  if (!tracer) return fn(noopSpan);
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
