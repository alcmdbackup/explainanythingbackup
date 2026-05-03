// Pure helpers for the Cost Estimates server actions in costEstimationActions.ts.
// Lives in a separate file because Next.js 'use server' modules can only export
// async functions, but these helpers are sync — needed both for the server
// action's internal use and for unit testing in isolation.

import type { CostInvocationRow } from './costEstimationActions';

export type InvRow = {
  id: string;
  agent_name: string | null;
  iteration: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  execution_detail: Record<string, unknown> | null;
};

/**
 * Build per-invocation rows for the Cost Estimates table.
 *
 * Fix #38 (use_playwright_find_ux_issues_bugs_20260501): the reflect_and_generate
 * wrapper writes `execution_detail.tactic` (per agents/overview.md). The legacy
 * GenerateFromPreviousArticleAgent writes `execution_detail.strategy`. We read
 * tactic first; fall back to strategy for legacy GFPA rows. Truthy-check on
 * tactic so empty-string early-failure rows fall through to the legacy field.
 */
export function buildInvocationRows(invocations: InvRow[]): CostInvocationRow[] {
  return invocations.map((inv) => {
    const d = (inv.execution_detail ?? {}) as Record<string, unknown>;
    const gen = d.generation as Record<string, unknown> | undefined;
    const rank = d.ranking as Record<string, unknown> | undefined;
    const genEst = typeof gen?.estimatedCost === 'number' ? gen.estimatedCost as number : null;
    const genAct = typeof gen?.cost === 'number' ? gen.cost as number : null;
    const rankEst = typeof rank?.estimatedCost === 'number' ? rank.estimatedCost as number : null;
    const rankAct = typeof rank?.cost === 'number' ? rank.cost as number : null;
    const errPct = typeof d.estimationErrorPct === 'number' && Number.isFinite(d.estimationErrorPct)
      ? d.estimationErrorPct as number : null;
    const tactic = (typeof d.tactic === 'string' && d.tactic ? d.tactic as string : null)
      ?? (typeof d.strategy === 'string' ? d.strategy as string : null);
    return {
      id: inv.id,
      agentName: inv.agent_name ?? 'unknown',
      iteration: inv.iteration,
      tactic,
      generationEstimate: genEst,
      generationActual: genAct,
      rankingEstimate: rankEst,
      rankingActual: rankAct,
      totalCost: inv.cost_usd,
      estimationErrorPct: errPct,
    };
  });
}
