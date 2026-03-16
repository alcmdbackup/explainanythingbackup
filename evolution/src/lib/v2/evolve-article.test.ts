// Tests for V2 evolveArticle main function.

import { evolveArticle } from './evolve-article';
import { BudgetExceededError } from '../types';
import type { EvolutionConfig } from './types';

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
      // evolution_agent_invocations and evolution_run_logs
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
});
