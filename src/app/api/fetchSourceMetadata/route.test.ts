/**
 * Integration tests for fetchSourceMetadata API endpoint
 * Tests URL source fetching with mocked external dependencies
 * @jest-environment node
 */

import { POST } from './route';
import { NextRequest } from 'next/server';
import * as sourceFetcher from '@/lib/services/sourceFetcher';
import { FetchStatus } from '@/lib/schemas/schemas';

// Mock logger
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock auth validation
jest.mock('@/lib/utils/supabase/validateApiAuth', () => ({
  validateApiAuth: jest.fn()
}));

// Import after mocking
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';

const mockValidateApiAuth = validateApiAuth as jest.MockedFunction<typeof validateApiAuth>;

// Helper to create NextRequest
function createRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/fetchSourceMetadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('fetchSourceMetadata API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: authenticated user
    mockValidateApiAuth.mockResolvedValue({
      data: {
        userId: 'test-user-123',
        sessionId: 'test-session-456'
      },
      error: null
    });
  });

  // ============================================================================
  // Authentication tests
  // ============================================================================
  describe('authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockValidateApiAuth.mockResolvedValue({ data: null, error: 'User not authenticated' });

      const request = createRequest({
        url: 'https://example.com/article'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Authentication required');
    });

    it('should return 403 when userId mismatch', async () => {
      const request = createRequest({
        url: 'https://example.com/article',
        userid: 'different-user'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Session mismatch');
    });
  });

  // ============================================================================
  // Validation tests
  // ============================================================================
  describe('validation', () => {
    it('should return 400 for invalid URL format', async () => {
      const request = createRequest({
        url: 'not-a-valid-url'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid request');
    });

    it('should return 400 for missing URL', async () => {
      const request = createRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================================
  // Source fetching tests
  // ============================================================================
  describe('source fetching', () => {
    it('should return success with SourceChipType data for valid URL', async () => {
      // Mock successful fetch
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: true,
        data: {
          url: 'https://example.com/article',
          title: 'Test Article',
          favicon_url: 'https://www.google.com/s2/favicons?domain=example.com&sz=32',
          domain: 'example.com',
          extracted_text: 'Article content here',
          is_summarized: false,
          original_length: 100,
          fetch_status: FetchStatus.Success,
          error_message: null,
          expires_at: new Date().toISOString()
        },
        error: null
      });

      const request = createRequest({
        url: 'https://example.com/article'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual({
        url: 'https://example.com/article',
        title: 'Test Article',
        favicon_url: 'https://www.google.com/s2/favicons?domain=example.com&sz=32',
        domain: 'example.com',
        status: 'success',
        error_message: null
      });
    });

    it('should return failed SourceChipType for paywall detection', async () => {
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: false,
        data: null,
        error: 'Content appears to be behind a paywall'
      });

      const request = createRequest({
        url: 'https://paywalled-site.com/article'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200); // Returns 200 with failure in body
      expect(data.success).toBe(false);
      expect(data.data.status).toBe('failed');
      expect(data.data.error_message).toContain('paywall');
    });

    it('should return failed SourceChipType for HTTP errors', async () => {
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: false,
        data: null,
        error: 'HTTP error: 404 Not Found'
      });

      const request = createRequest({
        url: 'https://example.com/not-found'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.data.status).toBe('failed');
      expect(data.error).toContain('404');
    });

    it('should return failed SourceChipType for timeout', async () => {
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: false,
        data: null,
        error: 'Request timed out'
      });

      const request = createRequest({
        url: 'https://slow-site.com/article'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.data.status).toBe('failed');
      expect(data.error).toContain('timed out');
    });

    it('should extract domain correctly for failed responses', async () => {
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: false,
        data: null,
        error: 'Unable to extract readable content'
      });

      const request = createRequest({
        url: 'https://www.example.com/empty-page'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.domain).toBe('example.com'); // www stripped
      expect(data.data.url).toBe('https://www.example.com/empty-page');
    });
  });

  // ============================================================================
  // Critical: Wikipedia false positive prevention
  // ============================================================================
  describe('Wikipedia false positive prevention', () => {
    it('should successfully fetch Wikipedia articles (regression test)', async () => {
      // This test ensures Wikipedia is NOT falsely flagged as paywalled
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockResolvedValue({
        success: true,
        data: {
          url: 'https://en.wikipedia.org/wiki/Quantum_computing',
          title: 'Quantum computing',
          favicon_url: 'https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=32',
          domain: 'en.wikipedia.org',
          extracted_text: 'Quantum computing article content...',
          is_summarized: false,
          original_length: 5000,
          fetch_status: FetchStatus.Success,
          error_message: null,
          expires_at: new Date().toISOString()
        },
        error: null
      });

      const request = createRequest({
        url: 'https://en.wikipedia.org/wiki/Quantum_computing'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('success');
      expect(data.data.title).toBe('Quantum computing');
    });
  });

  // ============================================================================
  // Error handling tests
  // ============================================================================
  describe('error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      jest.spyOn(sourceFetcher, 'fetchAndExtractSource').mockRejectedValue(
        new Error('Unexpected database error')
      );

      const request = createRequest({
        url: 'https://example.com/article'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Internal server error');
    });
  });
});
