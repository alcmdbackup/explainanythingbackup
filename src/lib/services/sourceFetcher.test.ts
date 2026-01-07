/**
 * Unit tests for sourceFetcher.ts
 * Tests URL source fetching, content extraction, and paywall detection
 * @jest-environment node
 */

import {
  extractDomain,
  getFaviconUrl,
  countWords,
  calculateExpiryDate,
  detectPaywall,
  needsSummarization,
  getWordThreshold,
  fetchAndExtractSource
} from './sourceFetcher';

// Mock the logger to avoid console noise in tests
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

describe('sourceFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // extractDomain
  // ============================================================================
  describe('extractDomain', () => {
    it('should extract domain from URL without www', () => {
      expect(extractDomain('https://example.com/page')).toBe('example.com');
    });

    it('should strip www prefix from domain', () => {
      expect(extractDomain('https://www.example.com/page')).toBe('example.com');
    });

    it('should handle subdomains correctly', () => {
      expect(extractDomain('https://en.wikipedia.org/wiki/Test')).toBe('en.wikipedia.org');
    });

    it('should handle URLs with ports', () => {
      expect(extractDomain('https://example.com:8080/page')).toBe('example.com');
    });

    it('should return "unknown" for invalid URLs', () => {
      expect(extractDomain('not-a-url')).toBe('unknown');
      expect(extractDomain('')).toBe('unknown');
    });
  });

  // ============================================================================
  // getFaviconUrl
  // ============================================================================
  describe('getFaviconUrl', () => {
    it('should return Google favicon service URL', () => {
      const result = getFaviconUrl('example.com');
      expect(result).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=32');
    });

    it('should handle domains with subdomains', () => {
      const result = getFaviconUrl('en.wikipedia.org');
      expect(result).toContain('en.wikipedia.org');
    });
  });

  // ============================================================================
  // countWords
  // ============================================================================
  describe('countWords', () => {
    it('should count words correctly', () => {
      expect(countWords('one two three')).toBe(3);
    });

    it('should handle multiple spaces', () => {
      expect(countWords('one  two   three')).toBe(3);
    });

    it('should handle empty string', () => {
      expect(countWords('')).toBe(0);
    });

    it('should handle whitespace-only string', () => {
      expect(countWords('   ')).toBe(0);
    });

    it('should handle newlines and tabs', () => {
      expect(countWords('one\ntwo\tthree')).toBe(3);
    });
  });

  // ============================================================================
  // calculateExpiryDate
  // ============================================================================
  describe('calculateExpiryDate', () => {
    it('should return ISO date string 7 days in future', () => {
      const result = calculateExpiryDate();
      const expiryDate = new Date(result);
      const now = new Date();

      // Should be approximately 7 days from now (within a few seconds)
      const diffDays = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });

    it('should return valid ISO string', () => {
      const result = calculateExpiryDate();
      expect(() => new Date(result)).not.toThrow();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ============================================================================
  // detectPaywall - Critical tests for false positive prevention
  // ============================================================================
  describe('detectPaywall', () => {
    it('should NOT flag Wikipedia content as paywalled', () => {
      // Wikipedia contains phrases like "create a free account" in navigation
      const wikipediaHtml = `
        <html>
          <body>
            <nav>
              <a href="/login">Log in</a>
              <a href="/create-account">Create a free account</a>
            </nav>
            <main>
              <h1>Quantum Computing</h1>
              <p>Quantum computing is a type of computation...</p>
            </main>
          </body>
        </html>
      `;
      expect(detectPaywall(wikipediaHtml)).toBe(false);
    });

    it('should NOT flag content with "members only" in navigation', () => {
      const htmlWithMembersOnly = `
        <html>
          <nav>Members only area | Public content</nav>
          <article>This is public content available to everyone.</article>
        </html>
      `;
      expect(detectPaywall(htmlWithMembersOnly)).toBe(false);
    });

    it('should NOT flag content with general "premium" mentions', () => {
      const htmlWithPremium = `
        <html>
          <article>
            <h1>Best Premium Headphones of 2024</h1>
            <p>These premium headphones offer excellent sound quality.</p>
          </article>
        </html>
      `;
      expect(detectPaywall(htmlWithPremium)).toBe(false);
    });

    it('should detect actual paywall with "subscribe to continue reading"', () => {
      const paywalledHtml = `
        <html>
          <div class="paywall">
            <p>You've reached your limit. Subscribe to continue reading this article.</p>
          </div>
        </html>
      `;
      expect(detectPaywall(paywalledHtml)).toBe(true);
    });

    it('should detect actual paywall with "subscription required to"', () => {
      const paywalledHtml = `
        <html>
          <div class="paywall">
            <p>A subscription required to access this content.</p>
          </div>
        </html>
      `;
      expect(detectPaywall(paywalledHtml)).toBe(true);
    });

    it('should detect actual paywall with "sign up to read this"', () => {
      const paywalledHtml = `
        <html>
          <div class="paywall">
            <p>Please sign up to read this article in full.</p>
          </div>
        </html>
      `;
      expect(detectPaywall(paywalledHtml)).toBe(true);
    });

    it('should detect actual paywall with "unlock this article"', () => {
      const paywalledHtml = `
        <html>
          <div class="paywall">
            <p>Unlock this article with a subscription.</p>
          </div>
        </html>
      `;
      expect(detectPaywall(paywalledHtml)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const paywalledHtml = `
        <html>
          <p>SUBSCRIBE TO CONTINUE READING our premium articles.</p>
        </html>
      `;
      expect(detectPaywall(paywalledHtml)).toBe(true);
    });

    it('should NOT flag empty HTML', () => {
      expect(detectPaywall('')).toBe(false);
    });

    it('should NOT flag regular article content', () => {
      const regularArticle = `
        <html>
          <article>
            <h1>How to Learn Programming</h1>
            <p>Programming is a valuable skill that anyone can learn.</p>
            <p>Start with the basics and practice regularly.</p>
          </article>
        </html>
      `;
      expect(detectPaywall(regularArticle)).toBe(false);
    });
  });

  // ============================================================================
  // needsSummarization / getWordThreshold
  // ============================================================================
  describe('needsSummarization', () => {
    it('should return true for content over threshold', () => {
      const threshold = getWordThreshold();
      expect(needsSummarization(threshold + 1)).toBe(true);
    });

    it('should return false for content under threshold', () => {
      const threshold = getWordThreshold();
      expect(needsSummarization(threshold - 1)).toBe(false);
    });

    it('should return false for content at exactly threshold', () => {
      const threshold = getWordThreshold();
      expect(needsSummarization(threshold)).toBe(false);
    });
  });

  describe('getWordThreshold', () => {
    it('should return a positive number', () => {
      expect(getWordThreshold()).toBeGreaterThan(0);
    });

    it('should return 3000 (the configured threshold)', () => {
      expect(getWordThreshold()).toBe(3000);
    });
  });

  // ============================================================================
  // fetchAndExtractSource - Integration-style tests with mocked fetch
  // ============================================================================
  describe('fetchAndExtractSource', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should reject invalid URL protocols', async () => {
      const result = await fetchAndExtractSource('ftp://example.com/file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL protocol');
    });

    it('should reject malformed URLs', async () => {
      const result = await fetchAndExtractSource('not-a-valid-url');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL format');
    });

    it('should handle HTTP errors gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await fetchAndExtractSource('https://example.com/not-found');
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP error: 404');
    });

    it('should handle network timeout', async () => {
      global.fetch = jest.fn().mockImplementation(() => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const result = await fetchAndExtractSource('https://example.com/slow');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Request timed out');
    });

    it('should detect paywalled content', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`
          <html>
            <body>
              <p>Subscribe to continue reading this exclusive content.</p>
            </body>
          </html>
        `)
      });

      const result = await fetchAndExtractSource('https://paywalled-site.com/article');
      expect(result.success).toBe(false);
      expect(result.error).toContain('paywall');
    });

    it('should extract content successfully from valid HTML', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`
          <!DOCTYPE html>
          <html>
            <head><title>Test Article</title></head>
            <body>
              <article>
                <h1>Test Article Title</h1>
                <p>This is the main content of the article with enough text to be meaningful.</p>
                <p>Additional paragraph with more content for testing purposes.</p>
              </article>
            </body>
          </html>
        `)
      });

      const result = await fetchAndExtractSource('https://example.com/article');
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data?.domain).toBe('example.com');
      expect(result.data?.url).toBe('https://example.com/article');
      expect(result.error).toBeNull();
    });

    it('should handle pages with no extractable content', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`
          <html>
            <body>
              <script>console.log('Only scripts');</script>
            </body>
          </html>
        `)
      });

      const result = await fetchAndExtractSource('https://example.com/empty');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to extract readable content');
    });
  });
});
