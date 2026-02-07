/**
 * Shared hook for URL submission logic — validates URL, creates optimistic loading chip,
 * fetches metadata via /api/fetchSourceMetadata, and handles success/error states.
 */
'use client';

import { useState, useCallback } from 'react';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';

function validateUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export interface UseSourceSubmitReturn {
  submitUrl: (rawUrl: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  clearError: () => void;
}

export default function useSourceSubmit(
  onSourceAdded: (source: SourceChipType) => void
): UseSourceSubmitReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const submitUrl = useCallback(async (rawUrl: string) => {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) return;

    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL (starting with http:// or https://)');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    // Create loading chip immediately for optimistic UI
    const loadingChip: SourceChipType = {
      url: trimmedUrl,
      title: null,
      favicon_url: null,
      domain: new URL(trimmedUrl).hostname.replace(/^www\./, ''),
      status: 'loading',
      error_message: null,
    };
    onSourceAdded(loadingChip);

    try {
      const response = await fetchWithTracing('/api/fetchSourceMetadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        onSourceAdded(result.data);
      } else {
        const errorChip: SourceChipType = {
          ...loadingChip,
          status: 'failed',
          error_message: result.error || 'Failed to fetch source',
        };
        onSourceAdded(errorChip);
      }
    } catch {
      const errorChip: SourceChipType = {
        ...loadingChip,
        status: 'failed',
        error_message: 'Network error',
      };
      onSourceAdded(errorChip);
    } finally {
      setIsSubmitting(false);
    }
  }, [onSourceAdded]);

  return { submitUrl, isSubmitting, error, clearError };
}
