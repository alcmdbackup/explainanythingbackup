// Abstract Agent base class: template method pattern for pipeline agent execution.
// Handles invocation creation, cost tracking, budget error handling, duration timing, and logging.

import type { ZodSchema } from 'zod';
import type { AgentContext, AgentResult, AgentOutput, DetailFieldDef, FinalizationMetricDef } from './types';
import type { ExecutionDetailBase } from '../types';
import { BudgetExceededError } from '../types';
import { BudgetExceededWithPartialResults } from '../pipeline/infra/errors';
import { createInvocation, updateInvocation } from '../pipeline/infra/trackInvocations';

export abstract class Agent<TInput, TOutput, TDetail extends ExecutionDetailBase = ExecutionDetailBase> {
  abstract readonly name: string;
  abstract readonly executionDetailSchema: ZodSchema;

  /** Metric definitions contributed by this agent for finalization-phase computation. */
  readonly invocationMetrics: FinalizationMetricDef[] = [];

  /** Config-driven field definitions for rendering execution detail in the UI. */
  abstract readonly detailViewConfig: DetailFieldDef[];

  /** Subclass implements the actual work. Returns structured AgentOutput. */
  abstract execute(input: TInput, ctx: AgentContext): Promise<AgentOutput<TOutput, TDetail>>;

  /** Template method: wraps execute() with invocation tracking, cost, timing, and error handling. */
  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
    );

    const costBefore = ctx.costTracker.getTotalSpent();
    const startMs = Date.now();

    ctx.logger.info(`Agent ${this.name} starting`, {
      phaseName: this.name,
      iteration: ctx.iteration,
    });

    try {
      const output = await this.execute(input, ctx);
      const cost = ctx.costTracker.getTotalSpent() - costBefore;
      const durationMs = Date.now() - startMs;

      // Patch totalCost on the detail if not already set
      const detail = output.detail;
      if (detail && detail.totalCost === 0) {
        detail.totalCost = cost;
      }

      // Validate execution detail against schema (skip on error paths)
      const parseResult = this.executionDetailSchema.safeParse(detail);
      if (!parseResult.success) {
        ctx.logger.warn(`Agent ${this.name} execution detail validation failed`, {
          phaseName: this.name,
          errors: parseResult.error.issues.slice(0, 3).map(i => i.message),
        });
      }

      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost,
        success: true,
        execution_detail: detail as unknown as Record<string, unknown>,
        duration_ms: durationMs,
      });

      ctx.logger.info(`Agent ${this.name} completed`, {
        phaseName: this.name,
        iteration: ctx.iteration,
        cost,
        durationMs,
      });

      return { success: true, result: output.result, cost, durationMs, invocationId };

    } catch (error) {
      const cost = ctx.costTracker.getTotalSpent() - costBefore;
      const durationMs = Date.now() - startMs;

      // Check BudgetExceededWithPartialResults BEFORE BudgetExceededError (inheritance order)
      if (error instanceof BudgetExceededWithPartialResults) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message, duration_ms: durationMs,
        });
        return {
          success: false, result: null, cost, durationMs, invocationId,
          budgetExceeded: true,
          partialResult: (error as BudgetExceededWithPartialResults).partialVariants,
        };
      }

      if (error instanceof BudgetExceededError) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message, duration_ms: durationMs,
        });
        return { success: false, result: null, cost, durationMs, invocationId, budgetExceeded: true };
      }

      // All other errors: update invocation and re-throw
      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost, success: false, error_message: String(error), duration_ms: durationMs,
      });
      throw error;
    }
  }
}
