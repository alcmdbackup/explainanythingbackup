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
import { ELO_CONSTANTS } from '../config';

export class PipelineStateImpl implements PipelineState {
  iteration = 0;
  originalText = '';
  pool: TextVariation[] = [];
  poolIds: Set<string> = new Set();
  newEntrantsThisIteration: string[] = [];

  eloRatings: Map<string, number> = new Map();
  matchCounts: Map<string, number> = new Map();
  matchHistory: Match[] = [];

  dimensionScores: Record<string, Record<string, number>> | null = null;
  allCritiques: Critique[] | null = null;

  similarityMatrix: Record<string, Record<string, number>> | null = null;
  diversityScore: number | null = null;

  metaFeedback: MetaFeedback | null = null;

  debateTranscripts: DebateTranscript[] = [];

  constructor(originalText: string = '') {
    this.originalText = originalText;
  }

  addToPool(variation: TextVariation): void {
    if (this.poolIds.has(variation.id)) return;
    this.pool.push(variation);
    this.poolIds.add(variation.id);
    this.newEntrantsThisIteration.push(variation.id);
    if (!this.eloRatings.has(variation.id)) {
      this.eloRatings.set(variation.id, ELO_CONSTANTS.INITIAL_RATING);
      this.matchCounts.set(variation.id, 0);
    }
  }

  startNewIteration(): void {
    this.iteration += 1;
    this.newEntrantsThisIteration = [];
  }

  getTopByElo(n: number): TextVariation[] {
    if (this.eloRatings.size === 0) return this.pool.slice(0, n);
    const sortedIds = [...this.eloRatings.entries()]
      .sort((a, b) => b[1] - a[1])
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
  return {
    iteration: state.iteration,
    originalText: state.originalText,
    pool: state.pool,
    newEntrantsThisIteration: state.newEntrantsThisIteration,
    eloRatings: Object.fromEntries(state.eloRatings),
    matchCounts: Object.fromEntries(state.matchCounts),
    matchHistory: state.matchHistory,
    dimensionScores: state.dimensionScores,
    allCritiques: state.allCritiques,
    similarityMatrix: state.similarityMatrix,
    diversityScore: state.diversityScore,
    metaFeedback: state.metaFeedback,
    debateTranscripts: state.debateTranscripts,
  };
}

/** Restore PipelineState from a serialized checkpoint. */
export function deserializeState(snapshot: SerializedPipelineState): PipelineStateImpl {
  const state = new PipelineStateImpl(snapshot.originalText);
  state.iteration = snapshot.iteration;
  state.pool = snapshot.pool;
  state.poolIds = new Set(snapshot.pool.map((v) => v.id));
  state.newEntrantsThisIteration = snapshot.newEntrantsThisIteration;
  state.eloRatings = new Map(Object.entries(snapshot.eloRatings));
  state.matchCounts = new Map(Object.entries(snapshot.matchCounts));
  state.matchHistory = snapshot.matchHistory;
  state.dimensionScores = snapshot.dimensionScores;
  state.allCritiques = snapshot.allCritiques;
  state.similarityMatrix = snapshot.similarityMatrix;
  state.diversityScore = snapshot.diversityScore;
  state.metaFeedback = snapshot.metaFeedback;
  state.debateTranscripts = snapshot.debateTranscripts ?? [];
  return state;
}
