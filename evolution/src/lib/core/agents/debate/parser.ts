// JSON parser for the combined analyze+judge LLM response.
// (bring_back_debate_agent_20260506 Phase 2.3.)
//
// Independent of reasoning trace — parser only sees the structured-output portion.
// Markdown-fence tolerance (```json ... ```) since some models wrap JSON in fences
// despite explicit instructions.

import { DebateParseError } from './errors';
import type { DebateVerdict } from './promptBuilders';

/**
 * Parse and validate the combined analyze+judge response. Throws DebateParseError
 * with the raw response captured on failure (partial-detail-on-throw at the agent
 * layer persists this onto execution_detail.debate.combined.{rawResponse, parseError}).
 *
 * Validates all 8 required fields:
 *   - reasoning: non-empty string
 *   - prosA, consA, prosB, consB, strengthsFromA, strengthsFromB, improvements:
 *     non-empty string arrays (each entry trimmed; empties dropped)
 *
 * The `winner` field was removed 2026-05-09 — ELO determines the synthesis base
 * (variant A is always the higher-Elo input by debate-dispatch contract). The
 * parser is tolerant of `winner` being present in legacy responses (just ignored)
 * but no longer requires or validates it.
 */
export function parseCombinedAnalyzeAndJudge(rawResponse: string): DebateVerdict {
  // Strip optional ```json ... ``` markdown fences for resilience.
  const stripped = stripMarkdownFences(rawResponse).trim();
  if (stripped.length === 0) {
    throw new DebateParseError('Empty response after stripping markdown fences', rawResponse);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (firstErr) {
    // Smaller models (gemini-2.5-flash-lite observed in run b0ebc971) over-escape
    // apostrophes inside double-quoted JSON strings — `"Fed\'s operations"` is
    // invalid JSON because `\'` is not in the allowed escape set
    // (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX). Retry with sanitization before
    // giving up so a single non-conformant escape doesn't kill the whole iteration.
    try {
      parsed = JSON.parse(sanitizeInvalidEscapes(stripped));
    } catch {
      throw new DebateParseError(
        `JSON parse failed: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
        rawResponse,
        firstErr,
      );
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DebateParseError(
      `Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      rawResponse,
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Validate reasoning string.
  const reasoning = obj.reasoning;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    throw new DebateParseError(
      'Missing or empty `reasoning` field (expected non-empty string)',
      rawResponse,
    );
  }

  // Validate the 7 string-array fields.
  const arrayFields = [
    'prosA',
    'consA',
    'prosB',
    'consB',
    'strengthsFromA',
    'strengthsFromB',
    'improvements',
  ] as const;

  const validatedArrays: Partial<Record<(typeof arrayFields)[number], string[]>> = {};

  for (const field of arrayFields) {
    const raw = obj[field];
    if (!Array.isArray(raw)) {
      throw new DebateParseError(
        `Field \`${field}\` must be an array of strings, got ${typeof raw}`,
        rawResponse,
      );
    }
    // Trim entries; drop empty strings; require at least one non-empty entry.
    const trimmed = raw
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (trimmed.length === 0) {
      throw new DebateParseError(
        `Field \`${field}\` has zero non-empty string entries (expected ≥1)`,
        rawResponse,
      );
    }
    validatedArrays[field] = trimmed;
  }

  return {
    prosA: validatedArrays.prosA!,
    consA: validatedArrays.consA!,
    prosB: validatedArrays.prosB!,
    consB: validatedArrays.consB!,
    reasoning: reasoning.trim(),
    strengthsFromA: validatedArrays.strengthsFromA!,
    strengthsFromB: validatedArrays.strengthsFromB!,
    improvements: validatedArrays.improvements!,
  };
}

/** Replace invalid `\'` escape sequences with literal apostrophes. JSON only allows
 *  `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` — `\'` is rejected by
 *  JSON.parse. The `(?<!\\)` lookbehind avoids touching `\\'` (escaped backslash
 *  followed by literal apostrophe, which is valid JSON). Conservative: only fixes
 *  the single most common LLM over-escape pattern, leaves everything else alone
 *  so legitimately malformed JSON still surfaces a parse error. */
function sanitizeInvalidEscapes(input: string): string {
  return input.replace(/(?<!\\)\\'/g, "'");
}

/** Remove optional ```json ... ``` markdown fences. Tolerant: matches any leading/trailing
 *  fence with optional language tag; if no fences present, returns input unchanged. */
function stripMarkdownFences(input: string): string {
  // Strip leading ```json or ``` (optionally with language tag) + newline.
  let out = input.replace(/^[\s]*```[a-zA-Z0-9]*[ \t]*\n?/, '');
  // Strip trailing ``` (optionally preceded by newline).
  out = out.replace(/\n?[ \t]*```[\s]*$/, '');
  return out;
}
