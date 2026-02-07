/**
 * Unit tests for useSourceSubmit hook — URL validation, loading chip creation,
 * metadata fetch success/failure, and error handling.
 */

import { renderHook, act } from '@testing-library/react';
import useSourceSubmit from './useSourceSubmit';

// Mock fetchWithTracing
jest.mock('@/lib/tracing/fetchWithTracing', () => ({
  fetchWithTracing: jest.fn(),
}));

import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';

const mockFetch = fetchWithTracing as jest.MockedFunction<typeof fetchWithTracing>;

describe('useSourceSubmit', () => {
  const onSourceAdded = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // URL validation
  // ============================================================================
  describe('URL validation', () => {
    it('rejects empty string', async () => {
      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('');
      });

      expect(onSourceAdded).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });

    it('rejects invalid URL', async () => {
      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('not-a-url');
      });

      expect(result.current.error).toBe(
        'Please enter a valid URL (starting with http:// or https://)'
      );
      expect(onSourceAdded).not.toHaveBeenCalled();
    });

    it('rejects non-http protocols', async () => {
      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('ftp://example.com');
      });

      expect(result.current.error).toMatch(/valid URL/);
      expect(onSourceAdded).not.toHaveBeenCalled();
    });

    it('accepts http:// URL', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: { url: 'http://example.com', title: 'Example', favicon_url: null, domain: 'example.com', status: 'success', error_message: null } }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('http://example.com');
      });

      expect(result.current.error).toBeNull();
      expect(onSourceAdded).toHaveBeenCalled();
    });

    it('accepts https:// URL', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: { url: 'https://example.com', title: 'Example', favicon_url: null, domain: 'example.com', status: 'success', error_message: null } }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://example.com');
      });

      expect(result.current.error).toBeNull();
      expect(onSourceAdded).toHaveBeenCalled();
    });

    it('trims whitespace before validating', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: { url: 'https://example.com', title: 'Example', favicon_url: null, domain: 'example.com', status: 'success', error_message: null } }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('  https://example.com  ');
      });

      expect(onSourceAdded).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Loading chip creation
  // ============================================================================
  describe('loading chip', () => {
    it('creates loading chip immediately', async () => {
      let resolvePromise: (value: any) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }) as Promise<Response>
      );

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      // Don't await — we want to check the intermediate state
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.submitUrl('https://example.com/article');
      });

      // First call should be the loading chip
      expect(onSourceAdded).toHaveBeenCalledTimes(1);
      expect(onSourceAdded).toHaveBeenCalledWith({
        url: 'https://example.com/article',
        title: null,
        favicon_url: null,
        domain: 'example.com',
        status: 'loading',
        error_message: null,
      });

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          json: () => Promise.resolve({ success: true, data: { url: 'https://example.com/article', title: 'Article', favicon_url: null, domain: 'example.com', status: 'success', error_message: null } }),
        });
        await submitPromise!;
      });
    });

    it('strips www. from domain', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://www.example.com');
      });

      expect(onSourceAdded.mock.calls[0][0].domain).toBe('example.com');
    });
  });

  // ============================================================================
  // Metadata fetch success
  // ============================================================================
  describe('metadata fetch success', () => {
    it('calls onSourceAdded with fetched data on success', async () => {
      const fetchedData = {
        url: 'https://example.com',
        title: 'Example Title',
        favicon_url: 'https://example.com/favicon.ico',
        domain: 'example.com',
        status: 'success' as const,
        error_message: null,
        source_cache_id: 42,
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: fetchedData }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://example.com');
      });

      // Second call should be the fetched data
      expect(onSourceAdded).toHaveBeenCalledTimes(2);
      expect(onSourceAdded).toHaveBeenLastCalledWith(fetchedData);
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  // ============================================================================
  // Metadata fetch failure
  // ============================================================================
  describe('metadata fetch failure', () => {
    it('creates error chip when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: false, error: 'Page not found' }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://example.com/404');
      });

      expect(onSourceAdded).toHaveBeenCalledTimes(2);
      const errorChip = onSourceAdded.mock.calls[1][0];
      expect(errorChip.status).toBe('failed');
      expect(errorChip.error_message).toBe('Page not found');
    });

    it('creates error chip on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://example.com');
      });

      expect(onSourceAdded).toHaveBeenCalledTimes(2);
      const errorChip = onSourceAdded.mock.calls[1][0];
      expect(errorChip.status).toBe('failed');
      expect(errorChip.error_message).toBe('Network error');
    });

    it('uses fallback message when API returns no error string', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: false }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('https://example.com');
      });

      const errorChip = onSourceAdded.mock.calls[1][0];
      expect(errorChip.error_message).toBe('Failed to fetch source');
    });
  });

  // ============================================================================
  // Error handling
  // ============================================================================
  describe('error handling', () => {
    it('clearError resets error to null', async () => {
      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      await act(async () => {
        await result.current.submitUrl('invalid');
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('clears previous error on new submit', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, data: { url: 'https://example.com', title: 'Example', favicon_url: null, domain: 'example.com', status: 'success', error_message: null } }),
      } as Response);

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      // First: invalid
      await act(async () => {
        await result.current.submitUrl('not-a-url');
      });
      expect(result.current.error).not.toBeNull();

      // Second: valid
      await act(async () => {
        await result.current.submitUrl('https://example.com');
      });
      expect(result.current.error).toBeNull();
    });

    it('sets isSubmitting during fetch', async () => {
      let resolvePromise: (value: any) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }) as Promise<Response>
      );

      const { result } = renderHook(() => useSourceSubmit(onSourceAdded));

      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.submitUrl('https://example.com');
      });

      expect(result.current.isSubmitting).toBe(true);

      await act(async () => {
        resolvePromise!({
          json: () => Promise.resolve({ success: true, data: {} }),
        });
        await submitPromise!;
      });

      expect(result.current.isSubmitting).toBe(false);
    });
  });
});
