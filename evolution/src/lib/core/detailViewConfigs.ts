// Pure data map of detail view configurations keyed by detailType.
// No server imports — safe for client-side use. Synced against agent classes at test time.

import type { DetailFieldDef } from './types';

/** Config-driven field definitions for rendering execution detail, keyed by detailType (or agent_name). */
export const DETAIL_VIEW_CONFIGS: Record<string, DetailFieldDef[]> = {
  // ─── Parallel pipeline (generate_rank_evolution_parallel_20260331) ───
  generate_from_previous_article: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
        { key: 'initialTop15Cutoff', label: 'Initial Top-15% Cutoff', type: 'number' },
        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking.comparisons', label: 'Comparisons', type: 'table',
      columns: [
        { key: 'round', label: '#' },
        { key: 'opponentId', label: 'Opponent' },
        { key: 'selectionScore', label: 'Score' },
        { key: 'pWin', label: 'pWin' },
        { key: 'outcome', label: 'Out' },
        { key: 'variantEloAfter', label: 'Elo after' },
        { key: 'variantUncertaintyAfter', label: 'Uncertainty after' },
        { key: 'durationMs', label: 'ms' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  // ─── Reflect-and-generate (Phase 6 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430) ───
  // Mirrors the agent's detailViewConfig field-for-field so the parity test
  // (entities.test.ts:339) passes. Adds a reflection sub-tree before generation/ranking.
  reflect_and_generate_from_previous_article: [
    { key: 'tactic', label: 'Tactic Chosen', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'reflection', label: 'Reflection', type: 'object',
      children: [
        { key: 'tacticChosen', label: 'Picked', type: 'badge' },
        { key: 'cost', label: 'Reflection Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'reflection.tacticRanking', label: 'Ranked Tactics', type: 'table',
      columns: [
        { key: 'tactic', label: 'Tactic' },
        { key: 'reasoning', label: 'Reasoning' },
      ],
    },
    { key: 'reflection.candidatesPresented', label: 'Candidates Presented', type: 'list' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  swiss_ranking: [
    { key: 'status', label: 'Status', type: 'badge' },
    { key: 'eligibleCount', label: 'Eligible Count', type: 'number' },
    { key: 'pairsConsidered', label: 'Pairs Considered', type: 'number' },
    { key: 'pairsDispatched', label: 'Pairs Dispatched', type: 'number' },
    { key: 'pairsSucceeded', label: 'Pairs Succeeded', type: 'number' },
    { key: 'pairsFailedBudget', label: 'Pairs Failed (Budget)', type: 'number' },
    { key: 'pairsFailedOther', label: 'Pairs Failed (Other)', type: 'number' },
    { key: 'matchesProducedTotal', label: 'Matches Produced', type: 'number' },
    {
      key: 'matchesProduced', label: 'Matches', type: 'table',
      columns: [
        { key: 'winnerId', label: 'Winner' },
        { key: 'loserId', label: 'Loser' },
        { key: 'result', label: 'Result' },
        { key: 'confidence', label: 'Confidence' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  merge_ratings: [
    { key: 'iterationType', label: 'Iteration Type', type: 'badge' },
    {
      key: 'before', label: 'Pool Before Merge', type: 'object',
      children: [
        { key: 'poolSize', label: 'Pool Size', type: 'number' },
        { key: 'top15Cutoff', label: 'Top-15% Cutoff', type: 'number' },
      ],
    },
    {
      key: 'before.variants', label: 'Variants Before', type: 'table',
      columns: [
        { key: 'id', label: 'ID' },
        { key: 'elo', label: 'Elo' },
        { key: 'uncertainty', label: 'Uncertainty' },
        { key: 'matchCount', label: 'Matches' },
      ],
    },
    {
      key: 'input', label: 'Merge Input', type: 'object',
      children: [
        { key: 'matchBufferCount', label: 'Buffer Count', type: 'number' },
        { key: 'totalMatchesIn', label: 'Total Matches', type: 'number' },
        { key: 'newVariantsAdded', label: 'New Variants', type: 'number' },
      ],
    },
    {
      key: 'matchesApplied', label: 'Matches Applied (shuffled)', type: 'table',
      columns: [
        { key: 'indexInShuffledOrder', label: '#' },
        { key: 'winnerId', label: 'Winner' },
        { key: 'loserId', label: 'Loser' },
        { key: 'result', label: 'Result' },
        { key: 'confidence', label: 'Confidence' },
      ],
    },
    {
      key: 'after', label: 'Pool After Merge', type: 'object',
      children: [
        { key: 'poolSize', label: 'Pool Size', type: 'number' },
        { key: 'top15Cutoff', label: 'Top-15% Cutoff', type: 'number' },
        { key: 'top15CutoffDelta', label: 'Cutoff Δ', type: 'number' },
      ],
    },
    {
      key: 'after.variants', label: 'Variants After', type: 'table',
      columns: [
        { key: 'id', label: 'ID' },
        { key: 'elo', label: 'Elo' },
        { key: 'eloDelta', label: 'ΔElo' },
        { key: 'uncertainty', label: 'Uncertainty' },
        { key: 'uncertaintyDelta', label: 'ΔUncertainty' },
        { key: 'matchCount', label: 'Matches' },
      ],
    },
    { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  // ─── Legacy detail types (kept for historical invocation rendering) ───
  generation: [
    {
      key: 'strategies', label: 'Strategies', type: 'table',
      columns: [
        { key: 'name', label: 'Strategy' },
        { key: 'status', label: 'Status' },
        { key: 'promptLength', label: 'Prompt Length' },
        { key: 'textLength', label: 'Text Length' },
        { key: 'variantId', label: 'Variant ID' },
      ],
    },
    { key: 'feedbackUsed', label: 'Feedback Used', type: 'boolean' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  ranking: [
    {
      key: 'triage', label: 'Triage Results', type: 'table',
      columns: [
        { key: 'variantId', label: 'Variant' },
        { key: 'eliminated', label: 'Eliminated' },
        { key: 'ratingBefore', label: 'Rating Before' },
        { key: 'ratingAfter', label: 'Rating After' },
      ],
    },
    {
      key: 'fineRanking', label: 'Fine Ranking', type: 'object',
      children: [
        { key: 'rounds', label: 'Rounds', type: 'number' },
        { key: 'exitReason', label: 'Exit Reason', type: 'badge' },
        { key: 'convergenceStreak', label: 'Convergence Streak', type: 'number' },
      ],
    },
    { key: 'budgetTier', label: 'Budget Tier', type: 'badge' },
    { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
    { key: 'eligibleContenders', label: 'Eligible Contenders', type: 'number' },
    { key: 'flowEnabled', label: 'Flow Enabled', type: 'boolean' },
    { key: 'low_uncertainty_opponents_count', label: 'Low-Uncertainty Opponents', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  iterativeEditing: [
    { key: 'targetVariantId', label: 'Target Variant', type: 'text' },
    { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
    { key: 'consecutiveRejections', label: 'Consecutive Rejections', type: 'number' },
    {
      key: 'cycles', label: 'Edit Cycles', type: 'table',
      columns: [
        { key: 'cycleNumber', label: 'Cycle' },
        { key: 'verdict', label: 'Verdict' },
        { key: 'confidence', label: 'Confidence' },
        { key: 'formatValid', label: 'Format Valid' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  reflection: [
    {
      key: 'variantsCritiqued', label: 'Variants Critiqued', type: 'table',
      columns: [
        { key: 'variantId', label: 'Variant' },
        { key: 'status', label: 'Status' },
        { key: 'avgScore', label: 'Avg Score' },
      ],
    },
    { key: 'dimensions', label: 'Dimensions', type: 'list' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  debate: [
    {
      key: 'variantA', label: 'Variant A', type: 'object',
      children: [
        { key: 'id', label: 'ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    {
      key: 'variantB', label: 'Variant B', type: 'object',
      children: [
        { key: 'id', label: 'ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    { key: 'synthesisVariantId', label: 'Synthesis Variant', type: 'text' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  sectionDecomposition: [
    { key: 'targetVariantId', label: 'Target Variant', type: 'text' },
    { key: 'sectionsImproved', label: 'Sections Improved', type: 'number' },
    { key: 'totalEligible', label: 'Total Eligible', type: 'number' },
    { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
    {
      key: 'sections', label: 'Sections', type: 'table',
      columns: [
        { key: 'index', label: '#' },
        { key: 'heading', label: 'Heading' },
        { key: 'eligible', label: 'Eligible' },
        { key: 'improved', label: 'Improved' },
        { key: 'charCount', label: 'Chars' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  evolution: [
    { key: 'creativeExploration', label: 'Creative Exploration', type: 'boolean' },
    { key: 'creativeReason', label: 'Creative Reason', type: 'badge' },
    { key: 'feedbackUsed', label: 'Feedback Used', type: 'boolean' },
    {
      key: 'mutations', label: 'Mutations', type: 'table',
      columns: [
        { key: 'tactic', label: 'Tactic' },
        { key: 'status', label: 'Status' },
        { key: 'variantId', label: 'Variant' },
        { key: 'textLength', label: 'Text Length' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  treeSearch: [
    { key: 'rootVariantId', label: 'Root Variant', type: 'text' },
    { key: 'addedToPool', label: 'Added to Pool', type: 'boolean' },
    { key: 'bestLeafVariantId', label: 'Best Leaf Variant', type: 'text' },
    {
      key: 'result', label: 'Search Result', type: 'object',
      children: [
        { key: 'treeSize', label: 'Tree Size', type: 'number' },
        { key: 'maxDepth', label: 'Max Depth', type: 'number' },
        { key: 'prunedBranches', label: 'Pruned Branches', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  outlineGeneration: [
    { key: 'variantId', label: 'Variant', type: 'text' },
    { key: 'weakestStep', label: 'Weakest Step', type: 'badge' },
    {
      key: 'steps', label: 'Steps', type: 'table',
      columns: [
        { key: 'name', label: 'Step' },
        { key: 'score', label: 'Score' },
        { key: 'costUsd', label: 'Cost' },
        { key: 'inputLength', label: 'Input Len' },
        { key: 'outputLength', label: 'Output Len' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  proximity: [
    { key: 'newEntrants', label: 'New Entrants', type: 'number' },
    { key: 'existingVariants', label: 'Existing Variants', type: 'number' },
    { key: 'diversityScore', label: 'Diversity Score', type: 'number' },
    { key: 'totalPairsComputed', label: 'Total Pairs Computed', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
  metaReview: [
    { key: 'successfulStrategies', label: 'Successful Strategies', type: 'list' },
    { key: 'recurringWeaknesses', label: 'Recurring Weaknesses', type: 'list' },
    { key: 'patternsToAvoid', label: 'Patterns to Avoid', type: 'list' },
    { key: 'priorityImprovements', label: 'Priority Improvements', type: 'list' },
    {
      key: 'analysis', label: 'Analysis', type: 'object',
      children: [
        { key: 'activeStrategies', label: 'Active Strategies', type: 'number' },
        { key: 'poolDiversity', label: 'Pool Diversity', type: 'number' },
        { key: 'eloRange', label: 'Elo Range', type: 'number' },
        { key: 'bottomQuartileCount', label: 'Bottom Quartile Count', type: 'number' },
        { key: 'topVariantAge', label: 'Top Variant Age', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
};
