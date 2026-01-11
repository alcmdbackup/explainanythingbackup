/**
 * @jest-environment node
 */

import { POST, OPTIONS } from './route';
import { NextRequest, NextResponse } from 'next/server';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Suppress console.error noise in test output (jest.setup.js already handles this)

describe('/api/traces', () => {
  let originalEndpoint: string | undefined;
  let originalHeaders: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    originalHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  });

  afterEach(() => {
    if (originalEndpoint !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    }
    if (originalHeaders !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = originalHeaders;
    } else {
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    }
  });

  describe('POST', () => {
    it('should return 503 when OTEL_EXPORTER_OTLP_ENDPOINT is not configured', async () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

      const request = createMockRequest(new Uint8Array([1, 2, 3]));
      const response = await POST(request);

      expect(response).toBeInstanceOf(NextResponse);
      expect(response.status).toBe(503);

      const json = await response.json();
      expect(json).toEqual({ error: 'OTEL_EXPORTER_OTLP_ENDPOINT not configured' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should forward traces to OTLP endpoint', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic abc123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const traceData = new Uint8Array([1, 2, 3, 4, 5]);
      const request = createMockRequest(traceData, 'application/x-protobuf');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://otlp.example.com/v1/traces',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-protobuf',
            Authorization: 'Basic abc123',
          },
          body: expect.any(ArrayBuffer),
        }
      );
    });

    it('should use default content-type when not provided', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(new Uint8Array([1, 2, 3]));
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/x-protobuf',
          }),
        })
      );
    });

    it('should handle JSON content-type', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(
        new TextEncoder().encode('{"traces":[]}'),
        'application/json'
      );
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should parse multiple headers from OTEL_EXPORTER_OTLP_HEADERS', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        'Authorization=Basic abc123,X-Custom-Header=value123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(new Uint8Array([1]));
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic abc123',
            'X-Custom-Header': 'value123',
          }),
        })
      );
    });

    it('should handle headers with equals signs in values', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
      // Base64 tokens often contain '=' padding
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dXNlcjpwYXNz==';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(new Uint8Array([1]));
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic dXNlcjpwYXNz==',
          }),
        })
      );
    });

    it('should work without OTEL_EXPORTER_OTLP_HEADERS', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(new Uint8Array([1]));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-protobuf',
          },
        })
      );
    });

    it('should return error when OTLP backend rejects the request', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: jest.fn().mockResolvedValue('Invalid credentials'),
      });

      const request = createMockRequest(new Uint8Array([1]));
      const response = await POST(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json).toEqual({
        error: 'Failed to forward traces',
        details: 'Invalid credentials',
      });
    });

    it('should return 500 on fetch errors', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const request = createMockRequest(new Uint8Array([1]));
      const response = await POST(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json).toEqual({ error: 'Internal error forwarding traces' });
    });

    it('should handle Honeycomb header format (x-honeycomb-team)', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://api.honeycomb.io';
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-honeycomb-team=abc123xyz';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest(new Uint8Array([1, 2, 3]));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.honeycomb.io/v1/traces',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-honeycomb-team': 'abc123xyz',
          }),
        })
      );
    });

    it('should handle different HTTP error statuses from OTLP backend', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

      const testCases = [
        { status: 400, statusText: 'Bad Request' },
        { status: 403, statusText: 'Forbidden' },
        { status: 429, statusText: 'Too Many Requests' },
        { status: 500, statusText: 'Internal Server Error' },
      ];

      for (const { status, statusText } of testCases) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status,
          statusText,
          text: jest.fn().mockResolvedValue(`Error: ${statusText}`),
        });

        const request = createMockRequest(new Uint8Array([1]));
        const response = await POST(request);

        expect(response.status).toBe(status);
      }
    });
  });

  describe('OPTIONS', () => {
    it('should return CORS headers for preflight requests', async () => {
      const response = await OPTIONS();

      expect(response).toBeInstanceOf(NextResponse);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });
  });
});

/**
 * Helper to create a mock NextRequest with ArrayBuffer body
 */
function createMockRequest(
  body: Uint8Array,
  contentType?: string
): NextRequest {
  const headers = new Headers();
  if (contentType) {
    headers.set('content-type', contentType);
  }

  return {
    arrayBuffer: jest.fn().mockResolvedValue(body.buffer),
    headers: {
      get: (name: string) => headers.get(name),
    },
  } as unknown as NextRequest;
}
