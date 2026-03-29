// Tests for sanitizeRedirectPath — validates redirect path sanitization against open redirect attacks.

import { sanitizeRedirectPath } from './sanitizeRedirectPath';

const ORIGIN = 'https://example.com';

describe('sanitizeRedirectPath', () => {
  describe('valid paths', () => {
    it('returns simple paths unchanged', () => {
      expect(sanitizeRedirectPath('/', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('/dashboard', ORIGIN)).toBe('/dashboard');
      expect(sanitizeRedirectPath('/results?q=test', ORIGIN)).toBe('/results?q=test');
    });

    it('preserves query strings and hash fragments', () => {
      expect(sanitizeRedirectPath('/page?a=1&b=2', ORIGIN)).toBe('/page?a=1&b=2');
      expect(sanitizeRedirectPath('/page#section', ORIGIN)).toBe('/page#section');
      expect(sanitizeRedirectPath('/page?q=x#hash', ORIGIN)).toBe('/page?q=x#hash');
    });

    it('handles nested paths', () => {
      expect(sanitizeRedirectPath('/admin/settings/flags', ORIGIN)).toBe('/admin/settings/flags');
    });
  });

  describe('rejects malicious redirects', () => {
    it('rejects protocol-relative URLs', () => {
      expect(sanitizeRedirectPath('//evil.com', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('//evil.com/path', ORIGIN)).toBe('/');
    });

    it('rejects backslash tricks', () => {
      expect(sanitizeRedirectPath('/\\evil.com', ORIGIN)).toBe('/');
    });

    it('rejects absolute URLs to different origins', () => {
      expect(sanitizeRedirectPath('https://evil.com', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('https://evil.com/path', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('http://evil.com', ORIGIN)).toBe('/');
    });

    it('rejects non-path strings', () => {
      expect(sanitizeRedirectPath('javascript:alert(1)', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('data:text/html,<h1>hi</h1>', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('', ORIGIN)).toBe('/');
      expect(sanitizeRedirectPath('evil.com', ORIGIN)).toBe('/');
    });
  });

  describe('edge cases', () => {
    it('returns / for empty input', () => {
      expect(sanitizeRedirectPath('', ORIGIN)).toBe('/');
    });

    it('handles encoded characters', () => {
      const result = sanitizeRedirectPath('/path%20with%20spaces', ORIGIN);
      expect(result).toBe('/path%20with%20spaces');
    });
  });
});
