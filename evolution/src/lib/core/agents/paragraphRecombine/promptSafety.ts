// Prompt-injection safety helpers for Sequential Context-Aware Generation
// (debug_performance_paragraph_recombine_20260612). Each round's chosen text becomes
// the next round's PRIOR CONTEXT — recursive trust. Without sanitization, a paragraph
// containing literal `</UNTRUSTED_PRIOR>` could break out of the delimiter scope and
// inject instructions consumed by the next round's generation prompt.
//
// The redaction strategy REPLACES tag literals with [UNTRUSTED_TAG_REDACTED] rather
// than stripping them — stripping would leave adjacent malicious payload intact while
// silently dropping the boundary marker. Replacement preserves the audit trail
// (operator sees that something was redacted) and prevents tag breakouts.

/** All delimiter tag literals used by the generation + judge prompts. Substring
 *  matching is case-insensitive — any case mix in chosen text gets redacted.
 *
 *  investigate_sequential_paragraph_recombine_performance_20260615 Phase 1c-i:
 *  added the <UNTRUSTED_NEXT> pair for the new forward-context block in the
 *  slot-judge prompt. Without this, a parent paragraph containing a literal
 *  </UNTRUSTED_NEXT> string would break out of the new tag scope and enable
 *  prompt injection — same threat model as the existing PRIOR/PARENT pairs. */
export const PROMPT_DELIMITER_TAGS: readonly string[] = [
  '<UNTRUSTED_PRIOR>',
  '</UNTRUSTED_PRIOR>',
  '<UNTRUSTED_PARENT>',
  '</UNTRUSTED_PARENT>',
  '<UNTRUSTED_NEXT>',
  '</UNTRUSTED_NEXT>',
] as const;

const REDACTION_PLACEHOLDER = '[UNTRUSTED_TAG_REDACTED]';

/** Replace every delimiter tag literal in `text` with the redaction placeholder.
 *  Case-insensitive match. Idempotent on already-sanitized text. Returns the
 *  sanitized string + a boolean indicating whether any replacement happened
 *  (for incrementing prior_picks_sanitization_count). */
export function sanitizeForPriorContext(text: string): { sanitized: string; redacted: boolean } {
  let sanitized = text;
  let redacted = false;
  for (const tag of PROMPT_DELIMITER_TAGS) {
    const pattern = new RegExp(escapeForRegex(tag), 'gi');
    if (pattern.test(sanitized)) {
      sanitized = sanitized.replace(new RegExp(escapeForRegex(tag), 'gi'), REDACTION_PLACEHOLDER);
      redacted = true;
    }
  }
  return { sanitized, redacted };
}

/** Detects whether `text` contains a literal delimiter tag — used to REJECT
 *  generation candidates whose output echoes the prompt's data boundaries.
 *  Tighter than the regex-any-`<…>` pattern: only the literal tag set is rejected,
 *  so legitimate angle brackets in technical text don't false-positive. */
export function containsDelimiterMirror(text: string): boolean {
  const lower = text.toLowerCase();
  for (const tag of PROMPT_DELIMITER_TAGS) {
    if (lower.includes(tag.toLowerCase())) return true;
  }
  return false;
}

function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
