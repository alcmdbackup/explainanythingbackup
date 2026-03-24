// Compute functions for metrics written during pipeline execution (cost tracking).

import type { ExecutionContext } from '../types';

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getAllAgentCosts()[ctx.phaseName] ?? 0;
}
