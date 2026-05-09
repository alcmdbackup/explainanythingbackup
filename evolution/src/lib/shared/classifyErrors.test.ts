// Unit tests for isTransientError — verifies detection of retryable network/API errors.

import { isTransientError } from './classifyErrors';
import { APIConnectionError, RateLimitError, InternalServerError } from 'openai';
import { BudgetExceededError } from '../types';

describe('isTransientError', () => {
  // ─── OpenAI SDK error class instances ────────────────────────────

  it('returns true for APIConnectionError', () => {
    const err = new APIConnectionError({ message: 'Connection failed', cause: undefined });
    expect(isTransientError(err)).toBe(true);
  });

  it('returns true for RateLimitError', () => {
    const err = new RateLimitError(429, undefined, 'Rate limited', undefined as any);
    expect(isTransientError(err)).toBe(true);
  });

  it('returns true for InternalServerError', () => {
    const err = new InternalServerError(500, undefined, 'Internal server error', undefined as any);
    expect(isTransientError(err)).toBe(true);
  });

  // ─── Message-based detection ─────────────────────────────────────

  it.each([
    'Socket timeout',
    'LLM call timeout (60s)',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'fetch failed',
    'HTTP 429 rate limit',
    'HTTP 408 request timeout',
    'HTTP 500 error',
    'HTTP 502 bad gateway',
    'HTTP 503 service unavailable',
    'HTTP 504 gateway timeout',
    'rate limit exceeded',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
  ])('returns true for message containing "%s"', (msg) => {
    expect(isTransientError(new Error(msg))).toBe(true);
  });

  // ─── Cause chain walking ─────────────────────────────────────────

  it('returns true for wrapped APIConnectionError in cause chain', () => {
    const inner = new APIConnectionError({ message: 'timeout', cause: undefined });
    const outer = new Error('LLM wrapper failed', { cause: inner });
    expect(isTransientError(outer)).toBe(true);
  });

  it('returns true for deeply nested transient error in cause chain', () => {
    const inner = new Error('Socket timeout');
    const mid = new Error('Call failed', { cause: inner });
    const outer = new Error('Agent error', { cause: mid });
    expect(isTransientError(outer)).toBe(true);
  });

  // ─── Non-transient errors ────────────────────────────────────────

  it('returns false for BudgetExceededError', () => {
    expect(isTransientError(new BudgetExceededError('test', 1.0, 0, 0.5))).toBe(false);
  });

  it('returns false for generic Error', () => {
    expect(isTransientError(new Error('Invalid JSON response'))).toBe(false);
  });

  it('returns false for SyntaxError', () => {
    expect(isTransientError(new SyntaxError('Unexpected token'))).toBe(false);
  });

  it('returns false for TypeError', () => {
    expect(isTransientError(new TypeError('Cannot read property x of undefined'))).toBe(false);
  });

  // ─── Non-Error inputs ────────────────────────────────────────────

  it('returns false for string', () => {
    expect(isTransientError('Socket timeout')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTransientError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTransientError(undefined)).toBe(false);
  });

  it('returns false for plain object', () => {
    expect(isTransientError({ message: 'Socket timeout' })).toBe(false);
  });
});
