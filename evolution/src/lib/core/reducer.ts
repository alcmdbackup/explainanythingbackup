// Pure reducer for applying pipeline actions to immutable state.
// Dispatches each action type to the corresponding with*() method on PipelineStateImpl.

import type { PipelineAction } from './actions';
import type { PipelineStateImpl } from './state';

/** Apply a single action to state, returning a new state instance. */
export function applyAction(state: PipelineStateImpl, action: PipelineAction): PipelineStateImpl {
  switch (action.type) {
    case 'ADD_TO_POOL':
      return state.withAddedVariants(action.variants, action.presetRatings);
    case 'START_NEW_ITERATION':
      return state.withNewIteration();
    case 'RECORD_MATCHES':
      return state.withMatches(action.matches, action.ratingUpdates, action.matchCountIncrements);
    case 'APPEND_CRITIQUES':
      return state.withCritiques(action.critiques, action.dimensionScoreUpdates);
    case 'MERGE_FLOW_SCORES':
      return state.withFlowScores(action.variantScores);
    case 'SET_DIVERSITY_SCORE':
      return state.withDiversityScore(action.diversityScore);
    case 'SET_META_FEEDBACK':
      return state.withMetaFeedback(action.feedback);
    case 'UPDATE_ARENA_SYNC_INDEX':
      return state.withArenaSyncIndex(action.lastSyncedMatchIndex);
  }
}

/** Apply a sequence of actions to state, returning the final state. */
export function applyActions(state: PipelineStateImpl, actions: PipelineAction[]): PipelineStateImpl {
  return actions.reduce(applyAction, state);
}
