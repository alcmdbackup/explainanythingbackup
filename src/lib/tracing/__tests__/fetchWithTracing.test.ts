/**
 * Tests for fetchWithTracing module
 */

import { context, propagation, trace, SpanKind } from '@opentelemetry/api';

// Mock OpenTelemetry API
jest.mock('@opentelemetry/api', () => {
  const mockSpan = {
    setAttribute: jest.fn(),
    recordException: jest.fn(),
    end: jest.fn(),
  };

  const mockTracer = {
    startActiveSpan: jest.fn((name: string, fn: (span: typeof mockSpan) => Promise<unknown>) => fn(mockSpan)),
  };

  return {
    trace: {
      getTracer: jest.fn(() => mockTracer),
    },
    context: {
      active: jest.fn(() => ({})),
    },
    propagation: {
      inject: jest.fn((ctx: unknown, headers: Record<string, string>) => {
        headers['traceparent'] = '00-12345678901234567890123456789012-1234567890123456-01';
      }),
    },
    SpanKind: {
      CLIENT: 'CLIENT',
    },
  };
});

describe('fetchWithTracing', () => {
  let mockFetch: jest.Mock;
  let mockSpan: {
    setAttribute: jest.Mock;
    recordException: jest.Mock;
    end: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock global fetch
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    global.fetch = mockFetch;

    // Get reference to mock span
    mockSpan = {
      setAttribute: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    };

    const mockTracer = {
      startActiveSpan: jest.fn((name: string, fn: (span: typeof mockSpan) => Promise<unknown>) => fn(mockSpan)),
    };

    (trace.getTracer as jest.Mock).mockReturnValue(mockTracer);
  });

  describe('fetchWithTracing', () => {
    it('should inject traceparent header', async () => {
      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test', { method: 'GET' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            traceparent: expect.any(String),
          }),
        })
      );
    });

    it('should preserve existing headers', async () => {
      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
            traceparent: expect.any(String),
          }),
        })
      );
    });

    it('should set span attributes on success', async () => {
      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test', { method: 'POST' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.url', '/api/test');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.method', 'POST');
    });

    it('should default to GET method', async () => {
      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.method', 'GET');
    });

    it('should mark error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('error', true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.error', 'Not Found');
    });

    it('should record exception on fetch error', async () => {
      const testError = new Error('Network error');
      mockFetch.mockRejectedValueOnce(testError);

      const { fetchWithTracing } = await import('../fetchWithTracing');

      await expect(fetchWithTracing('/api/test')).rejects.toThrow('Network error');

      expect(mockSpan.recordException).toHaveBeenCalledWith(testError);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('error', true);
    });

    it('should always end the span', async () => {
      const { fetchWithTracing } = await import('../fetchWithTracing');

      await fetchWithTracing('/api/test');

      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should end span even on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { fetchWithTracing } = await import('../fetchWithTracing');

      await expect(fetchWithTracing('/api/test')).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('createTracedFetch', () => {
    it('should create a traced fetch with custom tracer name', async () => {
      const { createTracedFetch } = await import('../fetchWithTracing');

      const customFetch = createTracedFetch('custom-tracer');
      await customFetch('/api/test');

      expect(trace.getTracer).toHaveBeenCalledWith('custom-tracer');
    });

    it('should behave like fetchWithTracing', async () => {
      const { createTracedFetch } = await import('../fetchWithTracing');

      const customFetch = createTracedFetch('custom-tracer');
      await customFetch('/api/test', { method: 'POST' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            traceparent: expect.any(String),
          }),
        })
      );
    });
  });

  describe('getTraceContextHeaders', () => {
    it('should return trace context headers', async () => {
      const { getTraceContextHeaders } = await import('../fetchWithTracing');

      const headers = getTraceContextHeaders();

      expect(headers).toHaveProperty('traceparent');
      expect(propagation.inject).toHaveBeenCalled();
    });
  });
});
