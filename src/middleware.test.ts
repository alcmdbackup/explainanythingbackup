/**
 * @jest-environment node
 */

/**
 * Tests for main Next.js middleware - delegates to Supabase middleware
 */

// Mock dependencies before imports
jest.mock('@/lib/utils/supabase/middleware');
jest.mock('next/server');

import { middleware, config } from './middleware';
import { updateSession } from '@/lib/utils/supabase/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { NextRequest as MockNextRequest, NextResponse as MockNextResponse } from '@/__mocks__/next/server';

const mockUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;

// Helper to create test requests
function createTestRequest(url: string): NextRequest {
  const mockRequest = new MockNextRequest(url);
  return mockRequest as unknown as NextRequest;
}

describe('Main Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('middleware function', () => {
    it('should call updateSession with the request', async () => {
      const mockResponse = new MockNextResponse(null, { status: 200 });
      mockUpdateSession.mockResolvedValue(mockResponse as unknown as NextResponse);

      const request = createTestRequest('http://localhost:3000/dashboard');

      await middleware(request);

      expect(mockUpdateSession).toHaveBeenCalledWith(request);
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('should return the response from updateSession', async () => {
      const mockResponse = new MockNextResponse(null, { status: 200 });
      mockUpdateSession.mockResolvedValue(mockResponse as unknown as NextResponse);

      const request = createTestRequest('http://localhost:3000/dashboard');

      const response = await middleware(request);

      expect(response).toBe(mockResponse);
    });

    it('should pass through redirect responses from updateSession', async () => {
      const mockRedirect = MockNextResponse.redirect('http://localhost:3000/login');
      mockUpdateSession.mockResolvedValue(mockRedirect as unknown as NextResponse);

      const request = createTestRequest('http://localhost:3000/protected');

      const response = await middleware(request);

      expect(response).toBe(mockRedirect);
      expect(mockUpdateSession).toHaveBeenCalledWith(request);
    });

    it('should handle errors from updateSession', async () => {
      const error = new Error('Supabase error');
      mockUpdateSession.mockRejectedValue(error);

      const request = createTestRequest('http://localhost:3000/dashboard');

      await expect(middleware(request)).rejects.toThrow('Supabase error');
    });
  });

  describe('config matcher', () => {
    it('should have a matcher configuration', () => {
      expect(config).toBeDefined();
      expect(config.matcher).toBeDefined();
      expect(Array.isArray(config.matcher)).toBe(true);
    });

    it('should exclude static assets from middleware', () => {
      const matcher = config.matcher[0];

      // Verify exclusions are present in the pattern
      expect(matcher).toContain('_next/static');
      expect(matcher).toContain('_next/image');
      expect(matcher).toContain('favicon.ico');
      expect(matcher).toContain('error');
      expect(matcher).toContain('api/client-logs');
    });

    it('should exclude image file extensions', () => {
      const matcher = config.matcher[0];

      // Verify image extensions are excluded
      expect(matcher).toContain('svg');
      expect(matcher).toContain('png');
      expect(matcher).toContain('jpg');
      expect(matcher).toContain('jpeg');
      expect(matcher).toContain('gif');
      expect(matcher).toContain('webp');
    });
  });
});
