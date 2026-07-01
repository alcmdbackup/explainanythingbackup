// Unit tests for the /edit variant tab URL sanitizer.
// improvements_to_edit_page_evolution_20260630 Phase 4.

import { sanitizeMarkdownUrl } from './sanitizeMarkdownUrl';

describe('sanitizeMarkdownUrl', () => {
  describe('rejects unsafe schemes', () => {
    it('javascript:alert(1)', () => {
      expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBe('');
    });
    it('data:text/html,<script>alert(1)</script>', () => {
      expect(sanitizeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });
    it('vbscript:...', () => {
      expect(sanitizeMarkdownUrl('vbscript:msgbox(1)')).toBe('');
    });
    it('file:///etc/passwd', () => {
      expect(sanitizeMarkdownUrl('file:///etc/passwd')).toBe('');
    });
    it('unknown scheme', () => {
      expect(sanitizeMarkdownUrl('gopher://example.com')).toBe('');
    });
    it('case-insensitive scheme check (JAVASCRIPT:)', () => {
      expect(sanitizeMarkdownUrl('JavaScript:alert(1)')).toBe('');
    });
  });

  describe('rejects non-absolute URLs', () => {
    it('protocol-relative //evil.com', () => {
      expect(sanitizeMarkdownUrl('//evil.com/path')).toBe('');
    });
    it('root-relative /foo', () => {
      expect(sanitizeMarkdownUrl('/foo/bar')).toBe('');
    });
    it('dot-relative ./foo', () => {
      expect(sanitizeMarkdownUrl('./foo')).toBe('');
    });
    it('parent-relative ../foo', () => {
      expect(sanitizeMarkdownUrl('../foo')).toBe('');
    });
    it('fragment-only #foo', () => {
      expect(sanitizeMarkdownUrl('#fragment')).toBe('');
    });
    it('empty string', () => {
      expect(sanitizeMarkdownUrl('')).toBe('');
    });
    it('non-string (undefined-cast)', () => {
      // Defensive: node/browser may pass odd values through urlTransform.
      expect(sanitizeMarkdownUrl(undefined as unknown as string)).toBe('');
    });
    it('unparseable garbage', () => {
      expect(sanitizeMarkdownUrl('not a url at all')).toBe('');
    });
  });

  describe('rejects mailto with CRLF injection', () => {
    it('%0a Bcc header injection', () => {
      expect(sanitizeMarkdownUrl('mailto:foo@bar.com%0aBcc:evil@x.com')).toBe('');
    });
    it('%0d carriage return', () => {
      expect(sanitizeMarkdownUrl('mailto:foo@bar%0dSubject:phish')).toBe('');
    });
    it('literal newline', () => {
      expect(sanitizeMarkdownUrl('mailto:foo@bar.com\nBcc:evil@x.com')).toBe('');
    });
    it('uppercase %0A', () => {
      expect(sanitizeMarkdownUrl('mailto:foo@bar.com%0ABcc:x@y.com')).toBe('');
    });
  });

  describe('allows safe URLs', () => {
    it('https://example.com', () => {
      expect(sanitizeMarkdownUrl('https://example.com')).toBe('https://example.com');
    });
    it('http://example.com/path?q=1', () => {
      expect(sanitizeMarkdownUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1');
    });
    it('mailto:foo@bar.com', () => {
      expect(sanitizeMarkdownUrl('mailto:foo@bar.com')).toBe('mailto:foo@bar.com');
    });
    it('https URL with fragment', () => {
      // Fragment on an absolute URL is fine (fragment-only rejection above targets bare #foo).
      expect(sanitizeMarkdownUrl('https://example.com#section')).toBe('https://example.com#section');
    });
  });
});
