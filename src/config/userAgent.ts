/**
 * User-Agent strings emitted by ExplainAnything server-side fetchers.
 * Extracted from inline literals so the brand identity lives in one place.
 */

/**
 * User-Agent for `src/lib/services/sourceFetcher.ts` outbound URL fetches.
 * Identifies the fetcher service and links back to the brand site so remote
 * hosts can identify and (if needed) rate-limit our traffic appropriately.
 */
export const SOURCE_FETCHER_USER_AGENT =
  'Mozilla/5.0 (compatible; ExplainAnything/1.0; +https://explainanything.com)';
