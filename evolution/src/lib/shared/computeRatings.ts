// Rating math, pairwise comparison, FIFO cache, and 2-pass reversal — consolidated from
// rating.ts, comparisonCache.ts, reversalComparison.ts, and lib/comparison.ts.

import { rating as osRating, rate as osRate } from 'openskill';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// Rating (OpenSkill / Weng-Lin Bayesian)
// ═══════════════════════════════════════════════════════════════════

/** Bayesian rating with skill estimate (mu) and uncertainty (sigma). */
export type Rating = { mu: number; sigma: number };

/** Default mu for a fresh rating (openskill default). */
export const DEFAULT_MU = 25;

/** Scale factor for converting sigma to Elo-scale uncertainty. */
export const ELO_SIGMA_SCALE = 400 / DEFAULT_MU;

/** Default sigma for a fresh rating (openskill default). */
export const DEFAULT_SIGMA = 25 / 3; // ≈ 8.333

/** Sigma threshold below which a rating is considered converged.
 *  Raised from 3.0 to 4.5 to reduce comparisons needed (~59 → ~18).
 *  Widens Elo CI from ±94 to ±141 — acceptable for winner selection. */
export const DEFAULT_CONVERGENCE_SIGMA = 4.5;

/** Create a fresh rating with default mu/sigma. */
export function createRating(): Rating {
  return osRating();
}

/**
 * Update ratings after a decisive match. Returns [newWinner, newLoser].
 * Both players' sigma decreases (uncertainty reduced by observing outcome).
 */
export function updateRating(winner: Rating, loser: Rating): [Rating, Rating] {
  const result = osRate([[winner], [loser]], { rank: [1, 2], beta: 0 });
  const newWinner = result[0]?.[0];
  const newLoser = result[1]?.[0];
  if (!newWinner || !newLoser) return [winner, loser];
  return [newWinner, newLoser];
}

/**
 * Update ratings after a draw. Returns [newA, newB].
 * Both players move toward each other slightly, sigma decreases.
 */
export function updateDraw(a: Rating, b: Rating): [Rating, Rating] {
  const result = osRate([[a], [b]], { rank: [1, 1], beta: 0 });
  const newA = result[0]?.[0];
  const newB = result[1]?.[0];
  if (!newA || !newB) return [a, b];
  return [newA, newB];
}

/** Check if a rating has converged (sigma below threshold). */
export function isConverged(r: Rating, threshold: number = DEFAULT_CONVERGENCE_SIGMA): boolean {
  return r.sigma < threshold;
}

/** Map mu to the 0–3000 Elo scale: 1200 + (mu - 25) * 16, clamped to [0, 3000]. */
export function toEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, 1200 + (mu - DEFAULT_MU) * ELO_SIGMA_SCALE));
}

/** Format an Elo value as a rounded integer string for display. */
export function formatElo(value: number): string {
  return Math.round(value).toString();
}

/** Strip markdown heading markers and return the first line, truncated with ellipsis. */
export function stripMarkdownTitle(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.replace(/^#{1,6}\s+/, '').trim();
}

export const DECISIVE_CONFIDENCE_THRESHOLD = 0.6;

/** Returns null if cost is missing or zero. */
export function computeEloPerDollar(mu: number, totalCostUsd: number | null): number | null {
  if (totalCostUsd == null || totalCostUsd === 0) return null;
  return (toEloScale(mu) - 1200) / totalCostUsd;
}

// ═══════════════════════════════════════════════════════════════════
// Comparison Cache (FIFO)
// ═══════════════════════════════════════════════════════════════════

/** Maximum number of entries before FIFO eviction kicks in. */
export const MAX_CACHE_SIZE = 500;

export interface CachedMatch {
  winnerId: string | null;
  loserId: string | null;
  confidence: number;
  isDraw: boolean;
}

export class ComparisonCache {
  private cache = new Map<string, CachedMatch>();
  private textHashCache = new Map<string, string>();
  private maxSize: number;

  constructor(maxSize: number = MAX_CACHE_SIZE) {
    this.maxSize = maxSize;
  }

  private hashText(text: string): string {
    let h = this.textHashCache.get(text);
    if (h === undefined) {
      h = createHash('sha256').update(text).digest('hex');
      this.textHashCache.set(text, h);
    }
    return h;
  }

  private makeKey(textA: string, textB: string, structured: boolean, mode = 'quality'): string {
    const hA = this.hashText(textA);
    const hB = this.hashText(textB);
    const sorted = hA < hB ? `${hA}|${hB}` : `${hB}|${hA}`;
    return `${sorted}|${structured}|${mode}`;
  }

  get(textA: string, textB: string, structured: boolean, mode = 'quality'): CachedMatch | undefined {
    return this.cache.get(this.makeKey(textA, textB, structured, mode));
  }

  set(textA: string, textB: string, structured: boolean, result: CachedMatch, mode = 'quality'): void {
    if (result.winnerId !== null || result.isDraw) {
      const key = this.makeKey(textA, textB, structured, mode);
      this.cache.set(key, result);
      this.evictIfNeeded();
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxSize) return;
    const toDelete = this.cache.size - this.maxSize;
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (deleted >= toDelete) break;
      this.cache.delete(key);
      deleted++;
    }
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.textHashCache.clear();
  }

  entries(): Array<[string, CachedMatch]> {
    return [...this.cache.entries()];
  }

  static fromEntries(entries: Array<[string, CachedMatch]>, maxSize: number = MAX_CACHE_SIZE): ComparisonCache {
    const cache = new ComparisonCache(maxSize);
    const startIdx = entries.length > maxSize ? entries.length - maxSize : 0;
    for (let i = startIdx; i < entries.length; i++) {
      cache.cache.set(entries[i]![0], entries[i]![1]);
    }
    return cache;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2-Pass Reversal Runner
// ═══════════════════════════════════════════════════════════════════

export interface ReversalConfig<TParsed, TResult> {
  buildPrompts: () => { forward: string; reverse: string };
  callLLM: (prompt: string) => Promise<string>;
  parseResponse: (response: string) => TParsed;
  aggregate: (forwardParsed: TParsed, reverseParsed: TParsed) => TResult;
}

export async function run2PassReversal<TParsed, TResult>(
  config: ReversalConfig<TParsed, TResult>,
): Promise<TResult> {
  const { forward, reverse } = config.buildPrompts();
  const [forwardResponse, reverseResponse] = await Promise.all([
    config.callLLM(forward),
    config.callLLM(reverse),
  ]);
  const forwardParsed = config.parseResponse(forwardResponse);
  const reverseParsed = config.parseResponse(reverseResponse);
  return config.aggregate(forwardParsed, reverseParsed);
}

// ═══════════════════════════════════════════════════════════════════
// Bias-Mitigated Pairwise Comparison
// ═══════════════════════════════════════════════════════════════════

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
 * PARSE-4: Structured match priority — exact > phrase > contains. */
export function parseWinner(response: string): string | null {
  const upper = response.trim().toUpperCase();

  if (['A', 'B', 'TIE'].includes(upper)) return upper;

  const hasTextA = upper.includes('TEXT A');
  const hasTextB = upper.includes('TEXT B');
  if (hasTextA && !hasTextB) return 'A';
  if (hasTextB && !hasTextA) return 'B';
  // Both mentioned — check for winner phrasing patterns
  if (hasTextA && hasTextB) {
    const winnerA = /TEXT A\s*(IS|WINS|IS BETTER|IS SUPERIOR)/i.test(upper);
    const winnerB = /TEXT B\s*(IS|WINS|IS BETTER|IS SUPERIOR)/i.test(upper);
    if (winnerA && !winnerB) return 'A';
    if (winnerB && !winnerA) return 'B';
  }

  if (upper.includes('TIE') || upper.includes('DRAW') || upper.includes('EQUAL')) return 'TIE';

  // Scoped fallback for "Your answer: A/B" format (observed in Qwen3 8B with thinking
  // disabled). Requires the literal "Your answer:" prefix and a word boundary after
  // the captured letter so that "Your answer: Apple" does NOT match 'A' and
  // "Your answer: Bother" does NOT match 'B'. Allows optional markdown bold (`**`).
  const yourAnswerMatch = /^\s*YOUR ANSWER\s*:\s*\*{0,2}\s*([AB])(?![A-Z])/.exec(upper);
  if (yourAnswerMatch) return yourAnswerMatch[1]!;

  const firstWord = upper.split(/\s/)[0]!;
  if (['A', 'A.', 'A,'].includes(firstWord)) return 'A';
  if (['B', 'B.', 'B,'].includes(firstWord)) return 'B';

  return null;
}

/** Order-dependent cache key from two texts (SHA-256 of ordered pair).
 *  The key preserves call order so that compare(A,B) and compare(B,A) produce
 *  distinct cache entries, since the winner field ('A'/'B') is relative to call order. */
function makeCacheKey(textA: string, textB: string): string {
  const payload = `${textA.length}:${textA}|${textB.length}:${textB}`;
  return createHash('sha256').update(payload).digest('hex');
}

function flipWinner(winner: string | null): string | null {
  if (winner === 'A') return 'B';
  if (winner === 'B') return 'A';
  return winner;
}

/** Aggregate two parsed winners (in original-frame) into a ComparisonResult. */
export function aggregateWinners(
  forward: string | null,
  reverse: string | null,
): ComparisonResult {
  const reverseFlipped = flipWinner(reverse);

  if (forward === null || reverseFlipped === null) {
    const partial = forward ?? reverseFlipped;
    if (partial === 'A') return { winner: 'A', confidence: 0.3, turns: 2 };
    if (partial === 'B') return { winner: 'B', confidence: 0.3, turns: 2 };
    return { winner: 'TIE', confidence: 0.0, turns: 2 };
  }

  if (forward === reverseFlipped) {
    return { winner: forward as 'A' | 'B' | 'TIE', confidence: 1.0, turns: 2 };
  }
  if (forward === 'TIE' || reverseFlipped === 'TIE') {
    const nonTie = forward === 'TIE' ? reverseFlipped : forward;
    return { winner: nonTie as 'A' | 'B' | 'TIE', confidence: 0.7, turns: 2 };
  }
  return { winner: 'TIE', confidence: 0.5, turns: 2 };
}

/**
 * Bias-mitigated pairwise comparison using 2-pass A/B reversal.
 * Runs the comparison twice with positions swapped to detect position bias.
 * Makes 2 parallel LLM calls. Does NOT catch errors — callers handle failures.
 */
export async function compareWithBiasMitigation(
  textA: string,
  textB: string,
  callLLM: (prompt: string) => Promise<string>,
  cache?: Map<string, ComparisonResult>,
): Promise<ComparisonResult> {
  if (cache) {
    const key = makeCacheKey(textA, textB);
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const result = await run2PassReversal<string | null, ComparisonResult>({
    buildPrompts: () => ({
      forward: buildComparisonPrompt(textA, textB),
      reverse: buildComparisonPrompt(textB, textA),
    }),
    callLLM,
    parseResponse: parseWinner,
    aggregate: aggregateWinners,
  });

  if (cache && result.confidence > 0.3) {
    cache.set(makeCacheKey(textA, textB), result);
  }
  return result;
}
