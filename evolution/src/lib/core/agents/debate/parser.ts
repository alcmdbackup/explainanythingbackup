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
 * Validates all 9 required fields:
 *   - winner: 'A' | 'B' | 'tie'
 *   - reasoning: non-empty string
 *   - prosA, consA, prosB, consB, strengthsFromA, strengthsFromB, improvements:
 *     non-empty string arrays (each entry trimmed; empties dropped)
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
  } catch (err) {
    throw new DebateParseError(
      `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      rawResponse,
      err,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DebateParseError(
      `Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      rawResponse,
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Validate winner enum.
  const winner = obj.winner;
  if (winner !== 'A' && winner !== 'B' && winner !== 'tie') {
    throw new DebateParseError(
      `Invalid winner: expected 'A' | 'B' | 'tie', got ${JSON.stringify(winner)}`,
      rawResponse,
    );
  }

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
    winner,
    reasoning: reasoning.trim(),
    strengthsFromA: validatedArrays.strengthsFromA!,
    strengthsFromB: validatedArrays.strengthsFromB!,
    improvements: validatedArrays.improvements!,
  };
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
