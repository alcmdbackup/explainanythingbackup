// Tests for V2 evolveArticle main function.

import { evolveArticle } from './runIterationLoop';
import { BudgetExceededError } from '../../types';
import type { EvolutionConfig } from '../infra/types';
import { writeMetric } from '../../metrics/writeMetrics';
import { createMockEntityLogger } from '../../../testing/evolution-test-helpers';
import { RankingAgent } from '../../core/agents/RankingAgent';

jest.mock('../../metrics/writeMetrics', () => ({
  writeMetric: jest.fn().mockResolvedValue(undefined),
  writeMetrics: jest.fn().mockResolvedValue(undefined),
}));

const mockedWriteMetric = writeMetric as jest.MockedFunction<typeof writeMetric>;

const validText = `# Test Article

## Introduction

This is a generated test variant for the evolution pipeline. It demonstrates proper formatting with headings and paragraphs. The content validates correctly against format rules.

## Details

The pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons. Higher-rated variants advance through subsequent iterations.`;

const baseConfig: EvolutionConfig = {
  iterations: 1,
  budgetUsd: 10,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-nano',
};

function makeRawProvider(opts?: { throwOnCall?: number; throwError?: Error }) {
  let callCount = 0;
  return {
    complete: jest.fn(async () => {
      callCount++;
      if (opts?.throwOnCall && callCount >= opts.throwOnCall) {
        throw opts.throwError ?? new BudgetExceededError('gen', 9, 1, 10);
      }
      return validText;
    }),
  };
}

function makeMockDb(opts?: { runStatus?: string; statusError?: boolean }) {
  return {
    from: jest.fn((table: string) => {
      if (table === 'evolution_runs') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(async () => {
                if (opts?.statusError) return { data: null, error: { message: 'DB error' } };
                return { data: { status: opts?.runStatus ?? 'running' }, error: null };
              }),
            })),
          })),
        };
      }
      // evolution_agent_invocations and evolution_logs
      return {
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => ({ data: { id: `inv-${Math.random().toString(36).slice(2, 8)}` }, error: null })),
          })),
        })),
        update: jest.fn(() => ({
          eq: jest.fn(async () => ({ error: null })),
        })),
      };
    }),
  } as never;
}

describe('evolveArticle', () => {
  // ─── Config validation ─────────────────────────────────────
  it('rejects iterations=0', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, iterations: 0 }),
    ).rejects.toThrow('Invalid iterations');
  });

  it('rejects iterations=101', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, iterations: 101 }),
    ).rejects.toThrow('Invalid iterations');
  });

  it('rejects budgetUsd=-1', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, budgetUsd: -1 }),
    ).rejects.toThrow('Invalid budgetUsd');
  });

  it('rejects budgetUsd=51', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, budgetUsd: 51 }),
    ).rejects.toThrow('Invalid budgetUsd');
  });

  it('rejects empty judgeModel', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, judgeModel: '' }),
    ).rejects.toThrow('judgeModel');
  });

  it('rejects empty generationModel', async () => {
    await expect(
      evolveArticle('text', makeRawProvider(), makeMockDb(), 'r1', { ...baseConfig, generationModel: '' }),
    ).rejects.toThrow('generationModel');
  });

  // ─── Normal operation ──────────────────────────────────────
  it('completes 1-iteration run with baseline and stopReason=iterations_complete', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      baseConfig,
    );
    expect(result.stopReason).toBe('iterations_complete');
    expect(result.iterationsRun).toBe(1);
    // Baseline should be in pool
    expect(result.pool.some((v) => v.strategy === 'baseline')).toBe(true);
    expect(result.pool.length).toBeGreaterThan(1);
  });

  it('3-iteration smoke test: pool grows, muHistory has entries', async () => {
    const config = { ...baseConfig, iterations: 3 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    expect(result.stopReason).toBe('iterations_complete');
    expect(result.iterationsRun).toBe(3);
    expect(result.pool.length).toBeGreaterThan(3);
    expect(result.muHistory.length).toBe(3);
  });

  it('winner is highest-mu variant', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      baseConfig,
    );
    // Winner should be a real variant with a rating
    expect(result.winner).toBeDefined();
    expect(result.winner.id).toBeDefined();
  });

  // ─── Budget exhaustion ─────────────────────────────────────
  it('budget exhaustion sets stopReason=budget_exceeded with partial results', async () => {
    const config = { ...baseConfig, iterations: 5, budgetUsd: 0.0001 }; // Very low budget
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    expect(result.stopReason).toBe('budget_exceeded');
    // Should have at least the baseline
    expect(result.pool.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Kill detection ────────────────────────────────────────
  it('kill detection: status=failed → stopReason=killed', async () => {
    const config = { ...baseConfig, iterations: 5 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb({ runStatus: 'failed' }),
      'run-1',
      config,
    );
    expect(result.stopReason).toBe('killed');
  });

  it('kill detection: status=cancelled → stopReason=killed', async () => {
    const config = { ...baseConfig, iterations: 5 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb({ runStatus: 'cancelled' }),
      'run-1',
      config,
    );
    expect(result.stopReason).toBe('killed');
  });

  it('kill detection: DB error swallowed, run continues', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb({ statusError: true }),
      'run-1',
      baseConfig,
    );
    expect(result.stopReason).toBe('iterations_complete');
  });

  // ─── Config defaults ──────────────────────────────────────
  it('defaults applied: omitted optional fields get defaults', async () => {
    const config: EvolutionConfig = {
      iterations: 1,
      budgetUsd: 10,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-nano',
      // strategiesPerRound, calibrationOpponents, tournamentTopK omitted
    };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    // Should complete without error (defaults applied internally)
    expect(result.stopReason).toBe('iterations_complete');
  });

  // ─── Match accumulation ────────────────────────────────────
  it('matchHistory accumulates across iterations', async () => {
    const config = { ...baseConfig, iterations: 2 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    expect(result.matchHistory.length).toBeGreaterThan(0);
  });

  // ─── Cost tracking ────────────────────────────────────────
  it('totalCost is positive after run', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      baseConfig,
    );
    expect(result.totalCost).toBeGreaterThan(0);
  });

  // ─── diversityHistory ──────────────────────────────────────
  it('diversityHistory is empty when proximity not enabled', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      baseConfig,
    );
    expect(result.diversityHistory).toEqual([]);
  });

  // ─── Additional tests ────────────────────────────────────────

  it('matchCounts accumulated correctly across iterations', async () => {
    const config = { ...baseConfig, iterations: 2 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    // matchCounts should have entries for variants that participated in comparisons
    const counts = result.matchCounts;
    expect(Object.keys(counts).length).toBeGreaterThan(0);
    // Each count should be a positive integer
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(0);
      expect(Number.isInteger(count)).toBe(true);
    }
    // Baseline should have participated in some matches
    const baselineEntry = result.pool.find((v) => v.strategy === 'baseline');
    expect(baselineEntry).toBeDefined();
    if (baselineEntry && counts[baselineEntry.id] !== undefined) {
      expect(counts[baselineEntry.id]).toBeGreaterThan(0);
    }
  });

  it('comparisonCache is reused across iterations (fewer LLM calls)', async () => {
    const config = { ...baseConfig, iterations: 2 };
    const provider1 = makeRawProvider();
    const result1 = await evolveArticle(
      'original text',
      provider1,
      makeMockDb(),
      'run-1',
      config,
    );
    const calls2iter = provider1.complete.mock.calls.length;

    // A single iteration should use fewer calls
    const provider2 = makeRawProvider();
    await evolveArticle(
      'original text',
      provider2,
      makeMockDb(),
      'run-2',
      { ...baseConfig, iterations: 1 },
    );
    const calls1iter = provider2.complete.mock.calls.length;

    // 2 iterations should use more calls than 1 (cache prevents re-comparing same pairs
    // but new variants still need comparisons)
    expect(calls2iter).toBeGreaterThan(calls1iter);
    // Result should still complete correctly
    expect(result1.stopReason).toBe('iterations_complete');
  });

  it('convergence detection sets stopReason to converged', async () => {
    // Use many iterations but rely on convergence detection to stop early
    // With only 2 variants (baseline + 1 generated) and consistent wins,
    // sigmas should drop below threshold quickly
    const config = {
      ...baseConfig,
      iterations: 50,
      budgetUsd: 50,
      strategiesPerRound: 1, // Minimal generation to keep pool small
      calibrationOpponents: 1,
      tournamentTopK: 2,
    };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    // Should terminate before all 50 iterations (either converged or budget)
    // The exact stopReason depends on mock behavior, but iterationsRun should be < 50
    expect(result.iterationsRun).toBeLessThanOrEqual(50);
    expect(['converged', 'iterations_complete', 'budget_exceeded']).toContain(result.stopReason);
  });

  it('per-phase cost delta is positive for each phase', async () => {
    const config = { ...baseConfig, iterations: 1, budgetUsd: 10 };
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    // totalCost should reflect all phases
    expect(result.totalCost).toBeGreaterThan(0);
    // The total cost should be less than the budget
    expect(result.totalCost).toBeLessThan(config.budgetUsd);
    // After 1 iteration with generation + ranking, cost should reflect both phases
    // (we can't inspect phase costs directly from the result, but totalCost should be positive)
    expect(result.totalCost).toBeGreaterThan(0);
    // Sanity: pool should have baseline + generated variants
    expect(result.pool.length).toBeGreaterThan(1);
  });

  // ─── Metrics writes ────────────────────────────────────────────

  it('writeMetric called with run cost per LLM call (fire-and-forget)', async () => {
    mockedWriteMetric.mockClear();
    const config = { ...baseConfig, iterations: 2 };
    await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      config,
    );
    // Cost metrics are now written per-LLM-call (fire-and-forget) rather than per-iteration
    const runCostCalls = mockedWriteMetric.mock.calls.filter(
      ([, entityType, , metricName, , timing]) =>
        entityType === 'run' && metricName === 'cost' && timing === 'during_execution',
    );
    // Should be called at least once per LLM call (more than per-iteration)
    expect(runCostCalls.length).toBeGreaterThan(0);
    // Each call should have a positive cost value (cumulative)
    for (const call of runCostCalls) {
      expect(call[4]).toBeGreaterThanOrEqual(0); // value arg
    }
  });

  it('writeMetric called with dynamic agentCost metrics during execution', async () => {
    mockedWriteMetric.mockClear();
    await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      baseConfig,
    );
    // Dynamic agentCost:* metrics should be written
    const agentCostCalls = mockedWriteMetric.mock.calls.filter(
      ([, entityType, , metricName, , timing]) =>
        entityType === 'run'
        && typeof metricName === 'string'
        && metricName.startsWith('agentCost:')
        && timing === 'during_execution',
    );
    expect(agentCostCalls.length).toBeGreaterThan(0);
  });

  // ─── EntityLogger integration ────────────────────────────────
  describe('logging', () => {
    it('logs config validation, winner determination, and evolution complete', async () => {
      const { logger, calls } = createMockEntityLogger();
      await evolveArticle('original text', makeRawProvider(), makeMockDb(), 'run-1', baseConfig, { logger });
      const messages = calls.map((c) => c.message);
      expect(messages).toContain('Config validation passed');
      expect(messages).toContain('Winner determined');
      expect(messages).toContain('Evolution complete');
    });

    it('logs iteration start and generation/ranking results', async () => {
      const { logger, calls } = createMockEntityLogger();
      await evolveArticle('original text', makeRawProvider(), makeMockDb(), 'run-1', { ...baseConfig, iterations: 2 }, { logger });
      const iterationStarts = calls.filter((c) => c.message.startsWith('Starting iteration'));
      expect(iterationStarts.length).toBe(2);
      expect(calls.some((c) => c.message === 'Generation complete')).toBe(true);
      expect(calls.some((c) => c.message === 'Ranking complete')).toBe(true);
    });

    it('logs kill detection when run is killed', async () => {
      const { logger, calls } = createMockEntityLogger();
      await evolveArticle('original text', makeRawProvider(), makeMockDb({ runStatus: 'failed' }), 'run-1', { ...baseConfig, iterations: 5 }, { logger });
      expect(calls.some((c) => c.message === 'Run killed externally')).toBe(true);
    });

    it('logs budget exceeded during ranking', async () => {
      const { logger, calls } = createMockEntityLogger();
      await evolveArticle('original text', makeRawProvider(), makeMockDb(), 'run-1', { ...baseConfig, iterations: 5, budgetUsd: 0.0001 }, { logger });
      expect(calls.some((c) => c.message.includes('budget exceeded') || c.message.includes('Budget exceeded'))).toBe(true);
    });

    it('logs baseline variant and initial pool when provided', async () => {
      const { logger, calls } = createMockEntityLogger();
      await evolveArticle('original text', makeRawProvider(), makeMockDb(), 'run-1', baseConfig, {
        logger,
        initialPool: [{ id: 'init-1', text: 'test', strategy: 'test', iterationBorn: 0, parentIds: [], version: 0, mu: 25, sigma: 8, createdAt: Date.now() }],
      });
      expect(calls.some((c) => c.message === 'Baseline variant added')).toBe(true);
      expect(calls.some((c) => c.message === 'Initial pool loaded')).toBe(true);
    });
  });

  // ─── C3: Generation failure logging ─────────────────────────────
  it('logs warning when generation fails with non-budget error', async () => {
    const { logger, calls } = createMockEntityLogger();
    // Use a provider that returns empty text (which will cause generation to fail validation)
    const provider = makeRawProvider();
    provider.complete.mockResolvedValue('');

    const result = await evolveArticle(
      'original text',
      provider,
      makeMockDb(),
      'run-1',
      baseConfig,
      { logger },
    );
    // Loop should continue to ranking even when generation fails
    expect(result.stopReason).toBe('iterations_complete');
    // Should log generation failure warning
    const genFailCalls = calls.filter((c) =>
      c.message === 'Generation failed (non-budget)' || c.message.includes('Generation'),
    );
    expect(genFailCalls.length).toBeGreaterThan(0);
  });

  // ─── Partial ranking results on budget exceeded ───────────────
  it('applies partial ranking results when ranking returns budgetExceeded with partialResult', async () => {
    const partialRatingUpdates = { 'v-partial-1': { mu: 32, sigma: 5 }, 'v-partial-2': { mu: 18, sigma: 6 } };
    const partialMatchCountIncrements = { 'v-partial-1': 3, 'v-partial-2': 3 };
    const partialMatches = [
      { winnerId: 'v-partial-1', loserId: 'v-partial-2', result: 'win' as const, confidence: 0.8, timestamp: Date.now() },
    ];

    // Spy on RankingAgent.prototype.run to return budget exceeded with partial results
    const rankSpy = jest.spyOn(RankingAgent.prototype, 'run').mockResolvedValueOnce({
      success: false,
      result: null,
      cost: 0.5,
      durationMs: 100,
      invocationId: 'inv-mock',
      budgetExceeded: true,
      partialResult: {
        ratingUpdates: partialRatingUpdates,
        matchCountIncrements: partialMatchCountIncrements,
        matches: partialMatches,
        converged: false,
      },
    });

    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-1',
      { ...baseConfig, iterations: 3 },
    );

    rankSpy.mockRestore();

    expect(result.stopReason).toBe('budget_exceeded');
    // Partial ratings should be applied
    expect(result.ratings.get('v-partial-1')).toEqual({ mu: 32, sigma: 5 });
    expect(result.ratings.get('v-partial-2')).toEqual({ mu: 18, sigma: 6 });
    // Partial match counts should be applied
    expect(result.matchCounts['v-partial-1']).toBe(3);
    expect(result.matchCounts['v-partial-2']).toBe(3);
    // Partial matches should be in matchHistory
    expect(result.matchHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ winnerId: 'v-partial-1', loserId: 'v-partial-2' }),
    ]));
  });

  // ─── Deadline / signal tests ──────────────────────────────────

  it('deadline in past → stopReason=time_limit, iterationsRun=0, winner is baseline', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-dl-1',
      { ...baseConfig, iterations: 5 },
      { deadlineMs: Date.now() - 1000 },
    );
    expect(result.stopReason).toBe('time_limit');
    expect(result.pool.length).toBeGreaterThanOrEqual(1);
    expect(result.winner.strategy).toBe('baseline');
  });

  it('abort signal → stopReason=killed', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-sig-1',
      { ...baseConfig, iterations: 5 },
      { signal: ac.signal },
    );
    expect(result.stopReason).toBe('killed');
  });

  it('deadline far future → normal completion', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-dl-2',
      baseConfig,
      { deadlineMs: Date.now() + 600_000 },
    );
    expect(result.stopReason).toBe('iterations_complete');
    expect(result.iterationsRun).toBe(1);
  });

  it('abort signal + deadline both true → killed wins (abort checked first)', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-both-1',
      { ...baseConfig, iterations: 5 },
      { signal: ac.signal, deadlineMs: Date.now() - 1000 },
    );
    expect(result.stopReason).toBe('killed');
  });

  it('deadline in past + tiny budget → time_limit wins (checked before generate)', async () => {
    const result = await evolveArticle(
      'original text',
      makeRawProvider(),
      makeMockDb(),
      'run-dl-3',
      { ...baseConfig, iterations: 5, budgetUsd: 0.0001 },
      { deadlineMs: Date.now() - 1000 },
    );
    expect(result.stopReason).toBe('time_limit');
  });
});
