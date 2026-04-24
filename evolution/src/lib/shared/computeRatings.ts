// Rating math, pairwise comparison, FIFO cache, and 2-pass reversal — consolidated from
// rating.ts, comparisonCache.ts, reversalComparison.ts, and lib/comparison.ts.

import { rating as osRating, rate as osRate } from 'openskill';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// Rating (OpenSkill / Weng-Lin Bayesian — internal adapter)
// ═══════════════════════════════════════════════════════════════════
// OpenSkill works with {mu, sigma} internally. This module converts
// to/from {elo, uncertainty} at the boundary so all external code
// speaks Elo + confidence intervals.

/** Rating with Elo score and uncertainty (Elo-scale standard deviation). */
export type Rating = { elo: number; uncertainty: number };

/** Default Elo for a fresh rating (maps from openskill mu=25). */
export const DEFAULT_ELO = 1200;

// --- Internal constants for openskill ↔ Elo conversion ---
/** @internal Scale factor: 400 / 25 = 16. One mu unit = 16 Elo points. */
const ELO_SIGMA_SCALE = 400 / 25; // = 16

/** @internal Default openskill mu. */
const INTERNAL_DEFAULT_MU = 25;

/** @internal Default openskill sigma. */
const INTERNAL_DEFAULT_SIGMA = 25 / 3; // ≈ 8.333

/** Default uncertainty for a fresh rating (Elo-scale: sigma * 16 = 400/3 ≈ 133.33). */
export const DEFAULT_UNCERTAINTY = INTERNAL_DEFAULT_SIGMA * ELO_SIGMA_SCALE; // 400/3

/** Uncertainty threshold below which a rating is considered converged (Elo-scale).
 *  Equivalent to old sigma threshold of 4.5: 4.5 * 16 = 72. */
export const DEFAULT_CONVERGENCE_UNCERTAINTY = 4.5 * ELO_SIGMA_SCALE; // 72

// --- Legacy aliases for DB boundary code ---
// These are needed by buildRunContext.ts and persistRunResults.ts which read/write
// mu/sigma columns in the database. They should NOT be used outside DB boundary code.
/** @internal Openskill default mu — for DB boundary conversion only. */
export const _INTERNAL_DEFAULT_MU = INTERNAL_DEFAULT_MU;
/** @internal Openskill default sigma — for DB boundary conversion only. */
export const _INTERNAL_DEFAULT_SIGMA = INTERNAL_DEFAULT_SIGMA;
/** @internal Elo↔mu scale factor — for DB boundary conversion only. */
export const _INTERNAL_ELO_SIGMA_SCALE = ELO_SIGMA_SCALE;

// --- Internal conversion helpers ---
/** @internal Convert Elo to openskill mu (unclamped). */
function fromEloScale(elo: number): number {
  return (elo - DEFAULT_ELO) / ELO_SIGMA_SCALE + INTERNAL_DEFAULT_MU;
}

/** @internal Convert openskill mu to Elo (unclamped). */
function toEloScaleInternal(mu: number): number {
  return DEFAULT_ELO + (mu - INTERNAL_DEFAULT_MU) * ELO_SIGMA_SCALE;
}

/** Convert openskill mu to Elo, clamped to [0, 3000]. Used at DB boundary
 *  (buildRunContext, persistRunResults) to convert stored mu values. */
export function toEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, toEloScaleInternal(mu)));
}

/** Clamp an Elo value to [0, 3000] for display purposes only. */
export function toDisplayElo(elo: number): number {
  return Math.max(0, Math.min(3000, elo));
}

/** Convert a {mu, sigma} pair from the database to a Rating. */
export function dbToRating(mu: number, sigma: number): Rating {
  return {
    elo: toEloScaleInternal(mu),
    uncertainty: sigma * ELO_SIGMA_SCALE,
  };
}

/** Convert a Rating back to {mu, sigma} for database writes. */
/**
 * B038: `elo_score` is clamped to [0, 3000] for DB-display convenience, but the backing
 * `mu` / `sigma` round-trip unclamped. Leaderboards that sort by `elo_score` alone will
 * flatten true-high-Elo variants together (all at the 3000 ceiling) — but `dbToRating(mu,
 * sigma).elo` still reports the true value. Consumers should prefer `dbToRating` over
 * reading `elo_score` directly. The Phase 7 audit found no current leaderboard row with
 * `mu > 200` (elo_score > ~3000) in staging, so the divergence is theoretical today; if
 * it becomes observable, narrow the clamp range or remove it.
 */
export function ratingToDb(r: Rating): { mu: number; sigma: number; elo_score: number } {
  return {
    mu: fromEloScale(r.elo),
    sigma: r.uncertainty / ELO_SIGMA_SCALE,
    elo_score: toEloScale(fromEloScale(r.elo)),
  };
}

/** Create a fresh rating with default Elo and uncertainty. */
export function createRating(): Rating {
  const raw = osRating();
  return {
    elo: toEloScaleInternal(raw.mu),
    uncertainty: raw.sigma * ELO_SIGMA_SCALE,
  };
}

/**
 * Update ratings after a decisive match. Returns [newWinner, newLoser].
 * Both players' uncertainty decreases (reduced by observing outcome).
 */
export function updateRating(winner: Rating, loser: Rating): [Rating, Rating] {
  // Convert to openskill {mu, sigma} for the library call
  const wMu = { mu: fromEloScale(winner.elo), sigma: winner.uncertainty / ELO_SIGMA_SCALE };
  const lMu = { mu: fromEloScale(loser.elo), sigma: loser.uncertainty / ELO_SIGMA_SCALE };
  const result = osRate([[wMu], [lMu]], { rank: [1, 2], beta: 0 });
  const newW = result[0]?.[0];
  const newL = result[1]?.[0];
  if (!newW || !newL) {
    // B034: previously returned `[winner, loser]` silently, so match counts advanced but
    // ratings didn't — rankings became stale without any signal. Throw so callers see
    // the malformed openskill output immediately.
    throw new Error(
      `updateRating: osRate returned malformed pair (result=${JSON.stringify(result)})`,
    );
  }
  return [
    { elo: toEloScaleInternal(newW.mu), uncertainty: newW.sigma * ELO_SIGMA_SCALE },
    { elo: toEloScaleInternal(newL.mu), uncertainty: newL.sigma * ELO_SIGMA_SCALE },
  ];
}

/**
 * Update ratings after a draw. Returns [newA, newB].
 * Both players move toward each other slightly, uncertainty decreases.
 */
export function updateDraw(a: Rating, b: Rating): [Rating, Rating] {
  const aMu = { mu: fromEloScale(a.elo), sigma: a.uncertainty / ELO_SIGMA_SCALE };
  const bMu = { mu: fromEloScale(b.elo), sigma: b.uncertainty / ELO_SIGMA_SCALE };
  const result = osRate([[aMu], [bMu]], { rank: [1, 1], beta: 0 });
  const newA = result[0]?.[0];
  const newB = result[1]?.[0];
  if (!newA || !newB) {
    // B034: see updateRating — throw instead of silently no-op'ing.
    throw new Error(
      `updateDraw: osRate returned malformed pair (result=${JSON.stringify(result)})`,
    );
  }
  return [
    { elo: toEloScaleInternal(newA.mu), uncertainty: newA.sigma * ELO_SIGMA_SCALE },
    { elo: toEloScaleInternal(newB.mu), uncertainty: newB.sigma * ELO_SIGMA_SCALE },
  ];
}

/** Check if a rating has converged (uncertainty below threshold). */
export function isConverged(r: Rating, threshold: number = DEFAULT_CONVERGENCE_UNCERTAINTY): boolean {
  return r.uncertainty < threshold;
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

/** Returns null if cost is missing or zero. Elo is already in Elo scale. */
export function computeEloPerDollar(elo: number, totalCostUsd: number | null): number | null {
  if (totalCostUsd == null || totalCostUsd === 0) return null;
  return (elo - DEFAULT_ELO) / totalCostUsd;
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
    // B029: when `hA === hB` (identical texts), the sort-then-concat produced the same
    // key regardless of slot order, so `compare(x, x)` reused whatever result was stored
    // earlier — defeating position-bias detection on self-comparisons. Tag identical
    // inputs with a distinct sentinel so a self-comparison result doesn't pollute or
    // reuse a genuinely-asymmetric result.
    const body = hA === hB ? `${hA}|identical` : (hA < hB ? `${hA}|${hB}` : `${hB}|${hA}`);
    return `${body}|${structured}|${mode}`;
  }

  get(textA: string, textB: string, structured: boolean, mode = 'quality'): CachedMatch | undefined {
    const key = this.makeKey(textA, textB, structured, mode);
    const value = this.cache.get(key);
    if (value !== undefined) {
      // B032: LRU promotion — move the hit entry to the end of Map insertion order so
      // eviction drops truly cold entries, not oldest-inserted ones.
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(textA: string, textB: string, structured: boolean, result: CachedMatch, mode = 'quality'): void {
    // B040: also cache deterministic "unparseable" pairs (winnerId === null && !isDraw) —
    // otherwise the same noisy-model pair is re-queried every time, burning tokens. We
    // still skip confidence=0 pairs at the compareWithBiasMitigation layer, but the
    // cache itself now accepts them so repeats within a run are free.
    const key = this.makeKey(textA, textB, structured, mode);
    // B032: on overwrite, delete-then-set so the entry moves to the tail for LRU.
    this.cache.delete(key);
    this.cache.set(key, result);
    this.evictIfNeeded();
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

/**
 * Order-dependent cache key from two texts (SHA-256 of ordered pair).
 *
 * B039: this intentionally differs from `ComparisonCache.makeKey` (which is
 * order-INVARIANT via sorted hashes). The two keyings serve two call sites:
 *
 * 1. `compareWithBiasMitigation` (this file) — the result's `winner` is 'A' or 'B'
 *    relative to the argument order, so caching `compare(A, B)` under a key that
 *    conflates with `compare(B, A)` would return a "winner" pointing at the wrong slot.
 *    Order-dependent keying is required for correctness here.
 * 2. `ComparisonCache` — caches already-aggregated `{winnerId, loserId, ...}` results
 *    where winner identity is an explicit field (not a slot), so keying is safely
 *    order-invariant and self-comparisons are explicitly disambiguated (B029).
 *
 * These are deliberately different. The naming overlap was the source of the B039
 * confusion — hence this doc block.
 */
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

  // B033: cache partial-failure results at `confidence >= 0.3` (was `> 0.3`). The 0.3
  // boundary result (one forward pass succeeded + one null) is deterministic once
  // observed; re-querying it wastes 2 LLM calls per repeat on the same pair.
  if (cache && result.confidence >= 0.3) {
    cache.set(makeCacheKey(textA, textB), result);
  }
  return result;
}
