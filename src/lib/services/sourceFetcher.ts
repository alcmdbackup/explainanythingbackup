import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { logger } from '@/lib/server_utilities';
import {
  FetchStatus,
  type SourceCacheInsertType
} from '@/lib/schemas/schemas';

// Constants
const FETCH_TIMEOUT_MS = 10000; // 10 seconds
const WORD_THRESHOLD = 3000; // Words before summarization
const CACHE_EXPIRY_DAYS = 7;

/**
 * Result type for source fetching operations
 */
export interface FetchSourceResult {
  success: boolean;
  data: SourceCacheInsertType | null;
  error: string | null;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Extract favicon URL from a domain
 * Uses Google's favicon service as a reliable fallback
 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Calculate cache expiry date (7 days from now)
 */
export function calculateExpiryDate(): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + CACHE_EXPIRY_DAYS);
  return expiry.toISOString();
}

/**
 * Detect if content appears to be behind a paywall
 */
export function detectPaywall(html: string): boolean {
  const paywallIndicators = [
    'subscribe to continue',
    'subscription required',
    'members only',
    'paywall',
    'sign up to read',
    'create a free account',
    'premium content',
    'unlock this article'
  ];

  const lowerHtml = html.toLowerCase();
  return paywallIndicators.some(indicator => lowerHtml.includes(indicator));
}

/**
 * Fetch and extract content from a URL
 *
 * • Validates URL format
 * • Fetches with 10s timeout
 * • Extracts readable content using Readability
 * • Returns structured data for caching
 */
export async function fetchAndExtractSource(url: string): Promise<FetchSourceResult> {
  logger.info('fetchAndExtractSource: Starting', { url });

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        success: false,
        data: null,
        error: 'Invalid URL protocol. Only HTTP and HTTPS are supported.'
      };
    }
  } catch {
    return {
      success: false,
      data: null,
      error: 'Invalid URL format'
    };
  }

  const domain = extractDomain(url);

  try {
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ExplainAnything/1.0; +https://explainanything.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP error: ${response.status} ${response.statusText}`
      };
    }

    const html = await response.text();

    // Check for paywall
    if (detectPaywall(html)) {
      return {
        success: false,
        data: null,
        error: 'Content appears to be behind a paywall'
      };
    }

    // Parse HTML and extract content using Readability
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length === 0) {
      return {
        success: false,
        data: null,
        error: 'Unable to extract readable content from this URL'
      };
    }

    const extractedText = article.textContent.trim();
    const wordCount = countWords(extractedText);

    // Determine if summarization will be needed
    const needsSummarization = wordCount > WORD_THRESHOLD;

    const sourceData: SourceCacheInsertType = {
      url,
      title: article.title || null,
      favicon_url: getFaviconUrl(domain),
      domain,
      extracted_text: extractedText,
      is_summarized: false, // Will be updated after summarization if needed
      original_length: wordCount,
      fetch_status: FetchStatus.Success,
      error_message: null,
      expires_at: calculateExpiryDate()
    };

    logger.info('fetchAndExtractSource: Success', {
      url,
      title: article.title,
      wordCount,
      needsSummarization
    });

    return {
      success: true,
      data: sourceData,
      error: null
    };

  } catch (error) {
    const errorMessage = error instanceof Error
      ? (error.name === 'AbortError' ? 'Request timed out' : error.message)
      : 'Unknown error occurred';

    logger.error('fetchAndExtractSource: Failed', { url, error: errorMessage });

    return {
      success: false,
      data: null,
      error: errorMessage
    };
  }
}

/**
 * Check if content needs summarization based on word count
 */
export function needsSummarization(wordCount: number): boolean {
  return wordCount > WORD_THRESHOLD;
}

/**
 * Get the word threshold for summarization
 */
export function getWordThreshold(): number {
  return WORD_THRESHOLD;
}
