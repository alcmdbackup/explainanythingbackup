/**
 * Unit tests for src/config/userAgent.ts.
 * Pins the brand identity of the SOURCE_FETCHER_USER_AGENT constant —
 * remote hosts use this string to identify our fetcher and decide rate limits,
 * so silent changes to the brand portion would be a noisy regression.
 */

import { SOURCE_FETCHER_USER_AGENT } from './userAgent';

describe('SOURCE_FETCHER_USER_AGENT', () => {
  it('identifies the ExplainAnything fetcher', () => {
    expect(SOURCE_FETCHER_USER_AGENT).toContain('ExplainAnything');
  });

  it('is a valid HTTP User-Agent string (Mozilla/5.0 prefix)', () => {
    expect(SOURCE_FETCHER_USER_AGENT.startsWith('Mozilla/5.0')).toBe(true);
  });

  it('includes the brand URL', () => {
    expect(SOURCE_FETCHER_USER_AGENT).toContain('+https://explainanything.com');
  });

  it('is a non-empty string', () => {
    expect(typeof SOURCE_FETCHER_USER_AGENT).toBe('string');
    expect(SOURCE_FETCHER_USER_AGENT.length).toBeGreaterThan(20);
  });
});
