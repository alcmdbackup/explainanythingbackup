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
/** Read a finite numeric field from the first phase block that has it. */
function readPhaseNumber(
  blocks: ReadonlyArray<Record<string, unknown> | undefined>,
  field: 'estimatedCost' | 'cost',
): number | null {
  for (const block of blocks) {
    const v = block?.[field];
    if (typeof v === 'number') return v;
  }
  return null;
}

export function buildInvocationRows(invocations: InvRow[]): CostInvocationRow[] {
  return invocations.map((inv) => {
    const d = (inv.execution_detail ?? {}) as Record<string, unknown>;
    const gen = d.generation as Record<string, unknown> | undefined;
    const rank = d.ranking as Record<string, unknown> | undefined;
    // K5 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): paragraph_recombine
    // invocations persist `paragraph_rewrite.{estimatedCost,cost}` and
    // `paragraph_rank.{estimatedCost,cost}` instead of the generate-style `generation`/`ranking`
    // objects. Map them into the same row shape so the Cost Estimates tab renders the
    // projected-vs-actual rows uniformly. Display rule: paragraph_rewrite goes into the
    // "Gen" column (it's the variant-producing phase) and paragraph_rank goes into the
    // "Rank" column.
    const pRewrite = d.paragraph_rewrite as Record<string, unknown> | undefined;
    const pRank = d.paragraph_rank as Record<string, unknown> | undefined;
    const errPct = typeof d.estimationErrorPct === 'number' && Number.isFinite(d.estimationErrorPct)
      ? d.estimationErrorPct as number : null;
    const tactic = (typeof d.tactic === 'string' && d.tactic ? d.tactic as string : null)
      ?? (typeof d.strategy === 'string' ? d.strategy as string : null);
    return {
      id: inv.id,
      agentName: inv.agent_name ?? 'unknown',
      iteration: inv.iteration,
      tactic,
      generationEstimate: readPhaseNumber([gen, pRewrite], 'estimatedCost'),
      generationActual: readPhaseNumber([gen, pRewrite], 'cost'),
      rankingEstimate: readPhaseNumber([rank, pRank], 'estimatedCost'),
      rankingActual: readPhaseNumber([rank, pRank], 'cost'),
      totalCost: inv.cost_usd,
      estimationErrorPct: errPct,
    };
  });
}
