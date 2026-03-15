// Unit tests for pipeline action types, summarizeActions, and actionContext.
// Verifies action construction and summary/context helper output for each action type.

import type { PipelineAction, AddToPool, RecordMatches, AppendCritiques, MergeFlowScores, SetDiversityScore, SetMetaFeedback, StartNewIteration, UpdateArenaSyncIndex } from './actions';
import { summarizeActions, actionContext } from './actions';
import type { TextVariation, Match, Critique, MetaFeedback } from '../types';

function makeVariation(id: string): TextVariation {
  return { id, text: `text-${id}`, version: 1, parentIds: [], strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0 };
}

function makeMatch(a: string, b: string): Match {
  return { variationA: a, variationB: b, winner: a, confidence: 0.8, turns: 1, dimensionScores: {} };
}

function makeCritique(varId: string): Critique {
  return { variationId: varId, dimensionScores: { clarity: 7 }, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'llm' };
}

describe('PipelineAction types', () => {
  it('ADD_TO_POOL action is constructable', () => {
    const action: AddToPool = { type: 'ADD_TO_POOL', variants: [makeVariation('v1')] };
    expect(action.type).toBe('ADD_TO_POOL');
    expect(action.variants).toHaveLength(1);
  });

  it('ADD_TO_POOL with presetRatings', () => {
    const action: AddToPool = {
      type: 'ADD_TO_POOL',
      variants: [makeVariation('v1')],
      presetRatings: { v1: { mu: 30, sigma: 5 } },
    };
    expect(action.presetRatings!.v1.mu).toBe(30);
  });

  it('START_NEW_ITERATION action', () => {
    const action: StartNewIteration = { type: 'START_NEW_ITERATION' };
    expect(action.type).toBe('START_NEW_ITERATION');
  });

  it('RECORD_MATCHES action', () => {
    const action: RecordMatches = {
      type: 'RECORD_MATCHES',
      matches: [makeMatch('v1', 'v2')],
      ratingUpdates: { v1: { mu: 26, sigma: 7 }, v2: { mu: 24, sigma: 7 } },
      matchCountIncrements: { v1: 1, v2: 1 },
    };
    expect(action.matches).toHaveLength(1);
  });

  it('APPEND_CRITIQUES action', () => {
    const action: AppendCritiques = {
      type: 'APPEND_CRITIQUES',
      critiques: [makeCritique('v1')],
      dimensionScoreUpdates: { v1: { clarity: 7 } },
    };
    expect(action.critiques).toHaveLength(1);
  });

  it('MERGE_FLOW_SCORES action', () => {
    const action: MergeFlowScores = {
      type: 'MERGE_FLOW_SCORES',
      variantScores: { v1: { 'flow:readability': 4 } },
    };
    expect(action.variantScores.v1['flow:readability']).toBe(4);
  });

  it('SET_DIVERSITY_SCORE action', () => {
    const action: SetDiversityScore = { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.75 };
    expect(action.diversityScore).toBe(0.75);
  });

  it('SET_META_FEEDBACK action', () => {
    const feedback: MetaFeedback = {
      recurringWeaknesses: ['weak'], priorityImprovements: ['improve'],
      successfulStrategies: ['good'], patternsToAvoid: ['bad'],
    };
    const action: SetMetaFeedback = { type: 'SET_META_FEEDBACK', feedback };
    expect(action.feedback.recurringWeaknesses).toHaveLength(1);
  });

  it('UPDATE_ARENA_SYNC_INDEX action', () => {
    const action: UpdateArenaSyncIndex = { type: 'UPDATE_ARENA_SYNC_INDEX', lastSyncedMatchIndex: 42 };
    expect(action.lastSyncedMatchIndex).toBe(42);
  });

  it('PipelineAction union accepts all types', () => {
    const actions: PipelineAction[] = [
      { type: 'ADD_TO_POOL', variants: [] },
      { type: 'START_NEW_ITERATION' },
      { type: 'RECORD_MATCHES', matches: [], ratingUpdates: {}, matchCountIncrements: {} },
      { type: 'APPEND_CRITIQUES', critiques: [], dimensionScoreUpdates: {} },
      { type: 'MERGE_FLOW_SCORES', variantScores: {} },
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0 },
      { type: 'SET_META_FEEDBACK', feedback: { recurringWeaknesses: [], priorityImprovements: [], successfulStrategies: [], patternsToAvoid: [] } },
      { type: 'UPDATE_ARENA_SYNC_INDEX', lastSyncedMatchIndex: 0 },
    ];
    expect(actions).toHaveLength(8);
  });
});

describe('summarizeActions', () => {
  it('summarizes ADD_TO_POOL', () => {
    const actions: PipelineAction[] = [{ type: 'ADD_TO_POOL', variants: [makeVariation('v1'), makeVariation('v2')] }];
    const summaries = summarizeActions(actions);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({ type: 'ADD_TO_POOL', count: 2, variantIds: ['v1', 'v2'] });
  });

  it('summarizes RECORD_MATCHES', () => {
    const actions: PipelineAction[] = [{
      type: 'RECORD_MATCHES',
      matches: [makeMatch('v1', 'v2')],
      ratingUpdates: { v1: { mu: 26, sigma: 7 } },
      matchCountIncrements: { v1: 1 },
    }];
    const summaries = summarizeActions(actions);
    expect(summaries[0]).toEqual({ type: 'RECORD_MATCHES', matchCount: 1, ratingUpdates: 1 });
  });

  it('summarizes mixed actions', () => {
    const actions: PipelineAction[] = [
      { type: 'ADD_TO_POOL', variants: [makeVariation('v1')] },
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.5 },
      { type: 'START_NEW_ITERATION' },
    ];
    const summaries = summarizeActions(actions);
    expect(summaries).toHaveLength(3);
    expect(summaries[2]).toEqual({ type: 'START_NEW_ITERATION' });
  });

  it('returns empty array for empty input', () => {
    expect(summarizeActions([])).toEqual([]);
  });
});

describe('actionContext', () => {
  it('ADD_TO_POOL context', () => {
    const ctx = actionContext({ type: 'ADD_TO_POOL', variants: [makeVariation('v1')] });
    expect(ctx).toEqual({ variantCount: 1, variantIds: ['v1'] });
  });

  it('SET_META_FEEDBACK context is empty', () => {
    const ctx = actionContext({
      type: 'SET_META_FEEDBACK',
      feedback: { recurringWeaknesses: [], priorityImprovements: [], successfulStrategies: [], patternsToAvoid: [] },
    });
    expect(ctx).toEqual({});
  });

  it('RECORD_MATCHES context', () => {
    const ctx = actionContext({
      type: 'RECORD_MATCHES',
      matches: [makeMatch('v1', 'v2'), makeMatch('v2', 'v3')],
      ratingUpdates: { v1: { mu: 26, sigma: 7 }, v2: { mu: 24, sigma: 7 } },
      matchCountIncrements: {},
    });
    expect(ctx).toEqual({ matchCount: 2, ratingsUpdated: 2 });
  });
});
