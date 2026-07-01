// URL sanitizer for react-markdown urlTransform. Used by the /edit variant tab
// (improvements_to_edit_page_evolution_20260630 Phase 3) to defend against
// prompt-injection attempts that steer the LLM to emit malicious markdown links.
//
// Contract: return the URL string if allowed, or an empty string to strip the href.
// (react-markdown treats empty as "no href" — the anchor renders without a link.)
//
// Allowed schemes: http, https, mailto (bare, no CRLF in headers).
// Rejected: javascript, data, vbscript, file, protocol-relative, fragments, relative paths.

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Sanitize a URL from LLM-produced markdown before rendering.
 *  Returns the original URL when safe; returns '' otherwise (which react-markdown
 *  interprets as "no href"). */
export function sanitizeMarkdownUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return '';

  // Reject protocol-relative URLs (//evil.com) — they inherit the current page's scheme.
  if (url.startsWith('//')) return '';

  // Reject fragment-only URLs (#foo) — no legitimate LLM output produces them.
  if (url.startsWith('#')) return '';

  // Reject relative paths (/foo, ./foo, ../foo, foo/bar) — the LLM shouldn't emit them
  // in a rewritten article; treating them as suspicious is safer than rendering them.
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return '';

  // Parse and check scheme. Uses URL constructor which handles a variety of formats.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a parseable absolute URL — reject as unsafe.
    return '';
  }

  const scheme = parsed.protocol.toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) return '';

  // mailto: extra check for CRLF injection in headers
  // (e.g. mailto:foo@bar%0aBcc:evil@x.com — some clients treat %0a as header injection).
  if (scheme === 'mailto:') {
    // parsed.pathname contains the address; raw URL is the safest thing to check.
    // Reject any encoded CR/LF sequences in the ORIGINAL URL (before URL normalization).
    if (/%0a|%0d|\r|\n/i.test(url)) return '';
  }

  return url;
}
