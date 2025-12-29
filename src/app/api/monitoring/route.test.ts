/**
 * Integration tests for Sentry tunnel endpoint.
 * This endpoint forwards client-side Sentry events to bypass ad blockers.
 * @jest-environment node
 */

import { POST, OPTIONS } from './route';
import { NextResponse } from 'next/server';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('/api/monitoring (Sentry Tunnel)', () => {
  let originalDSN: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalDSN = process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (originalDSN !== undefined) {
      process.env.SENTRY_DSN = originalDSN;
    } else {
      delete process.env.SENTRY_DSN;
    }
  });

  describe('POST', () => {
    it('should return 200 silently when SENTRY_DSN is not configured', async () => {
      delete process.env.SENTRY_DSN;

      const request = createMockRequest('{"envelope":"data"}');
      const response = await POST(request);

      expect(response).toBeInstanceOf(NextResponse);
      expect(response.status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should forward envelope to Sentry ingest endpoint', async () => {
      process.env.SENTRY_DSN = 'https://abc123@o123456.ingest.sentry.io/789';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const envelopeData = '{"event_id":"abc"}\n{"type":"event"}\n{"message":"test"}';
      const request = createMockRequest(envelopeData);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://o123456.ingest.sentry.io/api/789/envelope/',
        {
          method: 'POST',
          body: envelopeData,
          headers: {
            'Content-Type': 'application/x-sentry-envelope',
          },
        }
      );
    });

    it('should correctly parse DSN and extract project ID', async () => {
      // Test with different DSN format
      process.env.SENTRY_DSN = 'https://key@sentry.io/12345';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest('envelope-data');
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://sentry.io/api/12345/envelope/',
        expect.any(Object)
      );
    });

    it('should forward Sentry response status codes', async () => {
      process.env.SENTRY_DSN = 'https://abc@sentry.io/123';

      const statusCodes = [200, 202, 429];

      for (const status of statusCodes) {
        mockFetch.mockResolvedValueOnce({
          ok: status < 400,
          status,
        });

        const request = createMockRequest('data');
        const response = await POST(request);

        expect(response.status).toBe(status);
      }
    });

    it('should return 500 on fetch errors', async () => {
      process.env.SENTRY_DSN = 'https://abc@sentry.io/123';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const request = createMockRequest('data');
      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentry Tunnel] Error forwarding envelope:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should return 500 on invalid DSN', async () => {
      process.env.SENTRY_DSN = 'not-a-valid-url';

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const request = createMockRequest('data');
      const response = await POST(request);

      expect(response.status).toBe(500);

      consoleSpy.mockRestore();
    });

    it('should handle empty envelope gracefully', async () => {
      process.env.SENTRY_DSN = 'https://abc@sentry.io/123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const request = createMockRequest('');
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '',
        })
      );
    });

    it('should handle rate limiting from Sentry (429)', async () => {
      process.env.SENTRY_DSN = 'https://abc@sentry.io/123';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const request = createMockRequest('data');
      const response = await POST(request);

      // Should forward the 429 status to client
      expect(response.status).toBe(429);
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
 * Helper to create a mock Request with text body
 */
function createMockRequest(body: string): Request {
  return {
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}
