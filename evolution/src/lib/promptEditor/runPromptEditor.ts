// PromptEditor dispatcher: pre-flight per-run cost cap, then runs every config in parallel via
// Promise.allSettled (one config's failure never blocks siblings) and aggregates total cost.

import { calculateLLMCost } from '@/config/llmPricing';
import { buildPromptEditorPrompt } from './buildPromptEditorPrompt';
import { runPromptEditorConfig } from './runPromptEditorConfig';
import type { PromptEditorRunInput, PromptEditorRunResult, PromptEditorConfig, RewriteUnit } from './types';

/** Hard per-run pre-flight ceiling (USD). The global LLMSpendingGate is the runtime backstop,
 *  but it under-reserves long prompts, so this estimate is the primary guard. Hardcoded for v1. */
export const PROMPT_EDITOR_PER_RUN_CAP_USD = 0.5;

/** Max configs per run (also enforced by the route's Zod schema). */
export const PROMPT_EDITOR_MAX_CONFIGS = 10;

/** Thrown when the pre-flight estimate exceeds the per-run cap. The route maps this to HTTP 402. */
export class PromptEditorCostCapError extends Error {
  constructor(public readonly estimatedUsd: number, public readonly capUsd: number) {
    super(`Estimated run cost $${estimatedUsd.toFixed(4)} exceeds the $${capUsd.toFixed(2)} per-run cap`);
    this.name = 'PromptEditorCostCapError';
  }
}

/** Char-based upper-ish cost estimate for one config: ~chars/4 input tokens; a rewrite's output
 *  is roughly the input length, capped. Uses the same pricing helper callLLM bills against. */
export function estimatePromptEditorConfigCost(
  unit: RewriteUnit,
  sourceText: string,
  config: PromptEditorConfig,
  title = '',
): number {
  const prompt = buildPromptEditorPrompt(unit, sourceText, config.prompt, title);
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.min(inputTokens, 8192);
  try {
    return calculateLLMCost(config.model, inputTokens, outputTokens);
  } catch {
    // Unknown model / bad tokens — treat as zero here; the route's Zod allowlist + callLLM
    // validation reject unsupported models before they ever reach the LLM.
    return 0;
  }
}

export function estimatePromptEditorRunCost(input: PromptEditorRunInput): number {
  return input.configs.reduce(
    (sum, c) => sum + estimatePromptEditorConfigCost(input.unit, input.sourceText, c, input.title ?? ''),
    0,
  );
}

/**
 * Run all configs. Throws PromptEditorCostCapError if the pre-flight estimate exceeds the cap;
 * otherwise never rejects — per-config failures are captured as typed statuses.
 */
export async function runPromptEditor(input: PromptEditorRunInput): Promise<PromptEditorRunResult> {
  const estimate = estimatePromptEditorRunCost(input);
  if (estimate > PROMPT_EDITOR_PER_RUN_CAP_USD) {
    throw new PromptEditorCostCapError(estimate, PROMPT_EDITOR_PER_RUN_CAP_USD);
  }

  const settled = await Promise.allSettled(
    input.configs.map((c) => runPromptEditorConfig(input.unit, input.sourceText, c, input.title ?? '')),
  );

  const configs = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          label: input.configs[i]!.label,
          output: null,
          costUsd: 0,
          model: input.configs[i]!.model,
          temperatureUsed: null,
          durationMs: 0,
          status: 'error' as const,
          formatValid: false,
          errorMsg: s.reason instanceof Error ? s.reason.message : String(s.reason),
        },
  );

  const totalCostUsd = configs.reduce((sum, c) => sum + c.costUsd, 0);
  return { configs, totalCostUsd };
}
