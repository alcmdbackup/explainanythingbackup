// Abstract Agent base class: template method pattern for pipeline agent execution.
// Handles invocation creation, cost tracking, budget error handling, duration timing, and logging.

import type { ZodSchema } from 'zod';
import type { AgentContext, AgentResult, AgentOutput, DetailFieldDef, FinalizationMetricDef } from './types';
import type { ExecutionDetailBase } from '../types';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../types';
import { createInvocation, updateInvocation } from '../pipeline/infra/trackInvocations';
import { createAgentCostScope } from '../pipeline/infra/trackBudget';
import { createEvolutionLLMClient } from '../pipeline/infra/createEvolutionLLMClient';

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

  /**
   * Return the attribution dimension value for an invocation, or null when this agent
   * doesn't participate in ELO-delta attribution (e.g. swiss/merge agents).
   *
   * CURRENT STATUS: the Phase 5 aggregator in `experimentMetrics.computeEloAttributionMetrics`
   * reads `execution_detail.strategy` directly (ad-hoc pattern — option (b) in the plan).
   * This method exists as a typed contract for future agents — wire it into the aggregator
   * when adding a second attribution dimension (e.g., `temperatureBucket`), at which point
   * the aggregator should call this method instead of hardcoding the field path.
   *
   * Default: null. Override in variant-producing agents.
   * Example: `return detail.strategy ?? null;`
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getAttributionDimension(_detail: TDetail): string | null {
    return null;
  }

  abstract execute(input: TInput, ctx: AgentContext): Promise<AgentOutput<TOutput, TDetail>>;

  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    // Extract tactic from input if present (GenerateFromSeedArticleAgent, future agents with tactics).
    const tactic = (input as Record<string, unknown>)?.tactic as string | undefined;
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
      undefined, tactic,
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

      // Per-invocation cost from the scope's own intercept (authoritative). Falls back to
      // detail.totalCost only when the scope saw zero spend (e.g. MergeRatingsAgent which
      // doesn't issue LLM calls and therefore never triggers recordSpend through the scope).
      const ownSpent = costScope.getOwnSpent();
      const cost = ownSpent > 0 ? ownSpent : (detail?.totalCost ?? 0);

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
