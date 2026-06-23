// Pure data map of detail view configurations keyed by detailType.
// No server imports — safe for client-side use. Synced against agent classes at test time.

import type { DetailFieldDef } from './types';

/** Config-driven field definitions for rendering execution detail, keyed by detailType (or agent_name). */
export const DETAIL_VIEW_CONFIGS: Record<string, DetailFieldDef[]> = {
  // B004-S3: matches CreateSeedArticleAgent.detailViewConfig — without this entry,
  // the seed-invocation page rendered an empty fallback.
  create_seed_article: [
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'titleLength', label: 'Title Length', type: 'number' },
        { key: 'contentLength', label: 'Content Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
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
  evaluate_criteria_then_generate_from_previous_article: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'weakestCriteriaNames', label: 'Weakest Criteria', type: 'list' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'evaluateAndSuggest', label: 'Eval & Suggest', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'evaluateAndSuggest.criteriaScored', label: 'Criteria Scored', type: 'table',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'score', label: 'Score' },
        { key: 'minRating', label: 'Min' },
        { key: 'maxRating', label: 'Max' },
      ],
    },
    {
      // Suggestions table cells can hold passage-length text (Example field is a
      // verbatim article excerpt, often hundreds of chars). Per-field cellClassName
      // constrains column width and wraps long content so the table stays readable
      // without horizontal scroll. Scoped to this table only — does NOT cascade to
      // the criteriaScored table above or other agents' detail tables.
      key: 'evaluateAndSuggest.suggestions', label: 'Suggestions', type: 'table',
      cellClassName: 'py-1.5 px-2 text-[var(--text-primary)] max-w-md break-words whitespace-pre-wrap align-top',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'examplePassage', label: 'Example' },
        { key: 'whatNeedsAddressing', label: 'Issue' },
        { key: 'suggestedFix', label: 'Fix' },
      ],
    },
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
  single_pass_evaluate_criteria_and_generate: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'weakestCriteriaNames', label: 'Weakest Criteria', type: 'list' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'evaluateAndSuggest', label: 'Eval & Suggest', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'evaluateAndSuggest.criteriaScored', label: 'Criteria Scored', type: 'table',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'score', label: 'Score' },
        { key: 'minRating', label: 'Min' },
        { key: 'maxRating', label: 'Max' },
      ],
    },
    {
      key: 'evaluateAndSuggest.suggestions', label: 'Suggestions', type: 'table',
      cellClassName: 'py-1.5 px-2 text-[var(--text-primary)] max-w-md break-words whitespace-pre-wrap align-top',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'examplePassage', label: 'Example' },
        { key: 'whatNeedsAddressing', label: 'Issue' },
        { key: 'suggestedFix', label: 'Fix' },
      ],
    },
    {
      key: 'guardrails', label: 'Guardrails (observational)', type: 'object',
      children: [
        { key: 'redundancyDropCount', label: 'Redundancy Drops', type: 'number' },
        { key: 'flowDropCount', label: 'Flow Drops', type: 'number' },
        { key: 'lengthCapHit', label: 'Length Cap Hit (>1.10×)', type: 'boolean' },
      ],
    },
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
  proposer_approver_criteria_generate: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'weakestCriteriaNames', label: 'Weakest Criteria', type: 'list' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    { key: 'mirrorAgreementRate', label: 'Mirror Agreement Rate', type: 'number', formatter: 'percent' },
    { key: 'mirrorAbortReason', label: 'Mirror Abort Reason', type: 'badge' },
    {
      key: 'evaluateAndSuggest', label: 'Eval & Suggest', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'evaluateAndSuggest.criteriaScored', label: 'Criteria Scored', type: 'table',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'score', label: 'Score' },
        { key: 'minRating', label: 'Min' },
        { key: 'maxRating', label: 'Max' },
      ],
    },
    {
      key: 'evaluateAndSuggest.suggestions', label: 'Suggestions', type: 'table',
      cellClassName: 'py-1.5 px-2 text-[var(--text-primary)] max-w-md break-words whitespace-pre-wrap align-top',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'examplePassage', label: 'Example' },
        { key: 'whatNeedsAddressing', label: 'Issue' },
        { key: 'suggestedFix', label: 'Fix' },
      ],
    },
    {
      key: 'cycles.0', label: 'Edit Cycle (Forward + Mirror)', type: 'object',
      children: [
        { key: 'proposedGroupsRaw', label: 'Proposed Groups (raw)', type: 'number' },
        { key: 'approverGroups', label: 'After Pre-Validation', type: 'number' },
        { key: 'appliedGroups', label: 'Final Applied', type: 'number' },
        { key: 'proposeCostUsd', label: 'Propose Cost', type: 'number', formatter: 'cost' },
        { key: 'approveForwardCostUsd', label: 'Forward Approver Cost', type: 'number', formatter: 'cost' },
        { key: 'approveMirrorCostUsd', label: 'Mirror Approver Cost', type: 'number', formatter: 'cost' },
      ],
    },
    {
      key: 'cycles.0.forwardDecisions', label: 'Forward Decisions', type: 'table',
      columns: [
        { key: 'groupNumber', label: '#' },
        { key: 'decision', label: 'Decision' },
        { key: 'reason', label: 'Reason' },
        { key: 'redundancy_violation', label: 'Redundancy?' },
        { key: 'flow_violation', label: 'Flow?' },
        { key: 'length_violation', label: 'Length?' },
      ],
    },
    {
      key: 'cycles.0.mirrorDecisions', label: 'Mirror Decisions', type: 'table',
      columns: [
        { key: 'groupNumber', label: '#' },
        { key: 'decision', label: 'Decision (null = short-circuit / parse-fail)' },
        { key: 'reason', label: 'Reason' },
      ],
    },
    {
      key: 'cycles.0.droppedPreApprover', label: 'Dropped Pre-Approver (validator)', type: 'table',
      columns: [
        { key: 'groupNumber', label: '#' },
        { key: 'reason', label: 'Reason' },
      ],
    },
    {
      key: 'cycles.0.droppedPostApprover', label: 'Dropped Post-Approver (aggregator + applier)', type: 'table',
      columns: [
        { key: 'groupNumber', label: '#' },
        { key: 'reason', label: 'Reason' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
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
  iterative_editing: [
    { key: 'parentVariantId', label: 'Parent Variant', type: 'text' },
    { key: 'finalVariantId', label: 'Final Variant', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
    { key: 'errorPhase', label: 'Error Phase', type: 'badge' },
    { key: 'errorMessage', label: 'Error Message', type: 'text' },
    {
      key: 'config', label: 'Configuration', type: 'object',
      children: [
        { key: 'maxCycles', label: 'Max Cycles', type: 'number' },
        { key: 'editingModel', label: 'Editing Model', type: 'text' },
        { key: 'approverModel', label: 'Approver Model', type: 'text' },
        { key: 'driftRecoveryModel', label: 'Drift Recovery Model', type: 'text' },
        { key: 'perInvocationBudgetUsd', label: 'Per-Invocation Budget', type: 'number', formatter: 'cost' },
      ],
    },
    {
      key: 'cycles', label: 'Edit Cycles', type: 'table',
      columns: [
        { key: 'cycleNumber', label: 'Cycle' },
        { key: 'acceptedCount', label: 'Accepted' },
        { key: 'rejectedCount', label: 'Rejected' },
        { key: 'appliedCount', label: 'Applied' },
        { key: 'sizeRatio', label: 'Size Ratio' },
        { key: 'proposeCostUsd', label: 'Propose $' },
        { key: 'approveCostUsd', label: 'Approve $' },
      ],
    },
    // Per-cycle annotated edits view (Phase 4.8). Reads cycles[0] by default —
    // multi-cycle UX renders one block per cycle in a future iteration.
    {
      key: 'cycles.0', label: 'Annotated Edits (Cycle 1)', type: 'annotated-edits',
      markupKey: 'cycles.0.proposedMarkup',
      groupsKey: 'cycles.0.proposedGroupsRaw',
      decisionsKey: 'cycles.0.reviewDecisions',
      dropsPreKey: 'cycles.0.droppedPreApprover',
      dropsPostKey: 'cycles.0.droppedPostApprover',
    },
    // Phase 5.1 — post-cycle ranking detail (mirrors GFPA's ranking blocks at
    // lines 50–75 above). Only renders when the agent ran the ranking step
    // (input-presence gate); when ranking was skipped, the field is null and
    // the renderer collapses the section.
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
  // bring_back_debate_agent_20260506 Phase 4.1 — V2 Option-C config replacing the V1
  // orphan entry. Key is the FULL detailType literal (matches the schema parity check
  // in entities.test.ts). Reasoning-trace block is format-aware per Phase 1.20: the
  // UI reads execution_detail.debate.combined.reasoningTraceFormat to render
  // 'Reasoning Trace (verbatim)' / 'Reasoning Summary (provider-summarized)' /
  // 'Thinking happened but provider did not return trace text' headers.
  debate_then_generate_from_previous_article: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'variantA', label: "Parent A (Top-Elo)", type: 'object',
      children: [
        { key: 'id', label: 'Variant ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    {
      key: 'variantB', label: 'Parent B', type: 'object',
      children: [
        { key: 'id', label: 'Variant ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    {
      key: 'debate.combined', label: 'Analyze + Judge', type: 'object',
      children: [
        { key: 'winner', label: 'Winner', type: 'badge' },
        { key: 'reasoning', label: 'Reasoning', type: 'text' },
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
        { key: 'reasoningEffortResolved', label: 'Reasoning Effort', type: 'badge' },
        { key: 'reasoningTokens', label: 'Reasoning Tokens', type: 'number' },
        { key: 'reasoningTraceFormat', label: 'Trace Format', type: 'badge' },
      ],
    },
    {
      key: 'debate.combined.prosA', label: 'Pros — Variant A', type: 'list',
    },
    {
      key: 'debate.combined.consA', label: 'Cons — Variant A', type: 'list',
    },
    {
      key: 'debate.combined.prosB', label: 'Pros — Variant B', type: 'list',
    },
    {
      key: 'debate.combined.consB', label: 'Cons — Variant B', type: 'list',
    },
    {
      key: 'debate.combined.strengthsFromA', label: 'Strengths Preserved from A', type: 'list',
    },
    {
      key: 'debate.combined.strengthsFromB', label: 'Strengths Preserved from B', type: 'list',
    },
    {
      key: 'debate.combined.improvements', label: 'Improvements for Synthesis', type: 'list',
    },
    {
      key: 'debate.combined.reasoningTrace', label: 'Reasoning Trace', type: 'text',
    },
    {
      key: 'debate.failurePoint', label: 'Failure Point', type: 'badge',
    },
    {
      key: 'generation', label: 'Synthesis Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking', label: 'Synthesis Ranking', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
    { key: 'discardReason', label: 'Discard Reason', type: 'object',
      children: [
        { key: 'localElo', label: 'Local Elo', type: 'number' },
        { key: 'localTop15Cutoff', label: 'Top-15 Cutoff', type: 'number' },
      ],
    },
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
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — sibling
  // agent's detailViewConfig is empty (Phase 6 deferred bespoke detail view); the
  // entry exists here only to satisfy the DETAIL_VIEW_CONFIGS-vs-agent parity check
  // in entities.test.ts. Generic fallback renderer is fine as a stopgap.
  paragraph_recombine_with_coherence_pass: [],
  paragraph_recombine: [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    { key: 'parentVariantId', label: 'Parent Variant', type: 'text' },
    { key: 'paragraphCount', label: 'Paragraph Count', type: 'number' },
    { key: 'rewritesPerParagraph', label: 'Rewrites Per Slot (configured)', type: 'number' },
    { key: 'discardReason', label: 'Discard Reason', type: 'badge' },
    {
      key: 'slots', label: 'Paragraph Slots', type: 'table',
      cellClassName: 'py-1.5 px-2 text-[var(--text-primary)] max-w-md break-words whitespace-pre-wrap align-top',
      columns: [
        { key: 'paragraphIndex', label: 'Slot' },
        { key: 'label', label: 'Label' },
        { key: 'originalTextPreview', label: 'Original (preview)' },
        { key: 'winnerSource', label: 'Winner Source' },
        { key: 'winnerLabel', label: 'Winner' },
        { key: 'winnerElo', label: 'Winner Elo' },
        { key: 'winnerUncertainty', label: 'Uncertainty' },
        { key: 'matchCount', label: 'Matches' },
        { key: 'rewritesGenerated', label: 'Rewrites' },
        { key: 'rewritesDropped', label: 'Dropped' },
        { key: 'failurePoint', label: 'Failure' },
      ],
    },
    {
      key: 'recombined', label: 'Recombined Output', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'slotsReplaced', label: 'Slots Replaced', type: 'number' },
        { key: 'slotsKeptOriginal', label: 'Slots Kept Original', type: 'number' },
      ],
    },
    { key: 'recombined.formatIssues', label: 'Format Issues', type: 'list' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ],
};
