// Abstract base class for all evolution pipeline agents.
// Defines the execution interface, result types, and shared helpers for agent implementations.

import type { AgentResult, ExecutionContext, PipelineState, AgentPayload } from '../types';

export abstract class AgentBase {
  abstract readonly name: string;

  /** Execute the agent's primary function. */
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;

  /** Estimate cost in USD for executing with the given payload. */
  abstract estimateCost(payload: AgentPayload): number;

  /** Check if the agent can execute given current state. */
  abstract canExecute(state: PipelineState): boolean;

  /** Build a skip result (precondition not met, not an error). */
  protected skipResult(reason: string, ctx: ExecutionContext): AgentResult {
    return {
      agentType: this.name,
      success: true,
      skipped: true,
      reason,
      costUsd: ctx.costTracker.getAgentCost(this.name),
    };
  }

  /** Build a failure result (agent ran but could not produce output). */
  protected failResult(error: string, ctx: ExecutionContext, opts?: { executionDetail?: unknown }): AgentResult {
    return {
      agentType: this.name,
      success: false,
      error,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      ...(opts?.executionDetail ? { executionDetail: opts.executionDetail as AgentResult['executionDetail'] } : {}),
    };
  }

  /** Build a success result with optional metrics. */
  protected successResult(ctx: ExecutionContext, opts?: { variantsAdded?: number; matchesPlayed?: number; convergence?: number; executionDetail?: unknown }): AgentResult {
    return {
      agentType: this.name,
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      ...(opts?.variantsAdded !== undefined ? { variantsAdded: opts.variantsAdded } : {}),
      ...(opts?.matchesPlayed !== undefined ? { matchesPlayed: opts.matchesPlayed } : {}),
      ...(opts?.convergence !== undefined ? { convergence: opts.convergence } : {}),
      ...(opts?.executionDetail ? { executionDetail: opts.executionDetail as AgentResult['executionDetail'] } : {}),
    };
  }
}
