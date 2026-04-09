// SwissRankingAgent: ONE batch of parallel pair comparisons over the eligible variant set.
// Does NOT apply rating updates — that's the merge agent's job. Returns the raw match buffer.
//
// Each invocation = one swiss iteration's worth of work. The orchestrator dispatches
// new invocations until convergence/exhaustion/budget.
//
// See planning doc: docs/planning/generate_rank_evolution_parallel_20260331/_planning.md

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { METRIC_CATALOG } from '../metricCatalog';
import { computeTotalComparisons } from '../../metrics/computations/finalizationInvocation';
import { BudgetExceededError } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { compareWithBiasMitigation } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { swissPairing, MAX_PAIRS_PER_ROUND, pairKey } from '../../pipeline/loop/swissPairing';
import { swissRankingExecutionDetailSchema } from '../../schemas';
import type { z } from 'zod';

// ─── Public types ─────────────────────────────────────────────────

export interface SwissRankingInput {
  /** Eligible variant IDs (computed by orchestrator from current global ratings). */
  eligibleIds: ReadonlyArray<string>;
  /** Pairs already compared across all swiss iterations. NOT mutated by the agent. */
  completedPairs: ReadonlySet<string>;
  /** Current pool — used to look up variant text for comparisons. */
  pool: ReadonlyArray<Variant>;
  /** Current global ratings — used for pair scoring (not mutated by the agent). */
  ratings: ReadonlyMap<string, Rating>;
  /** Shared comparison cache (order-invariant key). */
  cache: Map<string, ComparisonResult>;
  llm: EvolutionLLMClient;
}

export interface SwissRankingMatchEntry {
  match: V2Match;
  idA: string;
  idB: string;
}

export interface SwissRankingOutput {
  pairs: Array<[string, string]>;
  matches: SwissRankingMatchEntry[];
  status: 'success' | 'budget' | 'no_pairs';
}

export type SwissRankingExecutionDetail = z.infer<typeof swissRankingExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Agent class ──────────────────────────────────────────────────

export class SwissRankingAgent extends Agent<
  SwissRankingInput,
  SwissRankingOutput,
  SwissRankingExecutionDetail
> {
  readonly name = 'swiss_ranking';
  readonly executionDetailSchema = swissRankingExecutionDetailSchema;

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.total_comparisons,
      compute: (ctx) => computeTotalComparisons(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'status', label: 'Status', type: 'badge' },
    { key: 'eligibleCount', label: 'Eligible Count', type: 'number' },
    { key: 'pairsConsidered', label: 'Pairs Considered', type: 'number' },
    { key: 'pairsDispatched', label: 'Pairs Dispatched', type: 'number' },
    { key: 'pairsSucceeded', label: 'Pairs Succeeded', type: 'number' },
    { key: 'pairsFailedBudget', label: 'Pairs Failed (Budget)', type: 'number' },
    { key: 'pairsFailedOther', label: 'Pairs Failed (Other)', type: 'number' },
    { key: 'matchesProducedTotal', label: 'Matches Produced', type: 'number' },
    {
      key: 'matchesProduced', label: 'Matches', type: 'table',
      columns: [
        { key: 'winnerId', label: 'Winner' },
        { key: 'loserId', label: 'Loser' },
        { key: 'result', label: 'Result' },
        { key: 'confidence', label: 'Confidence' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: SwissRankingInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<SwissRankingOutput, SwissRankingExecutionDetail>> {
    const { eligibleIds, completedPairs, pool, ratings, cache, llm } = input;

    const poolMap = new Map<string, Variant>(pool.map((v) => [v.id, v]));

    // Step 1: compute candidate pairs (overlap allowed, capped at MAX_PAIRS_PER_ROUND)
    const pairs = swissPairing(eligibleIds, ratings, completedPairs, MAX_PAIRS_PER_ROUND);
    if (pairs.length === 0) {
      const detail: SwissRankingExecutionDetail = {
        detailType: 'swiss_ranking',
        totalCost: 0,
        eligibleIds: [...eligibleIds],
        eligibleCount: eligibleIds.length,
        pairsConsidered: 0,
        pairsDispatched: 0,
        pairsSucceeded: 0,
        pairsFailedBudget: 0,
        pairsFailedOther: 0,
        matchesProduced: [],
        matchesProducedTotal: 0,
        matchesTruncated: false,
        status: 'no_pairs',
      };
      return {
        result: { pairs: [], matches: [], status: 'no_pairs' },
        detail,
      };
    }

    // Step 2: dispatch ALL pairs in parallel via Promise.allSettled.
    // Even if budget hits mid-batch, the matches that completed reach the merge agent.
    const callLLM = async (prompt: string): Promise<string> => {
      return llm.complete(prompt, 'ranking', {
        model: ctx.config.judgeModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
        taskType: 'comparison',
      });
    };

    const compareOne = async (idA: string, idB: string): Promise<SwissRankingMatchEntry> => {
      const a = poolMap.get(idA);
      const b = poolMap.get(idB);
      if (!a || !b) {
        throw new Error(`SwissRankingAgent: variant not found in pool: ${!a ? idA : idB}`);
      }
      const result = await compareWithBiasMitigation(a.text, b.text, callLLM, cache);
      const isDraw = result.winner !== 'A' && result.winner !== 'B';
      const winnerId = result.winner === 'B' ? idB : idA;
      const loserId = result.winner === 'B' ? idA : idB;
      const match: V2Match = {
        winnerId,
        loserId,
        result: isDraw ? 'draw' : 'win',
        confidence: result.confidence,
        judgeModel: ctx.config.judgeModel,
        reversed: false,
      };
      return { match, idA, idB };
    };

    const settled = await Promise.allSettled(
      pairs.map(([idA, idB]) => compareOne(idA, idB)),
    );

    // Step 3: collect successful matches and budget detection
    const matchBuffer: SwissRankingMatchEntry[] = [];
    let budgetCount = 0;
    let otherFailureCount = 0;

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        matchBuffer.push(r.value);
      } else if (r.reason instanceof BudgetExceededError) {
        budgetCount++;
      } else {
        otherFailureCount++;
        ctx.logger.warn('SwissRankingAgent: pair comparison failed (non-budget)', {
          phaseName: 'ranking',
          error: (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 500),
        });
      }
    }

    const status: 'success' | 'budget' = budgetCount > 0 ? 'budget' : 'success';

    const truncated = matchBuffer.length > 50;
    const matchesProducedSample = matchBuffer.slice(0, 50).map((m) => ({
      winnerId: m.match.winnerId,
      loserId: m.match.loserId,
      result: m.match.result,
      confidence: m.match.confidence,
    }));

    const detail: SwissRankingExecutionDetail = {
      detailType: 'swiss_ranking',
      totalCost: 0, // patched by Agent.run() from cost-tracker delta
      eligibleIds: [...eligibleIds],
      eligibleCount: eligibleIds.length,
      pairsConsidered: pairs.length,
      pairsDispatched: pairs.length,
      pairsSucceeded: matchBuffer.length,
      pairsFailedBudget: budgetCount,
      pairsFailedOther: otherFailureCount,
      matchesProduced: matchesProducedSample,
      matchesProducedTotal: matchBuffer.length,
      matchesTruncated: truncated,
      status,
    };

    return {
      result: { pairs, matches: matchBuffer, status },
      detail,
      parentVariantIds: [...eligibleIds],
    };
  }
}

// Re-export pairKey for the orchestrator's completedPairs tracking.
export { pairKey };
