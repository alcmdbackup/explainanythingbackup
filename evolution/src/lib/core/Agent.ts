// Abstract Agent base class: template method pattern for pipeline agent execution.
// Handles invocation creation, cost tracking, budget error handling, duration timing, and logging.

import type { ZodSchema } from 'zod';
import type { AgentContext, AgentResult, AgentOutput, DetailFieldDef, FinalizationMetricDef } from './types';
import type { ExecutionDetailBase } from '../types';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../types';
import { createInvocation, updateInvocation } from '../pipeline/infra/trackInvocations';
import { createAgentCostScope } from '../pipeline/infra/trackBudget';
import { createEvolutionLLMClient } from '../pipeline/infra/createEvolutionLLMClient';

/** Env flag controlling cost attribution source.
 *  - 'true' (default): prefer costScope.getOwnSpent() — the scope-routed per-invocation total.
 *  - 'false': fall back to legacy `detail.totalCost || getOwnSpent()` behavior for rollback.
 *  Flip via Vercel env without redeploying if the new path regresses in prod.
 */
function useScopeOwnSpent(): boolean {
  return (process.env.EVOLUTION_USE_SCOPE_OWNSPENT ?? 'true') !== 'false';
}

export abstract class Agent<TInput, TOutput, TDetail extends ExecutionDetailBase = ExecutionDetailBase> {
  abstract readonly name: string;
  abstract readonly executionDetailSchema: ZodSchema;
  readonly invocationMetrics: FinalizationMetricDef[] = [];
  abstract readonly detailViewConfig: DetailFieldDef[];

  /** Whether this agent issues LLM calls. When true and ctx.rawProvider is set,
   *  Agent.run() builds a per-invocation EvolutionLLMClient bound to the scope and
   *  injects it as `input.llm`. Override to `false` in agents that don't use LLMs
   *  (e.g. MergeRatingsAgent). */
  readonly usesLLM: boolean = true;

  abstract execute(input: TInput, ctx: AgentContext): Promise<AgentOutput<TOutput, TDetail>>;

  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
    );

    // Per-invocation cost scope: delegates budget gating to shared tracker while
    // tracking this agent's own spend independently (fixes Bug B: parallel delta bug).
    // invocationId empty string sentinel: agents still function but lose the FK on llmCallTracking rows.
    const costScope = createAgentCostScope(ctx.costTracker);
    const extendedCtx: AgentContext = { ...ctx, invocationId: invocationId ?? '', costTracker: costScope };

    // Bug B fix: build a scoped EvolutionLLMClient bound to costScope.recordSpend so per-invocation
    // cost attribution is accurate under parallel dispatch. Inject as input.llm when the agent uses
    // LLMs (caller is responsible for Input types that include an `llm` field).
    // When ctx.rawProvider is absent (tests that pass a pre-built input.llm), skip — tests still work.
    let effectiveInput: TInput = input;
    if (this.usesLLM && ctx.rawProvider && ctx.defaultModel) {
      const scopedLlm = createEvolutionLLMClient(
        ctx.rawProvider,
        costScope,
        ctx.defaultModel,
        ctx.logger,
        ctx.db,
        ctx.runId,
        ctx.generationTemperature,
      );
      effectiveInput = { ...(input as unknown as Record<string, unknown>), llm: scopedLlm } as unknown as TInput;
    }

    const startMs = Date.now();

    ctx.logger.info(`Agent ${this.name} starting`, { phaseName: this.name, iteration: ctx.iteration });

    try {
      const output = await this.execute(effectiveInput, extendedCtx);
      const durationMs = Date.now() - startMs;
      const { detail } = output;

      // Phase 2.5: prefer scope.getOwnSpent() — the authoritative per-invocation total from
      // recordSpend intercepts. Falls back to detail.totalCost only when the scope saw nothing
      // (happens when the agent used a pre-baked LLM client that bypassed the scope intercept,
      // which shouldn't happen after Phase 2.5 but is retained for safety).
      // Gated via EVOLUTION_USE_SCOPE_OWNSPENT so we can flip back in Vercel without redeploying.
      const ownSpent = costScope.getOwnSpent();
      const cost = useScopeOwnSpent()
        ? (ownSpent > 0 ? ownSpent : (detail?.totalCost ?? 0))
        : ((detail?.totalCost ?? 0) > 0 ? detail!.totalCost : ownSpent);

      const parseResult = this.executionDetailSchema.safeParse(detail);
      if (!parseResult.success) {
        ctx.logger.warn(`Agent ${this.name} execution detail validation failed — writing null detail to DB`, {
          phaseName: this.name,
          errors: parseResult.error.issues.slice(0, 3).map(i => i.message),
        });
      }

      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost,
        success: true,
        execution_detail: parseResult.success ? (detail as unknown as Record<string, unknown>) : undefined,
        duration_ms: durationMs,
      });

      ctx.logger.info(`Agent ${this.name} completed`, { phaseName: this.name, iteration: ctx.iteration, cost, durationMs });

      return { success: true, result: output.result, cost, durationMs, invocationId };

    } catch (error) {
      const cost = costScope.getOwnSpent();
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateInvocation(ctx.db, invocationId, { cost_usd: cost, success: false, error_message: errorMessage, duration_ms: durationMs });

      // BudgetExceededWithPartialResults extends BudgetExceededError — check subclass first
      if (error instanceof BudgetExceededWithPartialResults) {
        return { success: false, result: null, cost, durationMs, invocationId, budgetExceeded: true, partialResult: error.partialData };
      }
      if (error instanceof BudgetExceededError) {
        return { success: false, result: null, cost, durationMs, invocationId, budgetExceeded: true };
      }

      throw error;
    }
  }
}
