// Pipeline action types for the immutable state + reducer pattern.
// Each action represents a discrete state mutation that agents return instead of mutating state directly.

import type { Critique, Match, MetaFeedback, TextVariation } from '../types';

// --- Pool Actions ---

export interface AddToPool {
  type: 'ADD_TO_POOL';
  variants: TextVariation[];
  /** Optional pre-set ratings for variants (e.g. arena entries with existing ratings).
   *  If omitted, reducer auto-initializes default rating (mu=25, sigma=25/3) and matchCount=0. */
  presetRatings?: Record<string, { mu: number; sigma: number }>;
}

export interface StartNewIteration {
  type: 'START_NEW_ITERATION';
}

// --- Ranking Actions ---

export interface RecordMatches {
  type: 'RECORD_MATCHES';
  matches: Match[];
  ratingUpdates: Record<string, { mu: number; sigma: number }>;
  matchCountIncrements: Record<string, number>;
}

// --- Analysis Actions ---

export interface AppendCritiques {
  type: 'APPEND_CRITIQUES';
  critiques: Critique[];
  dimensionScoreUpdates: Record<string, Record<string, number>>;
}

export interface MergeFlowScores {
  type: 'MERGE_FLOW_SCORES';
  variantScores: Record<string, Record<string, number>>;
}

export interface SetDiversityScore {
  type: 'SET_DIVERSITY_SCORE';
  diversityScore: number;
}

export interface SetMetaFeedback {
  type: 'SET_META_FEEDBACK';
  feedback: MetaFeedback;
}

// --- Arena ---

export interface UpdateArenaSyncIndex {
  type: 'UPDATE_ARENA_SYNC_INDEX';
  lastSyncedMatchIndex: number;
}

// --- Union type ---

export type PipelineAction =
  | AddToPool
  | StartNewIteration
  | RecordMatches
  | AppendCritiques
  | MergeFlowScores
  | SetDiversityScore
  | SetMetaFeedback
  | UpdateArenaSyncIndex;

// --- Action summary types (for logging/dashboard) ---

export type ActionSummary =
  | { type: 'ADD_TO_POOL'; count: number; variantIds: string[] }
  | { type: 'RECORD_MATCHES'; matchCount: number; ratingUpdates: number }
  | { type: 'APPEND_CRITIQUES'; count: number; variantIds: string[] }
  | { type: 'MERGE_FLOW_SCORES'; variantCount: number }
  | { type: 'SET_DIVERSITY_SCORE'; score: number }
  | { type: 'SET_META_FEEDBACK' }
  | { type: 'START_NEW_ITERATION' }
  | { type: 'UPDATE_ARENA_SYNC_INDEX'; lastSyncedMatchIndex: number };

/** Aggregate action counts per type across a run. */
export type ActionCounts = Partial<Record<PipelineAction['type'], number>>;

/** Summarize actions into a compact log-friendly representation. */
export function summarizeActions(actions: PipelineAction[]): ActionSummary[] {
  return actions.map((a): ActionSummary => {
    switch (a.type) {
      case 'ADD_TO_POOL':
        return { type: a.type, count: a.variants.length, variantIds: a.variants.map(v => v.id) };
      case 'RECORD_MATCHES':
        return { type: a.type, matchCount: a.matches.length, ratingUpdates: Object.keys(a.ratingUpdates).length };
      case 'APPEND_CRITIQUES':
        return { type: a.type, count: a.critiques.length, variantIds: a.critiques.map(c => c.variationId) };
      case 'MERGE_FLOW_SCORES':
        return { type: a.type, variantCount: Object.keys(a.variantScores).length };
      case 'SET_DIVERSITY_SCORE':
        return { type: a.type, score: a.diversityScore };
      case 'SET_META_FEEDBACK':
        return { type: a.type };
      case 'START_NEW_ITERATION':
        return { type: a.type };
      case 'UPDATE_ARENA_SYNC_INDEX':
        return { type: a.type, lastSyncedMatchIndex: a.lastSyncedMatchIndex };
    }
  });
}

/** Extract log-friendly context from a single action for EvolutionLogger entries. */
export function actionContext(action: PipelineAction): Record<string, unknown> {
  switch (action.type) {
    case 'ADD_TO_POOL':
      return { variantCount: action.variants.length, variantIds: action.variants.map(v => v.id) };
    case 'RECORD_MATCHES':
      return { matchCount: action.matches.length, ratingsUpdated: Object.keys(action.ratingUpdates).length };
    case 'APPEND_CRITIQUES':
      return { critiqueCount: action.critiques.length };
    case 'MERGE_FLOW_SCORES':
      return { variantCount: Object.keys(action.variantScores).length };
    case 'SET_DIVERSITY_SCORE':
      return { score: action.diversityScore };
    case 'SET_META_FEEDBACK':
      return {};
    case 'START_NEW_ITERATION':
      return {};
    case 'UPDATE_ARENA_SYNC_INDEX':
      return { lastSyncedMatchIndex: action.lastSyncedMatchIndex };
  }
}
