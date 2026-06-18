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

/** Per-criterion description overhead in the evaluation prompt: name + range +
 *  description ≈ 200 chars before the optional rubric block. */
const CRITERIA_DESC_CHARS_PER_ITEM = 200;
/** Average rubric block size per criterion: ~4 anchors × ~100 chars + headers ≈ 500.
 *  Used as the wizard-time default when fetching actual rubric sizes is impractical. */
const EVALUATION_RUBRIC_CHARS_PER_CRITERION = 500;
/** Static prompt overhead (preamble + structured ask) for evaluate_and_suggest. */
const EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD = 1200;
/** Per-suggestion-block output overhead: "### Suggestion N\nCriterion:\nExample:\nIssue:\nFix:"
 *  averages ~800 chars per block. Multiplied by weakestK at the call site. */
const SUGGESTION_BLOCK_OUTPUT_CHARS = 800;
/** Per-criterion score-line output overhead: "<name>: <score>" ≈ 30 chars. */
const SCORE_LINE_OUTPUT_CHARS = 150;

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
 * Estimate the cost of the single combined evaluate + suggest LLM call used by
 * EvaluateCriteriaThenGenerateFromPreviousArticleAgent.
 *
 * Input chars = parent + EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD +
 *               criteriaCount × (CRITERIA_DESC_CHARS_PER_ITEM + avgRubricChars)
 * Output chars = criteriaCount × SCORE_LINE_OUTPUT_CHARS +
 *                weakestK × SUGGESTION_BLOCK_OUTPUT_CHARS
 *
 * Wizard-time `avgRubricChars` is the EVALUATION_RUBRIC_CHARS_PER_CRITERION constant
 * (no DB fetch). Runtime cost-tracker reservation can pass actual avg from the fetched
 * criteria rows for accurate per-call reservation.
 */
export function estimateEvaluateAndSuggestCost(
  seedArticleChars: number,
  generationModel: string,
  judgeModel: string,
  criteriaCount: number,
  weakestK: number,
  avgRubricChars: number = EVALUATION_RUBRIC_CHARS_PER_CRITERION,
): number {
  const pricing = getModelPricing(generationModel);
  const inputChars = seedArticleChars + EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD
    + criteriaCount * (CRITERIA_DESC_CHARS_PER_ITEM + avgRubricChars);
  const calibrated = getCalibrationRow('__unspecified__', generationModel, judgeModel ?? '__unspecified__', 'evaluate_and_suggest');
  const outputChars = calibrated?.avgOutputChars
    ?? (criteriaCount * SCORE_LINE_OUTPUT_CHARS + weakestK * SUGGESTION_BLOCK_OUTPUT_CHARS);
  return calculateCost(inputChars, outputChars, pricing);
}

/**
 * Estimate total cost of one generateFromPreviousArticle agent (generation + ranking).
 * When `useReflection: true`, also adds the reflection LLM call cost. When
 * `useCriteria: true`, adds the combined evaluate-and-suggest LLM call cost. Vanilla
 * GFPA uses neither.
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
  /** Criteria-driven generation: when true, includes evaluate+suggest cost. */
  useCriteria: boolean = false,
  /** Number of criteria evaluated (drives input + output size of the combined call). */
  criteriaCount: number = 0,
  /** weakestK: how many suggestion blocks the LLM produces. */
  weakestK: number = 1,
): number {
  const reflectionCost = useReflection
    ? estimateReflectionCost(seedArticleChars, generationModel, judgeModel, reflectionTopN)
    : 0;
  const evaluationCost = useCriteria
    ? estimateEvaluateAndSuggestCost(seedArticleChars, generationModel, judgeModel, criteriaCount, weakestK)
    : 0;
  const genCost = estimateGenerationCost(seedArticleChars, tactic, generationModel, judgeModel);
  const variantChars = getVariantChars(tactic, generationModel, judgeModel);
  const rankCost = estimateRankingCost(variantChars, judgeModel, poolSize, maxComparisonsPerVariant);
  return reflectionCost + evaluationCost + genCost + rankCost;
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
 * @param poolSize Pool size at the iteration's start. Determines ranking comparison count.
 *   Pass 0 to disable ranking entirely (matches editingRankEnabled=false).
 * @param maxComparisonsPerVariant Cap on binary-search ranking depth.
 */
export function estimateIterativeEditingCost(
  seedChars: number,
  editingModel: string,
  approverModel: string,
  driftRecoveryModel: string,
  judgeModel: string,
  maxCycles: number,
  poolSize: number = 0,
  maxComparisonsPerVariant: number = 0,
  /** Retained for backwards-compat with persisted call sites; both modes now
   *  produce identical cost shapes since drift recovery is deterministic. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mode: 'markup' | 'rewrite' = 'markup',
): { expected: number; upperBound: number; expectedRanking: number; upperBoundRanking: number } {
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

  // Drift recovery is now deterministic snap-to-source (0 LLM cost) for both
  // modes; the legacy gpt-4.1-nano upper-bound term was removed when the LLM
  // recovery call went away. driftRecoveryModel + mode params are retained so
  // strategy configs persisted before the cleanup still type-check on read.
  upperBound *= EDITING_UPPER_BOUND_SAFETY_MARGIN;

  // Phase 3.1 — Post-cycle ranking cost (D3 surfaces this as `editingRank` peer
  // field on EstPerAgentValue). The final variant's article size for ranking is
  // estimated as the post-last-cycle articleChars (after worst-case growth).
  // When poolSize=0 (ranking disabled), the cost is 0.
  const expectedRanking = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(seedChars, judgeModel, poolSize, maxComparisonsPerVariant)
    : 0;
  const upperBoundRanking = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(articleChars, judgeModel, poolSize, maxComparisonsPerVariant)
        * EDITING_UPPER_BOUND_SAFETY_MARGIN
    : 0;

  return { expected, upperBound, expectedRanking, upperBoundRanking };
}

/**
 * Estimate total cost of one ProposerApproverCriteriaGenerateAgent invocation. Single-cycle:
 * one combined eval+suggest call, then one proposer call, one forward approver call,
 * optionally one mirror approver call (when includesMirrorApprover), then ranking.
 *
 * NOTE: this is a worst-case projection — runtime mirror short-circuit (skip for forward-rejected
 * groups) makes actual mirror cost a function of forward rejection rate, producing consistent
 * positive cost-estimation error. DO NOT predict forward rejection rate at projection time.
 *
 * @param seedArticleChars Initial article size.
 * @param editingModel Proposer model. Falls back to generationModel.
 * @param approverModel Approver model (used for both forward and mirror).
 * @param judgeModel Judge model for ranking calls.
 * @param criteriaCount Total criteria evaluated.
 * @param weakestK Number of weakest criteria addressed by suggestions.
 * @param avgRubricChars Average rubric size per criterion (calibration-aware).
 * @param includesMirrorApprover Whether to include the mirror approver pass (default true).
 * @param poolSize Pool size at iteration start. 0 disables ranking.
 * @param maxComparisonsPerVariant Cap on binary-search ranking depth.
 */
export function estimateProposerApproverCriteriaCost(
  seedArticleChars: number,
  editingModel: string,
  approverModel: string,
  judgeModel: string,
  criteriaCount: number,
  weakestK: number,
  avgRubricChars: number = EVALUATION_RUBRIC_CHARS_PER_CRITERION,
  includesMirrorApprover: boolean = true,
  poolSize: number = 0,
  maxComparisonsPerVariant: number = 0,
): { expected: number; upperBound: number; expectedRanking: number; upperBoundRanking: number } {
  // 1. Combined eval+suggest call (reuse the existing estimator with the editingModel as gen model).
  const evalCost = estimateEvaluateAndSuggestCost(
    seedArticleChars,
    editingModel,
    judgeModel,
    criteriaCount,
    weakestK,
    avgRubricChars,
  );

  // 2. Proposer call — full article + markup.
  const proposeExpected = estimateEditingProposeCost(seedArticleChars, editingModel, judgeModel, false);
  const proposeUpper = estimateEditingProposeCost(seedArticleChars, editingModel, judgeModel, true);

  // 3. Forward approver call — input is marked-up article.
  const articleWithMarkup = seedArticleChars * EDITING_MARKUP_OVERHEAD_FACTOR;
  const approveForwardExpected = estimateEditingReviewCost(articleWithMarkup, approverModel, judgeModel);
  const approveForwardUpper = estimateEditingReviewCost(
    seedArticleChars * EDITING_UPPER_BOUND_MARKUP_FACTOR,
    approverModel,
    judgeModel,
  );

  // 4. Mirror approver call (optional).
  const approveMirrorExpected = includesMirrorApprover ? approveForwardExpected : 0;
  const approveMirrorUpper = includesMirrorApprover ? approveForwardUpper : 0;

  const expected = evalCost + proposeExpected + approveForwardExpected + approveMirrorExpected;
  const upperBound = (evalCost + proposeUpper + approveForwardUpper + approveMirrorUpper) * EDITING_UPPER_BOUND_SAFETY_MARGIN;

  // 5. Post-cycle ranking (single variant, single cycle — no growth between cycles).
  const expectedRanking = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(seedArticleChars, judgeModel, poolSize, maxComparisonsPerVariant)
    : 0;
  const upperBoundRanking = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(seedArticleChars, judgeModel, poolSize, maxComparisonsPerVariant) * EDITING_UPPER_BOUND_SAFETY_MARGIN
    : 0;

  return { expected, upperBound, expectedRanking, upperBoundRanking };
}

// ─── Debate cost estimation ──────────────────────────────────────────
//
// bring_back_debate_agent_20260506 Phase 1.9 — estimate cost of one
// DebateThenGenerateFromPreviousArticleAgent invocation (Option C: 2 LLM calls).
//
// Per-invocation cost = combined-judge call + synthesis-via-GFPA call.
// Synthesis cost flows to the `debate` peer field on EstPerAgentValue per
// Phase 1.10 — but the estimator returns it as the `expectedSynthesis` /
// `upperBoundSynthesis` fields so callers can split presentation if desired.

/** Static prompt overhead for the combined analyze+judge call: preamble + 9-field
 *  structured ask + critique-context block placeholders. Empirical estimate. */
const DEBATE_JUDGE_PROMPT_OVERHEAD = 2000;
/** Output: 9 structured fields × ~80-100 chars each + reasoning paragraph ≈ 3000 chars typical. */
const DEBATE_JUDGE_OUTPUT_CHARS = 3000;
/** Upper-bound output: capped at 6000 chars (~1500 tokens) for budget reservation. */
const DEBATE_JUDGE_UPPER_BOUND_OUTPUT_CHARS = 6000;
/** Synthesis input ≈ both parent texts + verdict-derived customPrompt overhead. */
const DEBATE_SYNTHESIS_PROMPT_OVERHEAD = 2500;

/**
 * Estimate cost of one debate_and_generate invocation.
 * @param parentACharsApprox ≈ winner.text length (used for both judge call input
 *   and synthesis call input — synthesis revises winner using loser's strengths).
 * @param parentBCharsApprox ≈ loser.text length (judge call input only).
 * @param judgeModel Strategy's judgeModel — used for the combined analyze+judge call.
 * @param generationModel Strategy's generationModel — used for the synthesis call
 *   delegated to inner GFPA.
 * @param poolSize Pool size at iteration start (drives ranking comparisons inside synthesis).
 * @param maxComparisonsPerVariant Cap on binary-search ranking depth.
 * @returns expected/upperBound for the full invocation, plus separated synthesis
 *   sub-costs so EstPerAgentValue.debate can be projected from `expected` (whole
 *   invocation lands in `debate` peer field per Phase 1.10).
 */
export function estimateDebateCost(
  parentACharsApprox: number,
  parentBCharsApprox: number,
  judgeModel: string,
  generationModel: string,
  poolSize: number,
  maxComparisonsPerVariant: number,
): { expected: number; upperBound: number; expectedSynthesis: number; upperBoundSynthesis: number } {
  // Combined judge call: input = both parents + critique-context + structured ask;
  // output = 9-field JSON. Calibration-aware via getCalibrationRow.
  const judgePricing = getModelPricing(judgeModel);
  const judgeInputChars = parentACharsApprox + parentBCharsApprox + DEBATE_JUDGE_PROMPT_OVERHEAD;
  const calibratedJudge = getCalibrationRow('__unspecified__', generationModel, judgeModel ?? '__unspecified__', 'debate_judge');
  const judgeOutputChars = calibratedJudge?.avgOutputChars ?? DEBATE_JUDGE_OUTPUT_CHARS;
  const judgeUpperOutputChars = calibratedJudge?.avgOutputChars
    ? calibratedJudge.avgOutputChars * 1.5  // 50% headroom over calibrated mean
    : DEBATE_JUDGE_UPPER_BOUND_OUTPUT_CHARS;
  const expectedJudge = calculateCost(judgeInputChars, judgeOutputChars, judgePricing);
  const upperBoundJudge = calculateCost(judgeInputChars, judgeUpperOutputChars, judgePricing);

  // Synthesis call: input ≈ winner.text + customPrompt overhead; output = full variant.
  // Treat as a vanilla generation call against generationModel + ranking against judgeModel.
  const synthesisGenChars = parentACharsApprox + DEBATE_SYNTHESIS_PROMPT_OVERHEAD;
  const calibratedSynth = getCalibrationRow('__unspecified__', generationModel, judgeModel ?? '__unspecified__', 'debate_synthesis');
  const synthOutputChars = calibratedSynth?.avgOutputChars ?? DEFAULT_OUTPUT_CHARS;
  const synthUpperOutputChars = calibratedSynth?.avgOutputChars
    ? calibratedSynth.avgOutputChars * 1.5
    : DEFAULT_OUTPUT_CHARS * 1.5;
  const synthGenPricing = getModelPricing(generationModel);
  const expectedSynthGen = calculateCost(synthesisGenChars, synthOutputChars, synthGenPricing);
  const upperBoundSynthGen = calculateCost(synthesisGenChars, synthUpperOutputChars, synthGenPricing);

  // Synthesis ranking: post-generation Swiss-style binary-search ranking.
  const synthRankCost = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(synthOutputChars, judgeModel, poolSize, maxComparisonsPerVariant)
    : 0;
  const upperSynthRankCost = poolSize > 0 && maxComparisonsPerVariant > 0
    ? estimateRankingCost(synthUpperOutputChars, judgeModel, poolSize, maxComparisonsPerVariant)
    : 0;

  const expectedSynthesis = expectedSynthGen + synthRankCost;
  const upperBoundSynthesis = upperBoundSynthGen + upperSynthRankCost;

  return {
    expected: expectedJudge + expectedSynthesis,
    upperBound: upperBoundJudge + upperBoundSynthesis,
    expectedSynthesis,
    upperBoundSynthesis,
  };
}

// ─── Paragraph Recombine ──────────────────────────────────────────

/**
 * Per-paragraph prompt overhead for paragraph_recombine rewrite calls.
 * Covers: 3-guardrail prompt + CONTEXT header (article title + slot index) +
 * ORIGINAL/REWRITTEN markers. Modest overhead vs article-level prompts.
 */
const PARAGRAPH_REWRITE_PROMPT_OVERHEAD = 800;

/**
 * Typical paragraph output size — paragraph-level rewrite output is much smaller
 * than article-level generation (DEFAULT_OUTPUT_CHARS = 9197). A typical 8K-char
 * article has ~12 paragraphs ≈ ~660 chars/paragraph. The ±20% length cap (D7/D12)
 * means rewrites stay close to original size; 1000 chars covers a typical rewrite
 * with margin.
 */
const PARAGRAPH_REWRITE_OUTPUT_CHARS = 1000;

/**
 * Estimate the cost of a paragraph_recombine invocation per Phase 3 of
 * rank_individual_paragraphs_evolution_20260525. Covers:
 *
 *   N paragraphs × M rewrites × per-rewrite cost
 * + N slots × per-slot pairwise ranking cost (M+1 candidates per slot,
 *   ~M comparisons each at binary-search bound)
 *
 * Per-slot ranking reuses estimateRankingCost (existing helper) since per-slot
 * judge calls use the existing 'ranking' AgentName label.
 *
 * Output: {expected, upperBound} — expected is the math-direct sum; upperBound
 * applies a 1.3× safety margin (matches the 30% margin used in other estimators).
 *
 * @param parentArticleChars Approx character length of the parent article.
 * @param paragraphCount Number of paragraph slots to decompose into (= N).
 * @param rewritesPerParagraph M rewrites per slot.
 * @param maxComparisonsPerParagraph Cap on per-slot ranking depth.
 * @param rewriteModel LLM model for per-paragraph rewrite calls (falls back to generation model).
 * @param judgeModel LLM model for per-slot ranking judge calls.
 */
/** Coordinator prompt overhead (rough): ~1.5K chars for the structured instructions +
 *  per-paragraph guidance examples. The parent article is the dominant input. */
const COORDINATOR_PROMPT_OVERHEAD = 1500;
/** Per-paragraph output chars in the coordinator's JSON plan. Roughly 350 chars per
 *  paragraph (directive + temperature + rationale + role + M + index + nesting). */
const COORDINATOR_OUTPUT_CHARS_PER_PARAGRAPH = 350;
/** Phase 4d / replan-aware coordinator projection: today's projector models 1
 *  coordinator call (initial). Production fires up to 2 (initial + Phase 2 replan).
 *  With flash-lite at $0.0006/call the gap is invisible; with Sonnet at $0.021/call
 *  the gap is $0.021 the wizard hides — visible understatement on premium tier.
 *  COORDINATOR_REPLAN_RATE_DEFAULT picks an observed fire-rate so total coordinator
 *  cost ≈ (1 + replanRate) × singleCallCost. 0.65 derived from staging observation
 *  of post-PR-#1221 runs; revisit when calibration accumulates. */
const COORDINATOR_REPLAN_RATE_DEFAULT = 0.65;

export function estimateParagraphRecombineCost(
  parentArticleChars: number,
  paragraphCount: number,
  rewritesPerParagraph: number,
  maxComparisonsPerParagraph: number,
  rewriteModel: string,
  judgeModel: string,
  /** Sequential Context-Aware Generation (debug_performance_paragraph_recombine_20260612):
   *  when `sequentialEnabled: true`, the projector adds a `coordinatorCost` phase + models
   *  triangular prior-picks growth on rewrite + rank phases. When omitted or false, the
   *  projection collapses to the legacy parallel 2-phase shape (coordinatorCost === 0).
   *  Pass an EXPLICIT param (not env.read) so wizard projection mirrors runtime even when
   *  the projector is invoked client-side. Callers resolve env at their boundary.
   *
   *  Phase 4d adds `coordinatorModel`: when set, the coordinator-phase calibration row
   *  AND pricing both use this model instead of `rewriteModel`. Falls back to rewriteModel
   *  when omitted — byte-identical pre-Phase-4d projection. */
  opts?: { sequentialEnabled?: boolean; coordinatorModel?: string },
): {
  expected: number;
  upperBound: number;
  perPhase: {
    paragraphRewriteCost: number;
    paragraphRankCost: number;
    coordinatorCost: number;
  };
} {
  if (paragraphCount <= 0 || rewritesPerParagraph <= 0) {
    return { expected: 0, upperBound: 0, perPhase: { paragraphRewriteCost: 0, paragraphRankCost: 0, coordinatorCost: 0 } };
  }

  const sequentialEnabled = opts?.sequentialEnabled === true;

  // Per-paragraph rewrite cost (base).
  const rewritePricing = getModelPricing(rewriteModel);
  const avgParagraphChars = Math.max(parentArticleChars / paragraphCount, 100);
  const rewriteInputChars = avgParagraphChars + PARAGRAPH_REWRITE_PROMPT_OVERHEAD;
  const calibratedRewrite = getCalibrationRow('__unspecified__', rewriteModel, judgeModel, 'paragraph_rewrite');
  const rewriteOutputChars = calibratedRewrite?.avgOutputChars ?? PARAGRAPH_REWRITE_OUTPUT_CHARS;
  const costPerRewrite = calculateCost(rewriteInputChars, rewriteOutputChars, rewritePricing);

  let totalRewriteCost: number;
  let totalRankCost: number;

  if (sequentialEnabled) {
    // Sequential path: round i's M rewrite calls each see i × avgParagraphChars of PRIOR
    // CONTEXT. Triangular sum across N rounds: Σ_{i=0..N-1} M × (rewriteInput + i × ppc).
    // Same triangular pattern for rank (judge sees PRIOR CONTEXT under sequential).
    const N = paragraphCount;
    const M = rewritesPerParagraph;
    const ppc = avgParagraphChars;
    // Cost is roughly proportional to input chars; we re-derive per-round cost analytically
    // by scaling costPerRewrite by (rewriteInputChars + i × ppc) / rewriteInputChars.
    // Simplified: triangularSum = sum_{i=0..N-1} (rewriteInputChars + i × ppc).
    //          = N × rewriteInputChars + ppc × (N-1)N/2.
    const baseInput = rewriteInputChars;
    const triangularInputSum = N * baseInput + (ppc * (N - 1) * N) / 2;
    const avgPerRoundInputChars = triangularInputSum / N;
    const scaledRewriteCost = costPerRewrite * (avgPerRoundInputChars / baseInput);
    totalRewriteCost = N * M * scaledRewriteCost;

    // Rank phase also triangular under sequential: each comparison's input includes the
    // priorPicks block in addition to the two paragraph candidates.
    const slotPoolSize = M + 1;
    const baseRankInput = avgParagraphChars * 2 + 800; // COMPARISON_PROMPT_OVERHEAD-ish
    const triangularRankInputSum = N * baseRankInput + (ppc * (N - 1) * N) / 2;
    const avgPerRoundRankInputChars = triangularRankInputSum / N;
    const baseRankCost = estimateRankingCost(avgParagraphChars, judgeModel, slotPoolSize, maxComparisonsPerParagraph);
    const scaledRankCost = baseRankCost * (avgPerRoundRankInputChars / baseRankInput);
    totalRankCost = N * scaledRankCost;
  } else {
    // Legacy parallel path: no PRIOR CONTEXT, no triangular growth.
    totalRewriteCost = paragraphCount * rewritesPerParagraph * costPerRewrite;
    const slotPoolSize = rewritesPerParagraph + 1;
    const perSlotRankCost = estimateRankingCost(
      avgParagraphChars,
      judgeModel,
      slotPoolSize,
      maxComparisonsPerParagraph,
    );
    totalRankCost = paragraphCount * rewritesPerParagraph * perSlotRankCost;
  }

  // Coordinator phase (sequential only). Phase 4d: when a per-strategy
  // coordinatorModel is set, BOTH the calibration-row lookup AND the pricing lookup
  // use it instead of the rewrite model — otherwise a Sonnet coordinator would be
  // costed against flash-lite pricing (~30× under-projection). Plus replan-aware
  // multiplier: the projector models one initial call + COORDINATOR_REPLAN_RATE
  // expected replan calls, since Phase 2 replan fires often enough that ignoring it
  // makes the wizard's headline cost preview under-state premium-tier spend by the
  // most visible amount.
  let coordinatorCost = 0;
  if (sequentialEnabled) {
    const coordinatorModel = opts?.coordinatorModel ?? rewriteModel;
    const coordinatorPricing = getModelPricing(coordinatorModel);
    const coordinatorInputChars = parentArticleChars + COORDINATOR_PROMPT_OVERHEAD;
    const calibratedCoordinator = getCalibrationRow('__unspecified__', coordinatorModel, judgeModel, 'paragraph_recombine_coordinator');
    const coordinatorOutputChars = calibratedCoordinator?.avgOutputChars
      ?? paragraphCount * COORDINATOR_OUTPUT_CHARS_PER_PARAGRAPH;
    const singleCallCost = calculateCost(coordinatorInputChars, coordinatorOutputChars, coordinatorPricing);
    coordinatorCost = singleCallCost * (1 + COORDINATOR_REPLAN_RATE_DEFAULT);
  }

  const expected = totalRewriteCost + totalRankCost + coordinatorCost;
  const upperBound = expected * 1.3;
  return {
    expected,
    upperBound,
    perPhase: {
      paragraphRewriteCost: totalRewriteCost,
      paragraphRankCost: totalRankCost,
      coordinatorCost,
    },
  };
}

