// Auto-mode cost controls: pre-flight hard cap mirroring judgeEval/settings.ts. Enforced
// BEFORE any LLM call. The global evolution daily cap + kill switch are the hard backstop.

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
