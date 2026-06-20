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
import { buildCoordinatorReplanPrompt } from './buildCoordinatorReplanPrompt';

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
  /** investigate_sequential_paragraph_recombine_performance_20260615 Phase 2 (Fix 2):
   *  REPLAN path. When BOTH `priorPicks` and `firstSlot` are provided AND `firstSlot > 0`,
   *  the coordinator builds the replan prompt (buildCoordinatorReplanPrompt) instead of
   *  the initial prompt, asking for a PARTIAL plan covering paragraphIndex in
   *  [firstSlot, paragraphCount). Validation expects exactly `paragraphCount - firstSlot`
   *  entries with each paragraphIndex in [firstSlot, paragraphCount). */
  priorPicks?: readonly string[];
  firstSlot?: number;
};

export type RunCoordinatorResult = {
  plan: CoordinatorPlan;
  retried: boolean;
  rawResponse: string;
  /** Phase 2 (Fix 2): discriminator for the agent to persist alongside the plan
   *  for forensics. 'initial' = up-front plan; 'replan' = mid-sequence re-plan. */
  kind: 'initial' | 'replan';
};

export async function runCoordinator(opts: RunCoordinatorOptions): Promise<RunCoordinatorResult> {
  // Phase 2: select prompt + label + validation shape based on whether this is the
  // initial plan or a mid-sequence replan.
  const isReplan = opts.priorPicks !== undefined && opts.firstSlot !== undefined && opts.firstSlot > 0;
  const kind: 'initial' | 'replan' = isReplan ? 'replan' : 'initial';
  const firstSlot = isReplan ? opts.firstSlot! : 0;
  const expectedSlotCount = opts.paragraphCount - firstSlot;
  const prompt = isReplan
    ? buildCoordinatorReplanPrompt({
        parentText: opts.parentText,
        paragraphCount: opts.paragraphCount,
        priorPicks: opts.priorPicks!,
        firstSlot,
      })
    : buildCoordinatorPrompt({
        parentText: opts.parentText,
        paragraphCount: opts.paragraphCount,
      });

  // Phase 2: split the LLM call label so cost-error tracking does not conflate
  // the initial-plan call with the replan call.
  const callLabel = isReplan
    ? 'paragraph_recombine_coordinator_replan'
    : 'paragraph_recombine_coordinator';

  const callOptions: LLMCompletionOptions = {
    model: opts.generationModel as LLMCompletionOptions['model'],
    invocationId: opts.invocationId,
  };

  let response: string;
  try {
    response = await opts.llm.complete(prompt, callLabel, callOptions);
  } catch (err) {
    throw new CoordinatorLLMError(
      `Coordinator LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const firstAttempt = parseAndValidate(response, opts.paragraphCount, firstSlot);
  if (firstAttempt.ok) {
    return { plan: firstAttempt.plan, retried: false, rawResponse: response, kind };
  }

  let retryResponse: string;
  try {
    retryResponse = await opts.llm.complete(prompt, callLabel, callOptions);
  } catch (err) {
    throw new CoordinatorLLMError(
      `Coordinator retry LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      response,
    );
  }

  const retryAttempt = parseAndValidate(retryResponse, opts.paragraphCount, firstSlot);
  if (retryAttempt.ok) {
    return { plan: retryAttempt.plan, retried: true, rawResponse: retryResponse, kind };
  }

  throw new CoordinatorParseError(
    `Coordinator output failed Zod validation on both attempts. ` +
      `First error: ${firstAttempt.error}. Retry error: ${retryAttempt.error}.`,
    retryResponse,
    retryAttempt.error,
  );

  // Reference expectedSlotCount so the parameter is consumed (unused-var lint).
  void expectedSlotCount;
}

type ParseResult =
  | { ok: true; plan: CoordinatorPlan }
  | { ok: false; error: string };

/** Parse + validate a coordinator plan response. Accepts both the initial-plan shape
 *  (paragraphIndex range [0, paragraphCount), exactly paragraphCount entries) and the
 *  replan shape (paragraphIndex range [firstSlot, paragraphCount), exactly
 *  paragraphCount - firstSlot entries). Each entry's paragraphIndex must lie in the
 *  expected range AND the entire range must be covered exactly once (no duplicates,
 *  no gaps). Phase 2 — replan path validation. */
function parseAndValidate(
  rawResponse: string,
  paragraphCount: number,
  firstSlot: number,
): ParseResult {
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

  const expectedSlotCount = paragraphCount - firstSlot;
  if (result.data.paragraphPlans.length !== expectedSlotCount) {
    return {
      ok: false,
      error: `Plan has ${result.data.paragraphPlans.length} entries; expected ${expectedSlotCount} (firstSlot=${firstSlot}, paragraphCount=${paragraphCount})`,
    };
  }

  // Verify paragraphIndex range + uniqueness for the expected [firstSlot, paragraphCount) interval.
  const seenIndices = new Set<number>();
  for (const plan of result.data.paragraphPlans) {
    if (plan.paragraphIndex < firstSlot || plan.paragraphIndex >= paragraphCount) {
      return {
        ok: false,
        error: `Paragraph index ${plan.paragraphIndex} out of expected range [${firstSlot}, ${paragraphCount})`,
      };
    }
    if (seenIndices.has(plan.paragraphIndex)) {
      return {
        ok: false,
        error: `Duplicate paragraphIndex ${plan.paragraphIndex} in plan`,
      };
    }
    seenIndices.add(plan.paragraphIndex);
    if (plan.candidates.length !== plan.M) {
      return {
        ok: false,
        error: `Paragraph ${plan.paragraphIndex}: M=${plan.M} but candidates.length=${plan.candidates.length}`,
      };
    }
  }

  return { ok: true, plan: result.data };
}
