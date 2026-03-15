// Mutable pipeline state with append-only pool semantics.
// Central state model mutated in-place during agent execution, checkpointed to DB after each step.

import type {
  ReadonlyPipelineState,
  TextVariation,
  Match,
  Critique,
  MetaFeedback,
  SerializedPipelineState,
} from '../types';
import { createRating, type Rating } from './rating';

/** Maximum number of match history entries preserved during serialization. */
export const MAX_MATCH_HISTORY = 5000;

/** Number of recent iterations whose critiques are preserved during serialization. */
export const MAX_CRITIQUE_ITERATIONS = 5;

export class PipelineStateImpl implements ReadonlyPipelineState {
  // --- Pool ---
  iteration = 0;
  originalText = '';
  pool: TextVariation[] = [];
  poolIds: Set<string> = new Set();
  newEntrantsThisIteration: string[] = [];

  // --- Ranking ---
  ratings: Map<string, Rating> = new Map();
  matchCounts: Map<string, number> = new Map();
  matchHistory: Match[] = [];

  /** Cached sorted-by-rating array; null means stale. Invalidated on pool/rating mutations. */
  private _sortedCache: TextVariation[] | null = null;
  /** Persistent id-to-variant lookup; updated incrementally in addToPool(). */
  private _idToVarMap: Map<string, TextVariation> = new Map();

  // --- Analysis ---
  dimensionScores: Record<string, Record<string, number>> | null = null;
  allCritiques: Critique[] = [];
  diversityScore: number = 0;
  metaFeedback: MetaFeedback | null = null;

  // --- Arena ---
  lastSyncedMatchIndex = 0;

  constructor(originalText: string = '') {
    this.originalText = originalText;
  }

  addToPool(variation: TextVariation): void {
    if (this.poolIds.has(variation.id)) return;
    this.pool.push(variation);
    this.poolIds.add(variation.id);
    this._idToVarMap.set(variation.id, variation);
    this._sortedCache = null;
    this.newEntrantsThisIteration.push(variation.id);
    if (!this.ratings.has(variation.id)) {
      this.ratings.set(variation.id, createRating());
      this.matchCounts.set(variation.id, 0);
    }
  }

  startNewIteration(): void {
    this.iteration += 1;
    this.newEntrantsThisIteration = [];
    this._sortedCache = null;
  }

  getTopByRating(n: number): TextVariation[] {
    if (this.ratings.size === 0) return this.pool.slice(0, n);
    if (this._sortedCache) return this._sortedCache.slice(0, n);

    const sortedIds = [...this.ratings.entries()]
      .sort((a, b) => b[1].mu - a[1].mu)
      .map(([id]) => id);
    const lookup = this._idToVarMap.size > 0 ? this._idToVarMap : new Map(this.pool.map((v) => [v.id, v]));
    const sorted = sortedIds
      .map((id) => lookup.get(id))
      .filter((v): v is TextVariation => v !== undefined);
    this._sortedCache = sorted;
    return sorted.slice(0, n);
  }

  /** Rebuild _idToVarMap from pool (used after deserialization which bypasses addToPool). */
  rebuildIdMap(): void {
    this._idToVarMap.clear();
    for (const v of this.pool) {
      this._idToVarMap.set(v.id, v);
    }
    this._sortedCache = null;
  }

  /** Invalidate the sorted cache (call after external rating mutations). */
  invalidateCache(): void {
    this._sortedCache = null;
  }

  getPoolSize(): number {
    return this.pool.length;
  }

  /** Look up a variant by ID. O(1) via internal id map. */
  getVariationById(id: string): TextVariation | undefined {
    if (this._idToVarMap.size === 0 && this.pool.length > 0) {
      this.rebuildIdMap();
    }
    return this._idToVarMap.get(id);
  }

  /** Check if a variant exists in the pool. */
  hasVariant(id: string): boolean {
    return this.poolIds.has(id);
  }

  // ─── Immutable with*() methods (return new PipelineStateImpl) ───

  /** Return a new state with variants added to pool. Auto-initializes default ratings for new variants. */
  withAddedVariants(variants: TextVariation[], presetRatings?: Record<string, { mu: number; sigma: number }>): PipelineStateImpl {
    const newVariants = variants.filter(v => !this.poolIds.has(v.id));
    if (newVariants.length === 0) return this;

    const next = this._shallowClone();
    next.pool = [...this.pool, ...newVariants];
    next.poolIds = new Set(this.poolIds);
    next._idToVarMap = new Map(this._idToVarMap);
    next.newEntrantsThisIteration = [...this.newEntrantsThisIteration, ...newVariants.map(v => v.id)];
    next.ratings = new Map(this.ratings);
    next.matchCounts = new Map(this.matchCounts);

    for (const v of newVariants) {
      next.poolIds.add(v.id);
      next._idToVarMap.set(v.id, v);
      if (!next.ratings.has(v.id)) {
        next.ratings.set(v.id, presetRatings?.[v.id] ?? createRating());
        next.matchCounts.set(v.id, 0);
      }
    }
    next._sortedCache = null;
    return next;
  }

  /** Return a new state with iteration incremented and newEntrantsThisIteration cleared. */
  withNewIteration(): PipelineStateImpl {
    const next = this._shallowClone();
    next.iteration = this.iteration + 1;
    next.newEntrantsThisIteration = [];
    next._sortedCache = null;
    return next;
  }

  /** Return a new state with matches, rating updates, and match count increments applied. */
  withMatches(
    matches: Match[],
    ratingUpdates: Record<string, { mu: number; sigma: number }>,
    matchCountIncrements: Record<string, number>,
  ): PipelineStateImpl {
    const next = this._shallowClone();
    next.matchHistory = [...this.matchHistory, ...matches];
    next.ratings = new Map(this.ratings);
    for (const [id, r] of Object.entries(ratingUpdates)) {
      next.ratings.set(id, { mu: r.mu, sigma: r.sigma });
    }
    next.matchCounts = new Map(this.matchCounts);
    for (const [id, inc] of Object.entries(matchCountIncrements)) {
      next.matchCounts.set(id, (next.matchCounts.get(id) ?? 0) + inc);
    }
    next._sortedCache = null;
    return next;
  }

  /** Return a new state with critiques appended and dimension scores updated. */
  withCritiques(
    critiques: Critique[],
    dimensionScoreUpdates: Record<string, Record<string, number>>,
  ): PipelineStateImpl {
    const next = this._shallowClone();
    next.allCritiques = [...this.allCritiques, ...critiques];
    if (Object.keys(dimensionScoreUpdates).length > 0) {
      next.dimensionScores = { ...(this.dimensionScores ?? {}) };
      for (const [variantId, scores] of Object.entries(dimensionScoreUpdates)) {
        next.dimensionScores[variantId] = { ...(next.dimensionScores[variantId] ?? {}), ...scores };
      }
    }
    return next;
  }

  /** Return a new state with flow scores merged into dimensionScores. */
  withFlowScores(variantScores: Record<string, Record<string, number>>): PipelineStateImpl {
    const next = this._shallowClone();
    next.dimensionScores = { ...(this.dimensionScores ?? {}) };
    for (const [variantId, scores] of Object.entries(variantScores)) {
      next.dimensionScores[variantId] = { ...(next.dimensionScores[variantId] ?? {}), ...scores };
    }
    return next;
  }

  /** Return a new state with diversity score set. */
  withDiversityScore(diversityScore: number): PipelineStateImpl {
    const next = this._shallowClone();
    next.diversityScore = diversityScore;
    return next;
  }

  /** Return a new state with meta feedback set. */
  withMetaFeedback(feedback: MetaFeedback): PipelineStateImpl {
    const next = this._shallowClone();
    next.metaFeedback = feedback;
    return next;
  }

  /** Return a new state with arena sync index updated. */
  withArenaSyncIndex(lastSyncedMatchIndex: number): PipelineStateImpl {
    const next = this._shallowClone();
    next.lastSyncedMatchIndex = lastSyncedMatchIndex;
    return next;
  }

  /** Shallow clone: shares all arrays/maps by reference. with*() methods copy only what they change. */
  private _shallowClone(): PipelineStateImpl {
    const clone = new PipelineStateImpl(this.originalText);
    return Object.assign(clone, {
      iteration: this.iteration,
      pool: this.pool,
      poolIds: this.poolIds,
      newEntrantsThisIteration: this.newEntrantsThisIteration,
      ratings: this.ratings,
      matchCounts: this.matchCounts,
      matchHistory: this.matchHistory,
      dimensionScores: this.dimensionScores,
      allCritiques: this.allCritiques,
      diversityScore: this.diversityScore,
      metaFeedback: this.metaFeedback,
      lastSyncedMatchIndex: this.lastSyncedMatchIndex,
      _idToVarMap: this._idToVarMap,
      _sortedCache: this._sortedCache,
    }) as PipelineStateImpl;
  }
}

/** Serialize PipelineState to JSON-compatible object for checkpoint storage. */
export function serializeState(state: ReadonlyPipelineState): SerializedPipelineState {
  const ratingsObj: Record<string, { mu: number; sigma: number }> = {};
  for (const [id, r] of state.ratings) {
    ratingsObj[id] = { mu: r.mu, sigma: r.sigma };
  }

  // Truncate matchHistory to last MAX_MATCH_HISTORY entries (keep full in-memory)
  const matchHistory =
    state.matchHistory.length > MAX_MATCH_HISTORY
      ? state.matchHistory.slice(-MAX_MATCH_HISTORY)
      : state.matchHistory;

  // Truncate allCritiques to entries from the last MAX_CRITIQUE_ITERATIONS iterations.
  // Critiques are linked to variants via variationId; keep those whose variant was born
  // within the last N iterations. Fallback: keep all if pool lookup unavailable.
  let allCritiques: Critique[] = [...state.allCritiques];
  if (allCritiques.length > 0 && state.iteration >= MAX_CRITIQUE_ITERATIONS) {
    const minIteration = state.iteration - MAX_CRITIQUE_ITERATIONS + 1;
    const poolMap = new Map(state.pool.map((v) => [v.id, v]));
    allCritiques = allCritiques.filter((c) => {
      const variant = poolMap.get(c.variationId);
      // Keep if variant not found (defensive) or born within window
      return !variant || variant.iterationBorn >= minIteration;
    });
  }

  return {
    iteration: state.iteration,
    originalText: state.originalText,
    pool: [...state.pool],
    newEntrantsThisIteration: [...state.newEntrantsThisIteration],
    ratings: ratingsObj,
    matchCounts: Object.fromEntries(state.matchCounts),
    matchHistory: [...matchHistory],
    dimensionScores: state.dimensionScores ? { ...state.dimensionScores } : null,
    allCritiques: allCritiques.length > 0 ? allCritiques : null,
    diversityScore: state.diversityScore || null,
    metaFeedback: state.metaFeedback ? { ...state.metaFeedback } : null,
    lastSyncedMatchIndex: state.lastSyncedMatchIndex,
  };
}

/** Restore PipelineState from a serialized checkpoint. */
export function deserializeState(snapshot: SerializedPipelineState): PipelineStateImpl {
  const state = new PipelineStateImpl(snapshot.originalText);
  state.iteration = snapshot.iteration;
  state.pool = snapshot.pool;
  state.poolIds = new Set(snapshot.pool.map((v) => v.id));
  state.newEntrantsThisIteration = snapshot.newEntrantsThisIteration;
  state.matchCounts = new Map(Object.entries(snapshot.matchCounts));

  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    state.ratings = new Map(
      Object.entries(snapshot.ratings).map(([id, r]) => [id, { mu: r.mu, sigma: r.sigma }]),
    );
  }

  state.matchHistory = snapshot.matchHistory;
  state.dimensionScores = snapshot.dimensionScores;
  state.allCritiques = snapshot.allCritiques ?? [];
  state.diversityScore = snapshot.diversityScore ?? 0;
  state.metaFeedback = snapshot.metaFeedback;
  state.lastSyncedMatchIndex = snapshot.lastSyncedMatchIndex ?? 0;
  state.rebuildIdMap();
  return state;
}
