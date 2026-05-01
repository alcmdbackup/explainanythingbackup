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
