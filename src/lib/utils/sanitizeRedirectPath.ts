// Validates and sanitizes redirect path parameters to prevent open redirect attacks.
// Used by auth callback and confirm routes.

/**
 * Sanitize a redirect path from user input.
 * Rejects absolute URLs, protocol-relative URLs, and backslash tricks.
 * Returns a safe same-origin path or '/' as fallback.
 */
export function sanitizeRedirectPath(next: string, origin: string): string {
  try {
    // Reject anything that doesn't start with a single forward slash
    // This catches protocol-relative URLs (//evil.com), backslash tricks (/\evil.com),
    // and absolute URLs (https://evil.com)
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
      return '/';
    }

    // Parse with origin to create an absolute URL, then verify origin matches
    const url = new URL(next, origin);
    if (url.origin !== origin) {
      return '/';
    }

    // Return only the path + search + hash (no origin)
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
