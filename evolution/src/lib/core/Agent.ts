// Abstract Agent base class: template method pattern for pipeline agent execution.
// Handles invocation creation, cost tracking, budget error handling, and logging.

import type { ZodSchema } from 'zod';
import type { AgentContext, AgentResult } from './types';
import type { Variant } from '../types';
import { BudgetExceededError } from '../types';
import { BudgetExceededWithPartialResults } from '../pipeline/infra/errors';
import { createInvocation, updateInvocation } from '../pipeline/infra/trackInvocations';

export abstract class Agent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly executionDetailSchema: ZodSchema;

  /** Subclass implements the actual work. */
  abstract execute(input: TInput, ctx: AgentContext): Promise<TOutput>;

  /** Template method: wraps execute() with invocation tracking, cost, and error handling. */
  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
    );

    const costBefore = ctx.costTracker.getTotalSpent();

    ctx.logger.info(`Agent ${this.name} starting`, {
      phaseName: this.name,
      iteration: ctx.iteration,
    });

    try {
      const result = await this.execute(input, ctx);
      const cost = ctx.costTracker.getTotalSpent() - costBefore;

      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost,
        success: true,
      });

      ctx.logger.info(`Agent ${this.name} completed`, {
        phaseName: this.name,
        iteration: ctx.iteration,
        cost,
      });

      return { success: true, result, cost, invocationId };

    } catch (error) {
      const cost = ctx.costTracker.getTotalSpent() - costBefore;

      // Check BudgetExceededWithPartialResults BEFORE BudgetExceededError (inheritance order)
      if (error instanceof BudgetExceededWithPartialResults) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message,
        });
        return {
          success: false, result: null, cost, invocationId,
          budgetExceeded: true,
          partialResult: (error as BudgetExceededWithPartialResults).partialVariants,
        };
      }

      if (error instanceof BudgetExceededError) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message,
        });
        return { success: false, result: null, cost, invocationId, budgetExceeded: true };
      }

      // All other errors: update invocation and re-throw
      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost, success: false, error_message: String(error),
      });
      throw error;
    }
  }
}
