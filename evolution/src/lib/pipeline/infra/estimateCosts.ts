// Empirical cost estimation functions for evolution pipeline budget-aware dispatch.
// Uses actual output length data per tactic + model pricing to estimate per-agent costs.
//
// Calibration: when COST_CALIBRATION_ENABLED='true', the costCalibrationLoader's
// per-(tactic × generation_model) sample replaces EMPIRICAL_OUTPUT_CHARS below.
// Default (env unset): hardcoded EMPIRICAL_OUTPUT_CHARS values drive estimates —
// same behavior as before this file adopted the loader.

import { getModelPricing } from '@/config/llmPricing';
import { calculateCost } from './createEvolutionLLMClient';
import { getCalibrationRow } from './costCalibrationLoader';

// ─── Empirical Constants ──────────────────────────────────────────

/** Average output characters per tactic, measured from staging DB (n=35 invocations).
 *  New tactics use DEFAULT_OUTPUT_CHARS until calibration data accumulates. */
const EMPIRICAL_OUTPUT_CHARS: Record<string, number> = {
  // Core (measured)
  grounding_enhance: 11799,
  structural_transform: 9956,
  lexical_simplify: 5836,
  // Extended (estimated — no production data yet)
  engagement_amplify: 9197,
  style_polish: 9197,
  argument_fortify: 9197,
  narrative_weave: 9197,
  tone_transform: 9197,
  // Depth & Knowledge (estimated)
  analogy_bridge: 11000,        // adds analogies — likely verbose like grounding_enhance
  expert_deepdive: 12000,       // adds depth — likely longest output
  historical_context: 11000,    // adds historical narrative — verbose
  counterpoint_integrate: 10500, // adds counterpoints — moderate expansion
  // Audience-Shift (estimated)
  pedagogy_scaffold: 10000,     // restructures — similar to structural_transform
  curiosity_hook: 9500,         // reframes — moderate length
  practitioner_orient: 10000,   // adds how-to context — moderate expansion
  // Structural Innovation (estimated)
  zoom_lens: 10000,             // restructures — similar to structural_transform
  progressive_disclosure: 10500, // layers content — moderate expansion
  contrast_frame: 9500,         // comparison framing — moderate length
  // Quality & Precision (estimated)
  precision_tighten: 8000,      // removes hedging — likely shorter output
  coherence_thread: 9500,       // similar length — improves flow
  sensory_concretize: 9200,     // word-level replacement — similar length
  // Meta/Experimental (estimated)
  compression_distill: 5500,    // explicitly shorter output (60-70%)
  expansion_elaborate: 13000,   // triples one section — longest output
  first_principles: 11000,     // rebuilds from basics — verbose
};
const DEFAULT_OUTPUT_CHARS = 9197; // Weighted average across tactics

/** Fixed character overhead in comparison prompts (evaluation criteria + instructions). */
const COMPARISON_PROMPT_OVERHEAD = 698;

/** Expected comparison output length in characters ("A"/"B"/"TIE"). */
const COMPARISON_OUTPUT_CHARS = 20;

/** Approximate overhead added by tactic prompt template wrapping the seed article. */
const GENERATION_PROMPT_OVERHEAD = 500;

/** Approximate overhead added by the reflection prompt scaffolding (preamble + ask + 24-tactic
 *  list with summaries + ELO boost column). Matches buildReflectionPrompt's static parts.
 *  Phase 3 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430. */
const REFLECTION_PROMPT_OVERHEAD = 4500;

/** Per-rank output overhead: "N. Tactic: <name>\n   Reasoning: <text>" averages ~200 chars
 *  (~50 tokens) per ranked tactic. Multiplied by topN at the call site. */
const REFLECTION_OUTPUT_CHARS_PER_RANK = 200;

// ─── Estimation Functions ─────────────────────────────────────────

/**
 * Estimate the cost of the generation phase (one LLM call producing a variant).
 * Uses empirical output character counts per tactic for accurate estimation.
 */
export function estimateGenerationCost(
  seedArticleChars: number,
  tactic: string,
  generationModel: string,
  judgeModel?: string,
): number {
  const pricing = getModelPricing(generationModel);
  const inputChars = seedArticleChars + GENERATION_PROMPT_OVERHEAD;
  const calibrated = getCalibrationRow(tactic, generationModel, judgeModel ?? '__unspecified__', 'generation');
  const outputChars = calibrated?.avgOutputChars
    ?? EMPIRICAL_OUTPUT_CHARS[tactic]
    ?? DEFAULT_OUTPUT_CHARS;
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate the cost of ranking one variant via binary search.
 * Each comparison = 2 LLM calls (forward + reverse for bias mitigation).
 * Number of comparisons = min(poolSize - 1, maxComparisonsPerVariant).
 */
export function estimateRankingCost(
  articleChars: number,
  judgeModel: string,
  poolSize: number,
  maxComparisonsPerVariant: number,
): number {
  const pricing = getModelPricing(judgeModel);
  const numComparisons = Math.min(Math.max(poolSize - 1, 0), maxComparisonsPerVariant);
  // Each comparison prompt contains both texts + overhead
  const comparisonInputChars = COMPARISON_PROMPT_OVERHEAD + articleChars * 2;
  const costPerCall = calculateCost(comparisonInputChars, COMPARISON_OUTPUT_CHARS, pricing);
  // 2 calls per comparison (bias mitigation reversal)
  return numComparisons * 2 * costPerCall;
}

/**
 * Resolve the expected variant char count for a tactic via the same fallback chain
 * estimateAgentCost uses internally (calibration → EMPIRICAL_OUTPUT_CHARS → DEFAULT).
 * Exposed for projectDispatchPlan to price ranking comparisons accurately per tactic.
 */
export function getVariantChars(
  tactic: string,
  generationModel: string,
  judgeModel: string,
): number {
  const calibrated = getCalibrationRow(tactic, generationModel, judgeModel, 'generation');
  return calibrated?.avgOutputChars
    ?? EMPIRICAL_OUTPUT_CHARS[tactic]
    ?? DEFAULT_OUTPUT_CHARS;
}

/**
 * Estimate the cost of the reflection LLM call: input = parent text + REFLECTION_PROMPT_OVERHEAD;
 * output = topN × REFLECTION_OUTPUT_CHARS_PER_RANK. Calibration-aware via the loader's
 * 'reflection' phase entry (falls back to the hardcoded constants when COST_CALIBRATION_ENABLED
 * is unset or no row exists).
 *
 * Phase 3 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
 */
export function estimateReflectionCost(
  seedArticleChars: number,
  generationModel: string,
  judgeModel: string,
  topN: number,
): number {
  const pricing = getModelPricing(generationModel);
  const inputChars = seedArticleChars + REFLECTION_PROMPT_OVERHEAD;
  const calibrated = getCalibrationRow('__unspecified__', generationModel, judgeModel ?? '__unspecified__', 'reflection');
  const outputChars = calibrated?.avgOutputChars ?? topN * REFLECTION_OUTPUT_CHARS_PER_RANK;
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate total cost of one generateFromPreviousArticle agent (generation + ranking).
 * When `useReflection: true`, also adds the reflection LLM call cost. This is the primary
 * function used by budget-aware dispatch — accurate sizing for `parallelDispatchCount`
 * depends on the reflection contribution being included for reflection iterations.
 */
export function estimateAgentCost(
  seedArticleChars: number,
  tactic: string,
  generationModel: string,
  judgeModel: string,
  poolSize: number,
  maxComparisonsPerVariant: number,
  /** Phase 3: when true, includes reflection cost. Defaults false (vanilla GFPA). */
  useReflection: boolean = false,
  /** Phase 3: top-N tactics the reflection ranks. Default 3 matches IterationConfig default. */
  reflectionTopN: number = 3,
): number {
  const reflectionCost = useReflection
    ? estimateReflectionCost(seedArticleChars, generationModel, judgeModel, reflectionTopN)
    : 0;
  const genCost = estimateGenerationCost(seedArticleChars, tactic, generationModel, judgeModel);
  const variantChars = getVariantChars(tactic, generationModel, judgeModel);
  const rankCost = estimateRankingCost(variantChars, judgeModel, poolSize, maxComparisonsPerVariant);
  return reflectionCost + genCost + rankCost;
}

/**
 * Estimate cost of one Swiss ranking pair (2 LLM calls for bias mitigation).
 */
export function estimateSwissPairCost(
  avgVariantChars: number,
  judgeModel: string,
): number {
  const pricing = getModelPricing(judgeModel);
  const inputChars = COMPARISON_PROMPT_OVERHEAD + avgVariantChars * 2;
  return 2 * calculateCost(inputChars, COMPARISON_OUTPUT_CHARS, pricing);
}

// ─── Iterative Editing Cost Estimation ────────────────────────────

/** Approximate overhead added by the proposer prompt scaffolding (soft-rules system
 *  prompt + CriticMarkup syntax docs). Matches buildProposerPrompt's static parts. */
const EDITING_PROPOSE_PROMPT_OVERHEAD = 2000;

/** Approximate overhead added by the approver prompt scaffolding (system prompt +
 *  edit summary table header). Per-edit row added at call time. */
const EDITING_REVIEW_PROMPT_OVERHEAD = 1500;

/** Approximate output per Approver decision line (one JSON line per group). */
const EDITING_REVIEW_OUTPUT_CHARS_PER_LINE = 80;

/** Average groups per cycle when sizing the Approver call output. Conservative
 *  upper-end of expected group count (the per-cycle hard cap is 30 atomic edits;
 *  groups average ~3 atomic edits each → ~10 groups). */
const EDITING_AVG_GROUPS_PER_CYCLE = 10;

/** Worst-case drift recovery output (one JSON line per drift region, max 3 regions
 *  per Decisions §17 minor-drift threshold). */
const EDITING_DRIFT_RECOVERY_OUTPUT_CHARS = 200;

/** Article-size growth factor per editing cycle, per Decisions §17 (1.5× hard cap). */
const EDITING_SIZE_GROWTH_PER_CYCLE = 1.5;

/** Markup overhead — Proposer's output is the article body verbatim PLUS inline
 *  CriticMarkup. ~15% overhead is typical for moderate edit density. */
const EDITING_MARKUP_OVERHEAD_FACTOR = 1.15;

/** Multiplier for the worst-case drift recovery: ~1.4× of the markup overhead
 *  factor. Used when sizing the upper bound. */
const EDITING_UPPER_BOUND_MARKUP_FACTOR = 1.4;

/** Safety margin applied to the upper bound to absorb model-pricing variance. */
const EDITING_UPPER_BOUND_SAFETY_MARGIN = 1.3;

/**
 * Estimate Proposer LLM call cost. Output is article-size-dependent (proposer
 * emits the full article verbatim plus inline markup).
 */
function estimateEditingProposeCost(
  articleChars: number,
  editingModel: string,
  judgeModel: string,
  /** When true, sizes the output for upper-bound (1.5× growth × markup factor). */
  upperBound: boolean,
): number {
  const pricing = getModelPricing(editingModel);
  const inputChars = articleChars + EDITING_PROPOSE_PROMPT_OVERHEAD;
  const calibrated = getCalibrationRow(
    '__unspecified__',
    editingModel,
    judgeModel ?? '__unspecified__',
    'iterative_edit_propose',
  );
  const outputCharsBase = articleChars * EDITING_MARKUP_OVERHEAD_FACTOR;
  const outputChars = calibrated?.avgOutputChars
    ?? (upperBound ? outputCharsBase * EDITING_UPPER_BOUND_MARKUP_FACTOR : outputCharsBase);
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate Approver LLM call cost. Input is the proposer's marked-up article;
 * output is bounded by group count, not article size.
 */
function estimateEditingReviewCost(
  articleCharsWithMarkup: number,
  approverModel: string,
  judgeModel: string,
): number {
  const pricing = getModelPricing(approverModel);
  const inputChars = articleCharsWithMarkup + EDITING_REVIEW_PROMPT_OVERHEAD;
  const calibrated = getCalibrationRow(
    '__unspecified__',
    approverModel,
    judgeModel ?? '__unspecified__',
    'iterative_edit_review',
  );
  const outputChars = calibrated?.avgOutputChars
    ?? EDITING_AVG_GROUPS_PER_CYCLE * EDITING_REVIEW_OUTPUT_CHARS_PER_LINE;
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate the worst-case drift-recovery LLM call cost. Used in upper-bound
 * sizing only — drift recovery fires zero or one time across all cycles.
 */
function estimateEditingDriftRecoveryCost(
  driftRecoveryModel: string,
  judgeModel: string,
): number {
  const pricing = getModelPricing(driftRecoveryModel);
  // 30-char context window × 2 sides × max 3 regions + small prompt overhead.
  const inputChars = 30 * 2 * 3 + 500;
  const calibrated = getCalibrationRow(
    '__unspecified__',
    driftRecoveryModel,
    judgeModel ?? '__unspecified__',
    'iterative_edit_drift_recovery',
  );
  const outputChars = calibrated?.avgOutputChars ?? EDITING_DRIFT_RECOVERY_OUTPUT_CHARS;
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate total cost of one IterativeEditingAgent invocation (one parent,
 * `maxCycles` cycles, each cycle = 2 LLM calls + maybe drift recovery).
 *
 * Returns `{ expected, upperBound }`:
 * - `expected`: maxCycles × (propose + review). Drift recovery NOT included
 *   (it's an exception path; including it inflates the typical-case forecast).
 * - `upperBound`: cycle-by-cycle accumulation with article growing by up to
 *   1.5× per cycle (Decisions §17 hard cap), proposer markup factor 1.4×,
 *   plus one drift recovery, plus 30% safety margin. Used by V2CostTracker
 *   for reservation so iterations abort cleanly via BudgetExceededError BEFORE
 *   any dispatch (no partial-cycle artifacts).
 *
 * @param seedChars Initial article size in characters.
 * @param editingModel Model used for the Proposer call. Falls back to generationModel at call site.
 * @param approverModel Model used for the Approver call. Falls back to editingModel at call site.
 * @param driftRecoveryModel Model used for drift recovery. Defaults to gpt-4.1-nano per Decisions §11.
 * @param judgeModel Required for the calibration-row lookup as a discriminator (calibration is
 *   keyed by both generation+judge model).
 * @param maxCycles Per-iteration override or strategy default (1-5, default 3).
 */
export function estimateIterativeEditingCost(
  seedChars: number,
  editingModel: string,
  approverModel: string,
  driftRecoveryModel: string,
  judgeModel: string,
  maxCycles: number,
): { expected: number; upperBound: number } {
  let expected = 0;
  let upperBound = 0;
  let articleChars = seedChars;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    expected += estimateEditingProposeCost(articleChars, editingModel, judgeModel, false);
    // Approver input is proposer's marked-up article.
    const articleWithMarkup = articleChars * EDITING_MARKUP_OVERHEAD_FACTOR;
    expected += estimateEditingReviewCost(articleWithMarkup, approverModel, judgeModel);

    upperBound += estimateEditingProposeCost(articleChars, editingModel, judgeModel, true);
    upperBound += estimateEditingReviewCost(
      articleChars * EDITING_UPPER_BOUND_MARKUP_FACTOR,
      approverModel,
      judgeModel,
    );

    // Worst-case article growth per Decisions §17: 1.5× per cycle.
    articleChars *= EDITING_SIZE_GROWTH_PER_CYCLE;
  }

  // Drift recovery: one worst-case fire across all cycles in upper-bound only.
  upperBound += estimateEditingDriftRecoveryCost(driftRecoveryModel, judgeModel);
  upperBound *= EDITING_UPPER_BOUND_SAFETY_MARGIN;

  return { expected, upperBound };
}
