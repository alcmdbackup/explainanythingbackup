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

  // OpenAI SDK typed error classes
  if (error instanceof APIConnectionError) return true;
  if (error instanceof RateLimitError) return true;
  if (error instanceof InternalServerError) return true;

  // Walk the cause chain — middleware/wrappers may nest the original SDK error
  if ('cause' in error && error.cause instanceof Error) {
    return isTransientError(error.cause);
  }

  const msg = error.message.toLowerCase();
  // Socket/network errors
  if (msg.includes('socket timeout')) return true;
  if (msg.includes('llm call timeout')) return true;
  if (msg.includes('econnreset')) return true;
  if (msg.includes('econnrefused')) return true;
  if (msg.includes('etimedout')) return true;
  if (msg.includes('fetch failed')) return true;
  // HTTP status codes (for non-SDK errors)
  if (/\b(429|408|500|502|503|504)\b/.test(msg)) return true;
  if (msg.includes('rate limit')) return true;
  if (msg.includes('internal server error')) return true;
  if (msg.includes('bad gateway')) return true;
  if (msg.includes('service unavailable')) return true;
  if (msg.includes('gateway timeout')) return true;
  return false;
}
