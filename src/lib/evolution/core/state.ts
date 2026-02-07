// Mutable pipeline state with append-only pool semantics.
// Central state model mutated in-place during agent execution, checkpointed to DB after each step.

import type {
  PipelineState,
  TextVariation,
  Match,
  Critique,
  MetaFeedback,
  DebateTranscript,
  SerializedPipelineState,
} from '../types';
import type { TreeSearchResult, TreeState } from '../treeOfThought/types';
import type { SectionEvolutionState } from '../section/types';
import { createRating, getOrdinal, eloToRating, type Rating } from './rating';

export class PipelineStateImpl implements PipelineState {
  iteration = 0;
  originalText = '';
  pool: TextVariation[] = [];
  poolIds: Set<string> = new Set();
  newEntrantsThisIteration: string[] = [];

  ratings: Map<string, Rating> = new Map();
  matchCounts: Map<string, number> = new Map();
  matchHistory: Match[] = [];

  dimensionScores: Record<string, Record<string, number>> | null = null;
  allCritiques: Critique[] | null = null;

  similarityMatrix: Record<string, Record<string, number>> | null = null;
  diversityScore: number | null = null;

  metaFeedback: MetaFeedback | null = null;

  debateTranscripts: DebateTranscript[] = [];

  treeSearchResults: TreeSearchResult[] | null = null;
  treeSearchStates: TreeState[] | null = null;
  sectionState: SectionEvolutionState | null = null;

  constructor(originalText: string = '') {
    this.originalText = originalText;
  }

  addToPool(variation: TextVariation): void {
    if (this.poolIds.has(variation.id)) return;
    this.pool.push(variation);
    this.poolIds.add(variation.id);
    this.newEntrantsThisIteration.push(variation.id);
    if (!this.ratings.has(variation.id)) {
      this.ratings.set(variation.id, createRating());
      this.matchCounts.set(variation.id, 0);
    }
  }

  startNewIteration(): void {
    this.iteration += 1;
    this.newEntrantsThisIteration = [];
  }

  getTopByRating(n: number): TextVariation[] {
    if (this.ratings.size === 0) return this.pool.slice(0, n);
    const sortedIds = [...this.ratings.entries()]
      .sort((a, b) => getOrdinal(b[1]) - getOrdinal(a[1]))
      .map(([id]) => id);
    const idToVar = new Map(this.pool.map((v) => [v.id, v]));
    return sortedIds
      .slice(0, n)
      .map((id) => idToVar.get(id))
      .filter((v): v is TextVariation => v !== undefined);
  }

  getPoolSize(): number {
    return this.pool.length;
  }
}

/** Serialize PipelineState to JSON-compatible object for checkpoint storage. */
export function serializeState(state: PipelineState): SerializedPipelineState {
  const ratingsObj: Record<string, { mu: number; sigma: number }> = {};
  for (const [id, r] of state.ratings) {
    ratingsObj[id] = { mu: r.mu, sigma: r.sigma };
  }
  return {
    iteration: state.iteration,
    originalText: state.originalText,
    pool: state.pool,
    newEntrantsThisIteration: state.newEntrantsThisIteration,
    ratings: ratingsObj,
    matchCounts: Object.fromEntries(state.matchCounts),
    matchHistory: state.matchHistory,
    dimensionScores: state.dimensionScores,
    allCritiques: state.allCritiques,
    similarityMatrix: state.similarityMatrix,
    diversityScore: state.diversityScore,
    metaFeedback: state.metaFeedback,
    debateTranscripts: state.debateTranscripts,
    treeSearchResults: state.treeSearchResults ?? null,
    treeSearchStates: state.treeSearchStates ?? null,
    sectionState: state.sectionState ?? null,
  };
}

/** Restore PipelineState from a serialized checkpoint. Handles both legacy (eloRatings) and new (ratings) formats. */
export function deserializeState(snapshot: SerializedPipelineState): PipelineStateImpl {
  const state = new PipelineStateImpl(snapshot.originalText);
  state.iteration = snapshot.iteration;
  state.pool = snapshot.pool;
  state.poolIds = new Set(snapshot.pool.map((v) => v.id));
  state.newEntrantsThisIteration = snapshot.newEntrantsThisIteration;
  state.matchCounts = new Map(Object.entries(snapshot.matchCounts));

  // Backward compat: if snapshot has legacy eloRatings but no ratings, convert
  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    state.ratings = new Map(
      Object.entries(snapshot.ratings).map(([id, r]) => [id, { mu: r.mu, sigma: r.sigma }]),
    );
  } else if (snapshot.eloRatings && Object.keys(snapshot.eloRatings).length > 0) {
    state.ratings = new Map(
      Object.entries(snapshot.eloRatings).map(([id, elo]) => [
        id,
        eloToRating(elo, state.matchCounts.get(id) ?? 0),
      ]),
    );
  }

  state.matchHistory = snapshot.matchHistory;
  state.dimensionScores = snapshot.dimensionScores;
  state.allCritiques = snapshot.allCritiques;
  state.similarityMatrix = snapshot.similarityMatrix;
  state.diversityScore = snapshot.diversityScore;
  state.metaFeedback = snapshot.metaFeedback;
  state.debateTranscripts = snapshot.debateTranscripts ?? [];
  state.treeSearchResults = snapshot.treeSearchResults ?? null;
  state.treeSearchStates = snapshot.treeSearchStates ?? null;
  state.sectionState = snapshot.sectionState ?? null;
  return state;
}
