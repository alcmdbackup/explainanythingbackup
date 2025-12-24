/**
 * Validation utilities for runtime parameter checks
 */

/**
 * Assert that userId is a non-empty string.
 * Throws an error if userId is null, undefined, or empty string.
 *
 * @param userid - The userId to validate
 * @param context - Function name or context for error message
 * @throws Error if userId is not a valid non-empty string
 */
export function assertUserId(
  userid: string | null | undefined,
  context: string
): asserts userid is string {
  if (!userid) {
    throw new Error(`userId is required for ${context}`);
  }
}
