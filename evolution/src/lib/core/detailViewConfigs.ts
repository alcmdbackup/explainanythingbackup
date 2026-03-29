// Pure data map of detail view configurations keyed by detailType.
// No server imports — safe for client-side use. Synced against agent classes at test time.

import type { DetailFieldDef } from './types';

/** Config-driven field definitions for rendering execution detail, keyed by detailType. */
export const DETAIL_VIEW_CONFIGS: Record<string, DetailFieldDef[]> = {
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
    { key: 'low_sigma_opponents_count', label: 'Low-σ Opponents', type: 'number' },
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
        { key: 'mu', label: 'Mu', type: 'number' },
      ],
    },
    {
      key: 'variantB', label: 'Variant B', type: 'object',
      children: [
        { key: 'id', label: 'ID', type: 'text' },
        { key: 'mu', label: 'Mu', type: 'number' },
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
        { key: 'strategy', label: 'Strategy' },
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
        { key: 'muRange', label: 'Mu Range', type: 'number' },
        { key: 'bottomQuartileCount', label: 'Bottom Quartile Count', type: 'number' },
        { key: 'topVariantAge', label: 'Top Variant Age', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
};
