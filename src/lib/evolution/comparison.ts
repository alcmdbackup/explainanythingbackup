// Standalone bias-mitigated pairwise comparison using 2-pass A/B reversal.
// Extracted from CalibrationRanker for reuse by hall of fame comparisons.

import { createHash } from 'crypto';

export interface ComparisonResult {
  winner: 'A' | 'B' | 'TIE';
  confidence: number;
  turns: number;
}

/** Build a prompt asking the LLM to compare two texts. */
export function buildComparisonPrompt(textA: string, textB: string): string {
  return `You are an expert writing evaluator. Compare the following two text variations and determine which is better.

## Text A
${textA}

## Text B
${textB}

## Evaluation Criteria
Consider the following when making your decision:
- Clarity and readability
- Structure and flow
- Engagement and impact
- Grammar and style
- Overall effectiveness

## Instructions
Respond with ONLY one of these exact answers:
- "A" if Text A is better
- "B" if Text B is better
- "TIE" if they are equally good

Your answer:`;
}

/** Parse an LLM response into a winner label (A, B, TIE) or null if unparseable.
 * PARSE-4: Structured match priority — exact > phrase > contains. Avoids
 * ambiguous matches like "ACTUALLY B" returning 'A' via startsWith. */
export function parseWinner(response: string): string | null {
  const upper = response.trim().toUpperCase();

  // 1. Exact single-token match
  if (['A', 'B', 'TIE'].includes(upper)) return upper;

  // 2. Phrase-level: check "TEXT A"/"TEXT B" first (more specific)
  const hasTextA = upper.includes('TEXT A');
  const hasTextB = upper.includes('TEXT B');
  if (hasTextA && !hasTextB) return 'A';
  if (hasTextB && !hasTextA) return 'B';

  // 3. TIE keyword
  if (upper.includes('TIE') || upper.includes('DRAW') || upper.includes('EQUAL')) return 'TIE';

  // 4. Single-letter start — only if first word is exactly "A" or "B"
  const firstWord = upper.split(/\s/)[0];
  if (['A', 'A.', 'A,'].includes(firstWord)) return 'A';
  if (['B', 'B.', 'B,'].includes(firstWord)) return 'B';

  return null;
}

/** Order-invariant cache key from two texts (SHA-256 of sorted pair). */
function makeCacheKey(textA: string, textB: string): string {
  const sorted = [textA, textB].sort();
  const payload = `${sorted[0].length}:${sorted[0]}|${sorted[1].length}:${sorted[1]}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Bias-mitigated pairwise comparison using 2-pass A/B reversal.
 * Runs the comparison twice with positions swapped to detect position bias.
 * Returns a ComparisonResult with winner relative to the original A/B order.
 *
 * Makes 2 sequential LLM calls via the callLLM callback. Does NOT catch errors —
 * callers must handle LLM failures.
 *
 * The callLLM callback abstracts away the provider — callers pass their own
 * LLM function (hall of fame service uses callLLMModel, pipeline uses ctx.llmClient.complete).
 * The optional cache parameter uses order-invariant SHA-256 keys.
 */
export async function compareWithBiasMitigation(
  textA: string,
  textB: string,
  callLLM: (prompt: string) => Promise<string>,
  cache?: Map<string, ComparisonResult>,
): Promise<ComparisonResult> {
  // Check cache first (order-invariant key)
  if (cache) {
    const key = makeCacheKey(textA, textB);
    const cached = cache.get(key);
    if (cached) return cached;
  }

  // First comparison: A vs B
  const response1 = await callLLM(buildComparisonPrompt(textA, textB));
  const winner1 = parseWinner(response1);

  // Second comparison: B vs A (reversed)
  const response2 = await callLLM(buildComparisonPrompt(textB, textA));
  const winner2Raw = parseWinner(response2);

  const winner2 = winner2Raw === 'A' ? 'B' : winner2Raw === 'B' ? 'A' : winner2Raw;

  let result: ComparisonResult;

  if (winner1 === null || winner2 === null) {
    const partial = winner1 ?? winner2;
    if (partial === 'A') return { winner: 'A', confidence: 0.3, turns: 2 };
    if (partial === 'B') return { winner: 'B', confidence: 0.3, turns: 2 };
    return { winner: 'TIE', confidence: 0.0, turns: 2 };
  }

  if (winner1 === winner2) {
    result = { winner: winner1 as 'A' | 'B' | 'TIE', confidence: 1.0, turns: 2 };
  } else if (winner1 === 'TIE' || winner2 === 'TIE') {
    const nonTie = winner1 === 'TIE' ? winner2 : winner1;
    result = { winner: nonTie as 'A' | 'B' | 'TIE', confidence: 0.7, turns: 2 };
  } else {
    result = { winner: 'TIE', confidence: 0.5, turns: 2 };
  }

  if (cache) {
    cache.set(makeCacheKey(textA, textB), result);
  }
  return result;
}
