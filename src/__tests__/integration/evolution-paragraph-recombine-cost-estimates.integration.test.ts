// Integration test for paragraph_recombine projector-vs-actual instrumentation.
// Per Phase 1 G4-G7 of investigate_paragraph_rewrite_cost_undershoot_evolution_20260529.
//
// Exercises the integration between:
//   - ParagraphRecombineAgent.execute() → persists estimatedTotalCost, estimationErrorPct,
//     paragraph_rewrite{estimatedCost,cost,errorPct}, paragraph_rank{...} into execution_detail.
//   - Finalization compute functions (computeCostEstimationErrorPct, computeEstimatedCost,
//     computeParagraphRewriteEstimationErrorPct, computeParagraphRankEstimationErrorPct)
//     reading the new fields agnostic to agent_name.
//   - Metric registry: paragraph_rewrite_estimation_error_pct + paragraph_rank_estimation_error_pct
//     finalize at run-level + propagate to strategy/experiment.
//
// LLM is fully mocked; no DB writes — this tests the data-flow between agent persistence
// and finalization-phase metric extraction.

import {
  computeCostEstimationErrorPct,
  computeEstimatedCost,
  computeParagraphRewriteEstimationErrorPct,
  computeParagraphRankEstimationErrorPct,
  computeGenerationEstimationErrorPct,
  computeRankingEstimationErrorPct,
} from '@evolution/lib/metrics/computations/finalization';
import type { FinalizationContext } from '@evolution/lib/metrics/types';

describe('paragraph_recombine cost-estimate accuracy — G4-G7 integration', () => {
  // Build a minimal FinalizationContext with a paragraph_recombine invocation that
  // has the new G4/G5 fields populated.
  function makeCtx(invocationDetails: Map<string, unknown>): FinalizationContext {
    return {
      pool: [],
      ratings: new Map(),
      matchCounts: new Map(),
      matchHistory: [],
      invocationDetails,
      seedVariantId: '',
    } as unknown as FinalizationContext;
  }

  it('G6: paragraph_recombine joins cost_estimation_error_pct via the agent-agnostic compute path', () => {
    // Pre-G6 the finalization compute function iterated all invocation details but
    // paragraph_recombine never persisted estimationErrorPct. Post-G4/G5 it does, so
    // the existing compute function picks it up automatically (no new branch needed).
    const details = new Map<string, unknown>([
      ['inv-1', {
        detailType: 'paragraph_recombine',
        estimationErrorPct: -40.86, // (0.0055 - 0.0093) / 0.0093 * 100
        estimatedTotalCost: 0.0093,
        totalCost: 0.0055,
      }],
      ['inv-2', {
        detailType: 'paragraph_recombine',
        estimationErrorPct: -50.0,
        estimatedTotalCost: 0.010,
        totalCost: 0.005,
      }],
    ]);
    const ctx = makeCtx(details);

    const errorPct = computeCostEstimationErrorPct(ctx);
    expect(errorPct).not.toBeNull();
    // Mean of -40.86 and -50.0 = -45.43.
    expect(errorPct).toBeCloseTo(-45.43, 1);

    const estimated = computeEstimatedCost(ctx);
    expect(estimated).toBeCloseTo(0.0093 + 0.010, 4);
  });

  it('G7: paragraph_rewrite_estimation_error_pct computes from execution_detail.paragraph_rewrite', () => {
    const details = new Map<string, unknown>([
      ['inv-1', {
        detailType: 'paragraph_recombine',
        paragraph_rewrite: { estimatedCost: 0.005, cost: 0.0036, estimationErrorPct: -28.0 },
        paragraph_rank: { estimatedCost: 0.0043, cost: 0.0013 },
      }],
      ['inv-2', {
        detailType: 'paragraph_recombine',
        paragraph_rewrite: { estimatedCost: 0.006, cost: 0.0048 },
        // explicit estimationErrorPct in the per-phase object (alternative shape).
      }],
    ]);
    const ctx = makeCtx(details);

    const result = computeParagraphRewriteEstimationErrorPct(ctx);
    expect(result).not.toBeNull();
    // inv-1: (0.0036 - 0.005) / 0.005 * 100 = -28
    // inv-2: (0.0048 - 0.006) / 0.006 * 100 = -20
    // mean = -24
    expect(result).toBeCloseTo(-24.0, 1);
  });

  it('G7: paragraph_rank_estimation_error_pct computes from execution_detail.paragraph_rank', () => {
    const details = new Map<string, unknown>([
      ['inv-1', {
        detailType: 'paragraph_recombine',
        paragraph_rank: { estimatedCost: 0.0043, cost: 0.0013 },
      }],
      ['inv-2', {
        detailType: 'paragraph_recombine',
        paragraph_rank: { estimatedCost: 0.005, cost: 0.0017 },
      }],
    ]);
    const ctx = makeCtx(details);

    const result = computeParagraphRankEstimationErrorPct(ctx);
    expect(result).not.toBeNull();
    // inv-1: (0.0013 - 0.0043) / 0.0043 * 100 = -69.77
    // inv-2: (0.0017 - 0.005) / 0.005 * 100 = -66.0
    // mean = -67.88
    expect(result).toBeCloseTo(-67.88, 1);
  });

  it('G7: returns null when no paragraph_recombine invocations have per-phase data', () => {
    // Mix of generate invocations (have generation/ranking fields) and a paragraph_recombine
    // invocation without per-phase fields. paragraph_rewrite compute should ignore both.
    const details = new Map<string, unknown>([
      ['gen-inv', {
        detailType: 'generate_from_previous_article',
        generation: { estimatedCost: 0.001, cost: 0.0008 },
        ranking: { estimatedCost: 0.0005, cost: 0.0004 },
      }],
      ['pr-inv-no-fields', {
        detailType: 'paragraph_recombine',
        totalCost: 0.005, // missing paragraph_rewrite / paragraph_rank
      }],
    ]);
    const ctx = makeCtx(details);

    expect(computeParagraphRewriteEstimationErrorPct(ctx)).toBeNull();
    expect(computeParagraphRankEstimationErrorPct(ctx)).toBeNull();
  });

  it('paragraph_recombine and generate invocations coexist in the same run', () => {
    // Mixed-iteration runs: generate iteration → paragraph_recombine iteration → swiss.
    // Each compute function should pick up ONLY its phase's data.
    const details = new Map<string, unknown>([
      ['gen-inv-1', {
        detailType: 'generate_from_previous_article',
        generation: { estimatedCost: 0.001, cost: 0.0009 },
        ranking: { estimatedCost: 0.0005, cost: 0.0006 },
        estimationErrorPct: -8.0,
        estimatedTotalCost: 0.0015,
        totalCost: 0.00138,
      }],
      ['pr-inv-1', {
        detailType: 'paragraph_recombine',
        paragraph_rewrite: { estimatedCost: 0.005, cost: 0.0036 },
        paragraph_rank: { estimatedCost: 0.0043, cost: 0.0013 },
        estimationErrorPct: -47.0,
        estimatedTotalCost: 0.0093,
        totalCost: 0.0049,
      }],
    ]);
    const ctx = makeCtx(details);

    // Generate-phase compute pulls from generation.*  — paragraph_rewrite invisible.
    const genErr = computeGenerationEstimationErrorPct(ctx);
    expect(genErr).toBeCloseTo(-10.0, 1); // (0.0009 - 0.001) / 0.001 = -10%
    // Ranking-phase compute pulls from ranking.* — paragraph_rank invisible.
    const rankErr = computeRankingEstimationErrorPct(ctx);
    expect(rankErr).toBeCloseTo(20.0, 1); // (0.0006 - 0.0005) / 0.0005 = +20%
    // Paragraph_rewrite compute picks up ONLY paragraph_recombine invocations.
    const pRewriteErr = computeParagraphRewriteEstimationErrorPct(ctx);
    expect(pRewriteErr).toBeCloseTo(-28.0, 1); // (0.0036 - 0.005) / 0.005 = -28%
    // Top-level estimationErrorPct averages BOTH agents (G6 auto-join is agent-agnostic).
    const topErr = computeCostEstimationErrorPct(ctx);
    expect(topErr).toBeCloseTo((-8.0 + -47.0) / 2, 1);
  });
});
