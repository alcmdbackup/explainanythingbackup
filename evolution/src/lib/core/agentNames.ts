// Typed agent name union and per-purpose cost-metric lookup for the evolution pipeline.
// Tightens the second arg of llm.complete() so typos can't silently route cost to a phantom bucket.

import type { MetricName } from '../metrics/types';

// AgentName labels used as the second arg to llm.complete(). The typed union prevents
// typos from silently routing cost to a phantom bucket. Only generation/ranking/reflection
// get dedicated per-purpose cost metrics; seed-phase costs roll up into seed_cost; all
// iterative-editing labels collapse into iterative_edit_cost.
//
// B019-S3: removed 'evolution' — never passed as a complete() label and had no entry
// in COST_METRIC_BY_AGENT. Stale leftover from V1.
export const AGENT_NAMES = [
  'generation',
  'ranking',
  'reflection',
  'seed_title',
  'seed_article',
  'evaluate_and_suggest',
  // Per-LLM-call labels for iterative_editing agent (consolidated under one
  // iterative_edit_cost metric — per-purpose split is in execution_detail).
  'iterative_edit_propose',
  'iterative_edit_review',
  'iterative_edit_drift_recovery',
  // Per-LLM-call labels for proposer_approver_criteria_generate agent (consolidated
  // under one proposer_approver_criteria_cost metric — per-purpose split is in
  // execution_detail.cycles[0].{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}).
  // Mirror approver short-circuits for forward-rejected groups, so its actual call
  // count may be lower than worst-case projection.
  'criteria_proposer',
  'criteria_forward_approver',
  'criteria_mirror_approver',
  // Per-LLM-call labels for debate_and_generate agent (Option C — 2 calls).
  // Both collapse into one debate_cost metric (per bring_back_debate_agent_20260506
  // Decision §6 + Phase 1.4); per-purpose split lives in execution_detail.debate
  // and execution_detail.generation. The synthesis call uses an LLM-client proxy
  // that rewrites 'generation' → 'debate_synthesis' so cost flows to debate_cost
  // instead of generation_cost (load-bearing invariant I4).
  'debate_judge',
  'debate_synthesis',
] as const;
export type AgentName = typeof AGENT_NAMES[number];

/**
 * Maps each agent label to its run-level per-purpose cost metric.
 *
 * B027: `seed_title` and `seed_article` both map to `seed_cost` by design — the run-level
 * metric reports total seed cost as a single number. The calibration-table layer
 * (`evolution/scripts/refreshCostCalibration.ts` and `costCalibrationLoader.ts`) DOES
 * keep phase distinction — the calibration key includes the phase name so `seed_title`
 * and `seed_article` have separate calibration rows. No conflation at the estimation layer.
 */
export const COST_METRIC_BY_AGENT: Partial<Record<AgentName, MetricName>> = {
  generation: 'generation_cost',
  ranking: 'ranking_cost',
  reflection: 'reflection_cost',
  seed_title: 'seed_cost',
  seed_article: 'seed_cost',
  evaluate_and_suggest: 'evaluation_cost',
  // All three editing per-LLM-call labels collapse into one cost metric.
  // Per-purpose split is tracked in execution_detail.cycles[i].{proposeCostUsd,
  // approveCostUsd, driftRecoveryCostUsd} per Decisions §13 invariant I2.
  iterative_edit_propose: 'iterative_edit_cost',
  iterative_edit_review: 'iterative_edit_cost',
  iterative_edit_drift_recovery: 'iterative_edit_cost',
  // All three propose/approve criteria per-LLM-call labels collapse into one cost metric.
  // Per-purpose split is tracked in execution_detail.cycles[0] for forensics.
  criteria_proposer: 'proposer_approver_criteria_cost',
  criteria_forward_approver: 'proposer_approver_criteria_cost',
  criteria_mirror_approver: 'proposer_approver_criteria_cost',
  // Both debate per-LLM-call labels collapse into one cost metric. Per-purpose
  // split lives in execution_detail.debate.combined.cost (judge call) and
  // execution_detail.generation.cost (synthesis call). The synthesis call's
  // AgentName is 'debate_synthesis' (NOT 'generation') only because of the
  // I4 LLM-client proxy in DebateAgent — keeps cost out of generation_cost.
  debate_judge: 'debate_cost',
  debate_synthesis: 'debate_cost',
};
