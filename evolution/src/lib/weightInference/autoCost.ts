// Auto-mode cost controls: pre-flight hard cap mirroring judgeEval/settings.ts. Enforced
// BEFORE any LLM call. The global evolution daily cap + kill switch are the hard backstop.
// Also exposes estimateAutoRunCost — a client-safe pre-run $ projection (Q2) that feeds both
// the new-session form display and the enforced cap (single source of truth).

import { getModelPricing, type ModelPricing } from '@/config/llmPricing';

const DEFAULT_MAX_CALLS = 8000;
const DEFAULT_MAX_USD = 5;
const DEFAULT_CHUNK_PAIRS = 40;
const CALLS_PER_PAIR = 4; // 2 holistic + 2 rubric (2-pass each)

export class WeightInferenceAutoDisabledError extends Error {
  constructor() {
    super('Auto mode is disabled (WEIGHT_INFERENCE_AUTO_ENABLED=false).');
    this.name = 'WeightInferenceAutoDisabledError';
  }
}
export class WeightInferenceAutoCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeightInferenceAutoCapError';
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function autoModeEnabled(): boolean {
  return process.env.WEIGHT_INFERENCE_AUTO_ENABLED !== 'false';
}

export function getAutoChunkPairs(): number {
  return Math.floor(envInt('WEIGHT_INFERENCE_AUTO_CHUNK_PAIRS', DEFAULT_CHUNK_PAIRS));
}

/** plannedCalls = remainingPairs × repeats × 4 (2 holistic + 2 rubric passes per pair). */
export function plannedCalls(remainingPairs: number, repeats: number): number {
  return Math.max(0, remainingPairs) * Math.max(1, repeats) * CALLS_PER_PAIR;
}

// ─── Pre-run cost projection (Q2) ──────────────────────────────────
// Chars-based estimate using the same `chars/4 ≈ tokens` convention as
// createEvolutionLLMClient.calculateCost / estimateCosts.ts. The tiny formula is inlined
// (rather than importing calculateCost) so this module stays free of the pipeline graph and
// remains importable from the client form. Overhead constants mirror estimateCosts.ts.

/** Fixed char overhead of the default holistic A/B comparison prompt (instructions + framing
 *  + hardcoded "clarity / structure / engagement / grammar / overall" checklist). Used as a
 *  floor when `holisticOverrideChars` is not supplied or smaller than the default. */
const HOLISTIC_PROMPT_OVERHEAD_CHARS = 700;
/** Fixed char overhead of a rubric comparison prompt (preamble + structured ask), before criteria. */
const RUBRIC_PROMPT_OVERHEAD_CHARS = 1200;
/** Per-criterion char overhead in a rubric prompt (name + range + description + rubric block). */
const RUBRIC_CHARS_PER_CRITERION = 700;
/** Holistic output is just "A"/"B"/"TIE". */
const HOLISTIC_OUTPUT_CHARS = 20;
/** Rubric output: a short verdict line per criterion + an overall. */
const RUBRIC_OUTPUT_CHARS_PER_CRITERION = 40;

export interface AutoRunCostEstimate {
  /** Projected total USD across the whole run. */
  totalUsd: number;
  /** Averaged per-call USD (= totalUsd / plannedCalls) — the scalar the cap consumes. */
  perCallUsd: number;
  /** matches × repeats × 4. */
  plannedCalls: number;
}

/** chars → USD using a model's input/output per-1M pricing (chars/4 ≈ tokens). */
function charsCost(inputChars: number, outputChars: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

/**
 * Tight pre-run cost projection for an auto run. Prices the real per-pair shape — 2 holistic
 * calls (both article bodies + small overhead) + 2 larger rubric calls (both bodies + per-criterion
 * overhead) — × repeats × matches. Returns 0 on degenerate input (empty pool / non-finite size);
 * `calculateCost`/the cap must never see NaN. `perCallUsd = totalUsd / plannedCalls` is the single
 * scalar passed to assertWithinWeightInferenceAutoCap so display and enforcement agree.
 */
export function estimateAutoRunCost(input: {
  matches: number;
  repeats: number;
  model: string;
  avgArticleChars: number;
  criteriaCount: number;
  /** evalute_implied_rubric_results_and_experimentally_validate_20260623 Phase 1: when the
   *  session carries a `holistic_prompt_override`, its character length replaces the default
   *  HOLISTIC_PROMPT_OVERHEAD_CHARS in the projection — so the operator-facing $ estimate
   *  matches the bytes that will actually be sent. Pass 0 (or omit) for the default path. */
  holisticOverrideChars?: number;
}): AutoRunCostEstimate {
  const matches = Math.max(0, Math.floor(input.matches));
  const repeats = Math.max(1, Math.floor(input.repeats));
  const calls = plannedCalls(matches, repeats);
  if (matches === 0 || !Number.isFinite(input.avgArticleChars) || input.avgArticleChars <= 0) {
    return { totalUsd: 0, perCallUsd: 0, plannedCalls: calls };
  }
  const pricing = getModelPricing(input.model);
  const K = Math.max(0, Math.floor(input.criteriaCount));
  const bothArticles = 2 * input.avgArticleChars;
  const holisticOverhead = Math.max(HOLISTIC_PROMPT_OVERHEAD_CHARS, Math.max(0, Math.floor(input.holisticOverrideChars ?? 0)));

  const holisticInput = bothArticles + holisticOverhead;
  const rubricInput = bothArticles + RUBRIC_PROMPT_OVERHEAD_CHARS + K * RUBRIC_CHARS_PER_CRITERION;
  const rubricOutput = RUBRIC_OUTPUT_CHARS_PER_CRITERION * K + HOLISTIC_OUTPUT_CHARS;

  // per pair, per repeat: 2 holistic + 2 rubric (each a 2-pass reversal = CALLS_PER_PAIR total)
  const perPairPerRepeat =
    2 * charsCost(holisticInput, HOLISTIC_OUTPUT_CHARS, pricing) +
    2 * charsCost(rubricInput, rubricOutput, pricing);

  const totalUsd = perPairPerRepeat * matches * repeats;
  return { totalUsd, perCallUsd: calls > 0 ? totalUsd / calls : 0, plannedCalls: calls };
}

/**
 * Hard pre-flight cap. Throws WeightInferenceAutoDisabledError when the kill switch is off,
 * or WeightInferenceAutoCapError when planned calls / estimated cost exceed the ceilings.
 * `estCostPerCall` is optional; when omitted only the call-count ceiling is enforced.
 */
export function assertWithinWeightInferenceAutoCap(input: {
  remainingPairs: number;
  repeats: number;
  estCostPerCall?: number;
}): void {
  if (!autoModeEnabled()) throw new WeightInferenceAutoDisabledError();
  const maxCalls = envInt('WEIGHT_INFERENCE_AUTO_MAX_CALLS', DEFAULT_MAX_CALLS);
  const maxUsd = envInt('WEIGHT_INFERENCE_AUTO_MAX_USD', DEFAULT_MAX_USD);
  const calls = plannedCalls(input.remainingPairs, input.repeats);
  if (calls > maxCalls) {
    throw new WeightInferenceAutoCapError(
      `auto run would make ${calls} LLM calls (> WEIGHT_INFERENCE_AUTO_MAX_CALLS=${maxCalls}); reduce pool/repeats or raise the cap`,
    );
  }
  if (input.estCostPerCall !== undefined) {
    const estUsd = calls * input.estCostPerCall;
    if (estUsd > maxUsd) {
      throw new WeightInferenceAutoCapError(
        `auto run estimated $${estUsd.toFixed(2)} (> WEIGHT_INFERENCE_AUTO_MAX_USD=${maxUsd})`,
      );
    }
  }
}
