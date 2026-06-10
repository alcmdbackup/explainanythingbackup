// Coarse pre-flight cost estimation for judge-eval sweeps (used by the hard cap + dry-run).
// Uses modelRegistry per-1M pricing with chars/4 token approximation. Intentionally rough —
// the authoritative cost is the per-call onUsage estimate captured during the run.

import { getModelInfo } from '@/config/modelRegistry';
import type { JudgeEvalPair } from './schemas';

const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 250; // rubric + framing per pass
const OUTPUT_TOKENS_VERDICT = 8;
const OUTPUT_TOKENS_REASONING = 350;

/** Estimated USD for one 2-pass comparison (forward + reverse) of a pair. */
export function estimateComparisonCostUsd(
  model: string,
  charsA: number,
  charsB: number,
  explainReasoning: boolean,
): number {
  const info = getModelInfo(model);
  if (!info) return 0;
  const inputTokens = (charsA + charsB) / CHARS_PER_TOKEN + PROMPT_OVERHEAD_TOKENS;
  const outputTokens = explainReasoning ? OUTPUT_TOKENS_REASONING : OUTPUT_TOKENS_VERDICT;
  const reasoningRate = info.reasoningPer1M ?? info.outputPer1M;
  const reasoningTokens = explainReasoning ? OUTPUT_TOKENS_REASONING : 0;
  const perPass =
    (inputTokens * info.inputPer1M +
      outputTokens * info.outputPer1M +
      reasoningTokens * reasoningRate) /
    1_000_000;
  return perPass * 2;
}

export interface SweepCostInput {
  models: string[];
  temperatures: number[];
  reasoningEfforts: Array<string | null>;
  promptVariants: number; // distinct prompt variants (>=1)
  pairs: JudgeEvalPair[]; // the selected (kind-filtered) test-set pairs
  repeats: number;
  explainReasoning: boolean;
}

export interface SweepCostEstimate {
  cells: number;
  comparisons: number;
  estimatedCostUsd: number;
}

/** Total estimate for a full sweep grid over the selected pairs. */
export function estimateSweepCost(input: SweepCostInput): SweepCostEstimate {
  const cells =
    input.models.length *
    Math.max(1, input.temperatures.length) *
    Math.max(1, input.reasoningEfforts.length) *
    Math.max(1, input.promptVariants);

  let perCellPairCost = 0;
  for (const p of input.pairs) {
    // Average pricing across models keeps the estimate model-agnostic per cell.
    let sum = 0;
    for (const m of input.models) {
      sum += estimateComparisonCostUsd(m, p.text_a.length, p.text_b.length, input.explainReasoning);
    }
    perCellPairCost += input.models.length > 0 ? sum / input.models.length : 0;
  }

  const cellsPerModelGrid = cells / Math.max(1, input.models.length);
  const estimatedCostUsd = perCellPairCost * input.repeats * cellsPerModelGrid * input.models.length;
  const comparisons = cells * input.pairs.length * input.repeats;
  return { cells, comparisons, estimatedCostUsd };
}
