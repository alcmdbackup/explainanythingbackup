/**
 * @jest-environment node
 */

/**
 * Tests for OAuth callback route - handles authorization code exchange
 */

// Mock dependencies
jest.mock('@/lib/utils/supabase/server');
jest.mock('next/server', () => {
  const mocks = jest.requireActual('@/__mocks__/next/server');
  return {
    NextResponse: mocks.NextResponse,
    NextRequest: mocks.NextRequest,
  };
});
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

import { GET } from './route';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { NextResponse } from 'next/server';
import { createMockRequestWithParams, createSupabaseError } from '@/testing/utils/phase9-test-helpers';
import { logger } from '@/lib/server_utilities';

const mockCreateSupabaseServerClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>;

describe('OAuth Callback Route - GET', () => {
  let mockExchangeCodeForSession: jest.Mock;
  let mockSupabaseClient: any;
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock
    mockExchangeCodeForSession = jest.fn().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });

    mockSupabaseClient = {
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    };

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseClient);
  });

  describe('Successful Authentication', () => {
    it('should exchange code for session and redirect to specified path', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-auth-code',
        next: '/dashboard',
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(response.headers.get('Location')).toBe('http://localhost:3000/dashboard');
    });

    it('should redirect to root when no next parameter provided', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-auth-code',
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
      expect(response.headers.get('Location')).toBe('http://localhost:3000/');
    });

    it('should redirect to root when next is empty string', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-auth-code',
        next: '',
      });

      const response = await GET(request);

      // Empty string goes through sanitizeRedirectPath which returns '/'
      expect(response.headers.get('Location')).toBe('http://localhost:3000/');
    });

    it('should handle nested paths in next parameter', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-auth-code',
        next: '/dashboard/settings/profile',
      });

      const response = await GET(request);

      expect(response.headers.get('Location')).toBe('http://localhost:3000/dashboard/settings/profile');
    });
  });

  describe('Error Handling', () => {
    it('should redirect to error page when code is missing', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {});

      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.headers.get('Location')).toBe('http://localhost:3000/error');
    });

    it('should redirect to error page when code is null', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: '',
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.headers.get('Location')).toBe('http://localhost:3000/error');
    });

    it('should redirect to error page and log when exchange fails', async () => {
      const error = createSupabaseError('Invalid code', 400);
      mockExchangeCodeForSession.mockResolvedValue(error);

      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'invalid-code',
        next: '/dashboard',
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('invalid-code');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error exchanging code for session',
        { error: 'Invalid code' }
      );
      expect(response.headers.get('Location')).toBe('http://localhost:3000/error');
    });

    it('should handle Supabase network errors', async () => {
      mockExchangeCodeForSession.mockRejectedValue(new Error('Network error'));

      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
      });

      await expect(GET(request)).rejects.toThrow('Network error');
    });
  });

  describe('Redirect Security', () => {
    it('should reject external URLs in next parameter and redirect to /', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
        next: 'https://evil.com',
      });

      const response = await GET(request);

      // sanitizeRedirectPath rejects external URLs, falls back to /
      expect(response.headers.get('Location')).toBe('http://localhost:3000/');
    });

    it('should reject protocol-relative URLs in next parameter', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
        next: '//evil.com',
      });

      const response = await GET(request);

      // sanitizeRedirectPath rejects protocol-relative URLs, falls back to /
      expect(response.headers.get('Location')).toBe('http://localhost:3000/');
    });

    it('should preserve query parameters in next path', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
        next: '/dashboard?tab=settings',
      });

      const response = await GET(request);

      expect(response.headers.get('Location')).toBe('http://localhost:3000/dashboard?tab=settings');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long authorization codes', async () => {
      const longCode = 'a'.repeat(1000);
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: longCode,
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(longCode);
      expect(response.status).toBeGreaterThanOrEqual(300);
    });

    it('should handle special characters in code', async () => {
      const specialCode = 'abc-123_DEF.456';
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: specialCode,
      });

      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(specialCode);
    });

    it('should handle special characters in next path', async () => {
      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
        next: '/user/john-doe@example.com',
      });

      const response = await GET(request);

      expect(response.headers.get('Location')).toBe('http://localhost:3000/user/john-doe@example.com');
    });

    it('should handle createSupabaseServerClient throwing error', async () => {
      mockCreateSupabaseServerClient.mockRejectedValue(new Error('Failed to create client'));

      const request = createMockRequestWithParams('http://localhost:3000/auth/callback', {
        code: 'valid-code',
      });

      await expect(GET(request)).rejects.toThrow('Failed to create client');
    });
  });
});
