// Classifies errors as transient (retryable) or fatal for the evolution pipeline.
// Used by agents for graceful degradation and by pipeline runAgent() for retry logic.

import { APIConnectionError, RateLimitError, InternalServerError } from 'openai';

/**
 * Determines if an error is transient (retryable) — e.g. socket timeouts,
 * rate limits, 5xx server errors. Evolution-pipeline specific; see
 * src/lib/errorHandling.ts for global error categorization.
 *
 * NOTE: The OpenAI SDK is used for DeepSeek calls too, so instanceof
 * checks cover both providers. APIConnectionTimeoutError extends
 * APIConnectionError, so timeout errors are covered by inheritance.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // OpenAI SDK typed error classes (covers DeepSeek too; timeout extends APIConnectionError)
  if (
    error instanceof APIConnectionError ||
    error instanceof RateLimitError ||
    error instanceof InternalServerError
  ) return true;

  // Walk the cause chain — middleware/wrappers may nest the original SDK error
  if ('cause' in error && error.cause instanceof Error) return isTransientError(error.cause);

  const msg = error.message.toLowerCase();
  const transientPhrases = [
    'socket timeout', 'llm call timeout', 'econnreset', 'econnrefused',
    'etimedout', 'fetch failed', 'rate limit', 'internal server error',
    'bad gateway', 'service unavailable', 'gateway timeout',
  ];
  return transientPhrases.some(p => msg.includes(p)) || /\b(429|408|500|502|503|504)\b/.test(msg);
}
