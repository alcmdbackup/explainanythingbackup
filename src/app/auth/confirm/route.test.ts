/**
 * @jest-environment node
 */

/**
 * Tests for email OTP confirmation route - handles email verification
 */

// Mock dependencies before imports
jest.mock('@/lib/utils/supabase/server');
jest.mock('next/navigation', () => {
  const mocks = jest.requireActual('@/__mocks__/next/navigation');
  return {
    redirect: mocks.redirect,
    useRouter: mocks.useRouter,
    usePathname: mocks.usePathname,
    useSearchParams: mocks.useSearchParams,
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
import { redirect } from '@/__mocks__/next/navigation';
import { createMockNextRequest } from '@/__mocks__/next/server';
import { createSupabaseError } from '@/testing/utils/phase9-test-helpers';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/server_utilities';

const mockCreateSupabaseServerClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>;

describe('Email Confirmation Route - GET', () => {
  let mockVerifyOtp: jest.Mock;
  let mockSupabaseClient: any;
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock
    mockVerifyOtp = jest.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });

    mockSupabaseClient = {
      auth: {
        verifyOtp: mockVerifyOtp,
      },
    };

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseClient);
  });

  describe('Successful Verification', () => {
    it('should verify OTP and redirect to specified path', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token-hash',
          type: 'email',
          next: '/dashboard',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /dashboard');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'email',
        token_hash: 'valid-token-hash',
      });
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    });

    it('should redirect to root when no next parameter provided', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token-hash',
          type: 'signup',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'signup',
        token_hash: 'valid-token-hash',
      });
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('should handle email type verification', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'email-token',
          type: 'email',
          next: '/profile',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /profile');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'email',
        token_hash: 'email-token',
      });
    });

    it('should handle signup type verification', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'signup-token',
          type: 'signup',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'signup',
        token_hash: 'signup-token',
      });
    });

    it('should handle recovery type verification', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'recovery-token',
          type: 'recovery',
          next: '/reset-password',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /reset-password');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'recovery',
        token_hash: 'recovery-token',
      });
    });
  });

  describe('Error Handling', () => {
    it('should redirect to error page when token_hash is missing', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should redirect to error page when type is missing', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should redirect to error page when both params are missing', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {},
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should redirect to error and log when verification fails', async () => {
      const error = createSupabaseError('Invalid OTP', 400);
      mockVerifyOtp.mockResolvedValue(error);

      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'expired-token',
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(mockVerifyOtp).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'OTP verification error',
        { error: 'Invalid OTP' }
      );
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should handle Supabase network errors', async () => {
      mockVerifyOtp.mockRejectedValue(new Error('Network error'));

      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('Network error');
    });

    it('should handle invalid EmailOtpType values', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'invalid-type',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT');

      // Invalid type still gets passed to verifyOtp, which should reject it
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'invalid-type',
        token_hash: 'valid-token',
      });
    });
  });

  describe('Redirect Security', () => {
    it('should handle external URLs in next parameter', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'email',
          next: 'https://evil.com',
        },
      }) as unknown as NextRequest;

      // Note: Current implementation doesn't validate redirect URLs
      // This test documents actual behavior
      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: https://evil.com');

      expect(redirect).toHaveBeenCalledWith('https://evil.com');
    });

    it('should handle protocol-relative URLs', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'email',
          next: '//evil.com',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: //evil.com');

      expect(redirect).toHaveBeenCalledWith('//evil.com');
    });

    it('should preserve query parameters in next path', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'email',
          next: '/dashboard?tab=settings&view=list',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /dashboard?tab=settings&view=list');

      expect(redirect).toHaveBeenCalledWith('/dashboard?tab=settings&view=list');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long token hashes', async () => {
      const longToken = 'a'.repeat(1000);
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: longToken,
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'email',
        token_hash: longToken,
      });
    });

    it('should handle special characters in token hash', async () => {
      const specialToken = 'abc-123_DEF.456+789/000==';
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: specialToken,
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        type: 'email',
        token_hash: specialToken,
      });
    });

    it('should handle empty string token_hash', async () => {
      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: '',
          type: 'email',
        },
      }) as unknown as NextRequest;

      // Empty string is falsy, so it will redirect to error
      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(mockVerifyOtp).not.toHaveBeenCalled();
    });

    it('should handle createSupabaseServerClient throwing error', async () => {
      mockCreateSupabaseServerClient.mockRejectedValue(new Error('Failed to create client'));

      const request = createMockNextRequest('http://localhost:3000/auth/confirm', {
        searchParams: {
          token_hash: 'valid-token',
          type: 'email',
        },
      }) as unknown as NextRequest;

      await expect(GET(request)).rejects.toThrow('Failed to create client');
    });
  });
});
