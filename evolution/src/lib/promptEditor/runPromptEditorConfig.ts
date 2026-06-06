// Runs ONE prompt editor config: builds the rewrite prompt, makes a single callLLM, captures cost
// via the onUsage callback, and runs display-only format validation. No agent orchestration,
// no evolution-pipeline DB rows. callLLM still records one llmCallTracking row + consumes the
// shared 'evolution' budget (by design — desirable for cost auditing).

import { callLLM, ANONYMOUS_USER_UUID, type LLMUsageMetadata } from '@/lib/services/llms';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { getModelMaxTemperature } from '@/config/modelRegistry';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import { validateFormat } from '@evolution/lib/shared/enforceVariantFormat';
import { validateParagraphRewrite } from '@evolution/lib/shared/paragraphSlots';
import { buildPromptEditorPrompt } from './buildPromptEditorPrompt';
import type { PromptEditorConfig, PromptEditorConfigResult, RewriteUnit } from './types';

/** call_source label — the `evolution_` prefix routes spend to the shared evolution budget
 *  category and engages the LLM semaphore (see llms.ts). */
export const PROMPT_EDITOR_CALL_SOURCE = 'evolution_prompt_editor';

/** Resolve the temperature to send: omit (null) when the model reports null/undefined max
 *  temperature; otherwise clamp the requested value to the model's ceiling. */
export function resolvePromptEditorTemperature(model: string, requested?: number): number | null {
  const max = getModelMaxTemperature(model);
  if (max === null || max === undefined) return null;
  if (requested === undefined) return null;
  return Math.min(requested, max);
}

/** Cheap heuristic: does the output read like a model refusal? Display-only hint; the output is
 *  still returned with status 'success'. */
function looksLikeRefusal(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase();
  return /\b(i can('|no)?t|i'm (unable|sorry)|i am unable|as an ai|i cannot (help|assist|comply)|i won'?t)\b/.test(head);
}

function isAbortOrTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  return name === 'AbortError' || /tim\s?ed?\s?out|timeout|aborted/i.test(msg);
}

/**
 * Run a single config and return a structured result. Never throws — all errors map to a typed
 * status so a failing config does not break siblings under Promise.allSettled.
 */
export async function runPromptEditorConfig(
  unit: RewriteUnit,
  sourceText: string,
  config: PromptEditorConfig,
  title = '',
): Promise<PromptEditorConfigResult> {
  const startMs = Date.now();
  const temperatureUsed = resolvePromptEditorTemperature(config.model, config.temperature);
  const base = {
    label: config.label,
    model: config.model,
    temperatureUsed,
  };

  let model;
  try {
    model = allowedLLMModelSchema.parse(config.model);
  } catch {
    return {
      ...base, output: null, costUsd: 0, durationMs: Date.now() - startMs,
      status: 'error', formatValid: false, errorMsg: `Unsupported model: ${config.model}`,
    };
  }

  const prompt = buildPromptEditorPrompt(unit, sourceText, config.prompt, title);

  let costUsd = 0;
  try {
    const text = await callLLM(
      prompt,
      PROMPT_EDITOR_CALL_SOURCE,
      ANONYMOUS_USER_UUID,
      model,
      false,
      null,
      null,
      null,
      false,
      {
        temperature: temperatureUsed ?? undefined,
        onUsage: (u: LLMUsageMetadata) => { costUsd = u.estimatedCostUsd; },
      },
    );

    // Display-only validation — never blocks the output.
    let formatValid: boolean;
    let formatIssues: string[] | undefined;
    if (unit === 'article') {
      const r = validateFormat(text);
      formatValid = r.valid;
      formatIssues = r.issues.length > 0 ? r.issues : undefined;
    } else {
      const r = validateParagraphRewrite(text, sourceText.length);
      formatValid = r.valid;
      formatIssues = r.valid ? undefined : [r.dropReason ?? 'invalid'];
    }

    return {
      ...base,
      output: text,
      costUsd,
      durationMs: Date.now() - startMs,
      status: 'success',
      formatValid,
      formatIssues,
      looksLikeRefusal: looksLikeRefusal(text) || undefined,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    let status: PromptEditorConfigResult['status'] = 'error';
    if (err instanceof GlobalBudgetExceededError) status = 'budget';
    else if (err instanceof LLMKillSwitchError) status = 'killed';
    else if (isAbortOrTimeout(err)) status = 'timeout';
    return {
      ...base, output: null, costUsd, durationMs: Date.now() - startMs,
      status, formatValid: false, errorMsg,
    };
  }
}
