// Abstract Agent base class: template method pattern for pipeline agent execution.
// Handles invocation creation, cost tracking, budget error handling, duration timing, and logging.

import type { ZodSchema } from 'zod';
import type { AgentContext, AgentResult, AgentOutput, DetailFieldDef, FinalizationMetricDef } from './types';
import type { ExecutionDetailBase } from '../types';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../types';
import { createInvocation, updateInvocation } from '../pipeline/infra/trackInvocations';
import { createAgentCostScope } from '../pipeline/infra/trackBudget';

export abstract class Agent<TInput, TOutput, TDetail extends ExecutionDetailBase = ExecutionDetailBase> {
  abstract readonly name: string;
  abstract readonly executionDetailSchema: ZodSchema;
  readonly invocationMetrics: FinalizationMetricDef[] = [];
  abstract readonly detailViewConfig: DetailFieldDef[];

  abstract execute(input: TInput, ctx: AgentContext): Promise<AgentOutput<TOutput, TDetail>>;

  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
    );

    // Per-invocation cost scope: delegates budget gating to shared tracker while
    // tracking this agent's own spend independently (fixes parallel delta bug).
    // invocationId empty string sentinel: agents still function but lose the FK on llmCallTracking rows.
    const costScope = createAgentCostScope(ctx.costTracker);
    const extendedCtx: AgentContext = { ...ctx, invocationId: invocationId ?? '', costTracker: costScope };

    const startMs = Date.now();

    ctx.logger.info(`Agent ${this.name} starting`, { phaseName: this.name, iteration: ctx.iteration });

    try {
      const output = await this.execute(input, extendedCtx);
      const cost = costScope.getOwnSpent();
      const durationMs = Date.now() - startMs;

      const { detail } = output;
      if (detail?.totalCost === 0) detail.totalCost = cost;

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

      // Subclass check must come before superclass check
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
