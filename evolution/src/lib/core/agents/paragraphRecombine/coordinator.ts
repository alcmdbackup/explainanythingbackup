// Phase A coordinator for Sequential Context-Aware Generation
// (debug_performance_paragraph_recombine_20260612).
//
// One up-front LLM call returns the per-paragraph plan that drives Phase B's
// sequential rounds. Single retry on Zod-validation failure; second failure
// throws CoordinatorParseError → agent reports success=false.
//
// LOAD-BEARING INVARIANTS:
//   - Runs on invocationScope (NOT slotScope) so its cost lands in the SHARED
//     run-cumulative phase-cost accumulator alongside paragraph_rewrite +
//     paragraph_rank. This makes the 3-term sum at the rollup site MAX-safe
//     under multi-dispatch.
//   - On any throw (LLM-error OR Zod-after-retry) the agent must persist the
//     coordinator's partial detail (cost, rawResponse, parseError) BEFORE
//     re-throwing per the I3 invariant. This module surfaces the raw response
//     + parse error via error properties so the agent can persist them.

import type { EvolutionLLMClient, LLMCompletionOptions } from '../../../types';
import {
  coordinatorPlanSchema,
  type CoordinatorPlan,
} from '../../../schemas';
import { buildCoordinatorPrompt } from './buildCoordinatorPrompt';

export class CoordinatorLLMError extends Error {
  readonly rawResponse?: string;
  constructor(message: string, rawResponse?: string) {
    super(message);
    this.name = 'CoordinatorLLMError';
    if (rawResponse !== undefined) this.rawResponse = rawResponse;
  }
}

export class CoordinatorParseError extends Error {
  readonly rawResponse: string;
  readonly parseError: string;
  constructor(message: string, rawResponse: string, parseError: string) {
    super(message);
    this.name = 'CoordinatorParseError';
    this.rawResponse = rawResponse;
    this.parseError = parseError;
  }
}

export type RunCoordinatorOptions = {
  parentText: string;
  paragraphCount: number;
  llm: EvolutionLLMClient;
  generationModel: string;
  invocationId?: string;
};

export type RunCoordinatorResult = {
  plan: CoordinatorPlan;
  retried: boolean;
  rawResponse: string;
};

export async function runCoordinator(opts: RunCoordinatorOptions): Promise<RunCoordinatorResult> {
  const prompt = buildCoordinatorPrompt({
    parentText: opts.parentText,
    paragraphCount: opts.paragraphCount,
  });

  const callOptions: LLMCompletionOptions = {
    model: opts.generationModel as LLMCompletionOptions['model'],
    invocationId: opts.invocationId,
  };

  let response: string;
  try {
    response = await opts.llm.complete(prompt, 'paragraph_recombine_coordinator', callOptions);
  } catch (err) {
    throw new CoordinatorLLMError(
      `Coordinator LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const firstAttempt = parseAndValidate(response, opts.paragraphCount);
  if (firstAttempt.ok) {
    return { plan: firstAttempt.plan, retried: false, rawResponse: response };
  }

  let retryResponse: string;
  try {
    retryResponse = await opts.llm.complete(prompt, 'paragraph_recombine_coordinator', callOptions);
  } catch (err) {
    throw new CoordinatorLLMError(
      `Coordinator retry LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      response,
    );
  }

  const retryAttempt = parseAndValidate(retryResponse, opts.paragraphCount);
  if (retryAttempt.ok) {
    return { plan: retryAttempt.plan, retried: true, rawResponse: retryResponse };
  }

  throw new CoordinatorParseError(
    `Coordinator output failed Zod validation on both attempts. ` +
      `First error: ${firstAttempt.error}. Retry error: ${retryAttempt.error}.`,
    retryResponse,
    retryAttempt.error,
  );
}

type ParseResult =
  | { ok: true; plan: CoordinatorPlan }
  | { ok: false; error: string };

function parseAndValidate(rawResponse: string, expectedSlotCount: number): ParseResult {
  // Strip common LLM wrappers: ```json ... ``` fences or "Return JSON:" preambles.
  const stripped = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = coordinatorPlanSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `Zod validation: ${result.error.message}` };
  }

  if (result.data.paragraphPlans.length !== expectedSlotCount) {
    return {
      ok: false,
      error: `Plan has ${result.data.paragraphPlans.length} entries; expected ${expectedSlotCount}`,
    };
  }

  for (const plan of result.data.paragraphPlans) {
    if (plan.candidates.length !== plan.M) {
      return {
        ok: false,
        error: `Paragraph ${plan.paragraphIndex}: M=${plan.M} but candidates.length=${plan.candidates.length}`,
      };
    }
  }

  return { ok: true, plan: result.data };
}
