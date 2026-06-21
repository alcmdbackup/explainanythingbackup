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
  // Per-LLM-call labels for paragraph_recombine agent (rank_individual_paragraphs_
  // evolution_20260525). Two labels, both mapping to paragraph_recombine_cost:
  //   - 'paragraph_rewrite': per-slot rewrite generation calls.
  //   - 'paragraph_rank': per-slot pairwise ranking calls. A dedicated label (NOT
  //     the shared 'ranking' label) so per-slot ranking spend lands in
  //     paragraph_recombine_cost instead of polluting the article-level ranking_cost.
  //     The agent relabels rankNewVariant's 'ranking' calls → 'paragraph_rank' via a
  //     thin LLM-client proxy (Phase 9 cost-attribution fix). v2MockLlm.ts routes
  //     both labels through its pairwise-verdict path.
  'paragraph_rewrite',
  'paragraph_rank',
  // Sequential context-aware generation (debug_performance_paragraph_recombine_20260612):
  // ONE coordinator LLM call per invocation that returns the per-paragraph plan
  // (role + M variation directives + temperatures + skip flags). Cost lands in the
  // umbrella paragraph_recombine_cost alongside paragraph_rewrite + paragraph_rank.
  'paragraph_recombine_coordinator',
  // investigate_sequential_paragraph_recombine_performance_20260615 Phase 2 (Fix 2):
  // Mid-sequence coordinator replan call. Separate label from the initial coordinator
  // so cost-error tracking can attribute replan cost distinctly (env-gated by
  // EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED, default false).
  'paragraph_recombine_coordinator_replan',
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — coherence-pass
  // proposer + approver labels. The new agent's per-slot pipeline REUSES existing
  // 'paragraph_rewrite' + 'paragraph_rank' labels (which route to paragraph_recombine_cost);
  // ONLY these two new labels route to the new paragraph_recombine_coherence_cost umbrella.
  // Rationale: AgentName→cost-metric mapping is global 1:1; routing the same label to two
  // metrics is not architecturally possible. Strategy-level A/B vs the existing
  // paragraph_recombine agent relies on the marker tactic, not cost-bucket separation.
  'coherence_pass_propose',
  'coherence_pass_review',
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
  // Both paragraph_recombine per-LLM-call labels collapse into the
  // paragraph_recombine_cost umbrella. The agent writes the run-level metric as the
  // SUM of these two phase-cost accumulators once per invocation (Phase 9 fix) —
  // a single sum-write is MAX-safe because both accumulators are run-cumulative
  // (monotonic). Per-slot/per-rewrite split lives in execution_detail.slots[*].
  // Phase 12 (analyze_effectiveness_paragraph_recombine_20260530): the run-cumulative
  // invariant was previously FALSE because createIterationBudgetTracker.getPhaseCosts()
  // returned per-iter, not run-cumulative — silently shadowed smaller per-iter
  // contributions under writeMetricMax(GREATEST). Phase 12 fixed this by delegating
  // getPhaseCosts to runTracker. The invariant above is now TRUE post-fix.
  paragraph_rewrite: 'paragraph_recombine_cost',
  paragraph_rank: 'paragraph_recombine_cost',
  // Sequential coordinator (debug_performance_paragraph_recombine_20260612).
  paragraph_recombine_coordinator: 'paragraph_recombine_cost',
  // Phase 2 (Fix 2): mid-sequence coordinator replan rolls up into the same
  // paragraph_recombine_cost umbrella — both initial and replan are coordinator
  // overhead from the same agent's perspective.
  paragraph_recombine_coordinator_replan: 'paragraph_recombine_cost',
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — the two new
  // labels collapse into the new paragraph_recombine_coherence_cost umbrella. Per-purpose
  // split (proposer vs approver cost) lives in execution_detail.coherencePass.cycles[0].
  coherence_pass_propose: 'paragraph_recombine_coherence_cost',
  coherence_pass_review: 'paragraph_recombine_coherence_cost',
};
