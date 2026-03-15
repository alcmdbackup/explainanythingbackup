/**
 * @jest-environment node
 */
// Tests for experiment driver ops module — state machine transitions, terminal summaries.

// ─── Mocks ───────────────────────────────────────────────────────

const mockFrom = jest.fn();

jest.mock('@evolution/experiments/evolution/analysis', () => ({
  computeManualAnalysis: (...args: unknown[]) => mockComputeManualAnalysis(...args),
}));

jest.mock('@evolution/experiments/evolution/experimentMetrics', () => ({
  computeRunMetrics: jest.fn().mockResolvedValue({ metrics: {} }),
}));

jest.mock('@evolution/lib/core/rating', () => ({
  toEloScale: jest.fn((mu: number) => 1200 + mu * 16),
}));

jest.mock('@evolution/services/strategyResolution', () => ({
  resolveOrCreateStrategyFromRunConfig: jest.fn().mockResolvedValue({ id: 'strat-mock', isNew: true }),
}));

const mockCallLLM = jest.fn().mockResolvedValue('## Executive Summary\nMock report text');
jest.mock('@/lib/services/llms', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

jest.mock('@evolution/lib/core/llmClient', () => ({
  EVOLUTION_SYSTEM_USERID: '00000000-0000-4000-8000-000000000001',
}));

jest.mock('@evolution/services/experimentReportPrompt', () => ({
  buildExperimentReportPrompt: jest.fn().mockReturnValue('Mock prompt'),
  REPORT_MODEL: 'gpt-4.1-nano',
}));

jest.mock('@evolution/services/experimentHelpers', () => ({
  extractTopElo: jest.fn().mockReturnValue(1600),
}));

import { advanceExperiments } from './experimentDriver';

const mockComputeManualAnalysis = jest.fn();

// ─── Helpers ─────────────────────────────────────────────────────

function baseExperiment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exp-1',
    name: 'Test Exp',
    status: 'running',
    total_budget_usd: 100,
    spent_usd: 10,
    convergence_threshold: 10,
    design: 'manual',
    factor_definitions: {},
    prompt_id: 'prompt-uuid-1',
    config_defaults: null,
    ...overrides,
  };
}

function createChain(resolved: unknown = { data: null, error: null }) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn();
  }
  for (const m of methods) {
    if (m === 'single') {
      chain[m].mockResolvedValue(resolved);
    } else {
      chain[m].mockReturnValue(chain);
    }
  }
  chain.then = jest.fn((resolve: (v: unknown) => void) => resolve(resolved));
  return chain;
}

function buildSupabase() {
  return { from: mockFrom } as unknown as Parameters<typeof advanceExperiments>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── No Active Experiments ───────────────────────────────────────

describe('no active experiments', () => {
  it('returns processed=0', async () => {
    const chain = createChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const result = await advanceExperiments(buildSupabase());
    expect(result.processed).toBe(0);
    expect(result.transitions).toEqual([]);
  });
});

// ─── running Transitions ─────────────────────────────────────────

describe('running', () => {
  it('stays in running when runs still active', async () => {
    const exp = baseExperiment();
    const runs = [
      { status: 'completed', total_cost_usd: 2 },
      { status: 'running', total_cost_usd: 0 },
    ];

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && callCount === 0) {
        callCount++;
        return createChain({ data: [exp], error: null });
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockResolvedValue({ data: runs, error: null });
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBeNull();
    expect(result.transitions[0].detail).toContain('still active');
  });

  it('transitions to analyzing when all completed', async () => {
    const exp = baseExperiment();
    const runs = [
      { status: 'completed', total_cost_usd: 2 },
      { status: 'completed', total_cost_usd: 3 },
    ];

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (callCount === 0) {
          callCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain({ data: null, error: null });
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockResolvedValue({ data: runs, error: null });
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('analyzing');
    expect(result.transitions[0].detail).toContain('2/2 runs completed');
  });

  it('transitions to failed when all runs failed', async () => {
    const exp = baseExperiment();
    const runs = [
      { status: 'failed', total_cost_usd: 1 },
      { status: 'failed', total_cost_usd: 0 },
    ];

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (callCount === 0) {
          callCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockResolvedValue({ data: runs, error: null });
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('failed');
    expect(result.transitions[0].detail).toContain('failed');
  });
});

// ─── analyzing Transitions ───────────────────────────────────────

describe('analyzing', () => {
  function setupAnalyzingMocks(
    exp: Record<string, unknown>,
    analysis: Record<string, unknown>,
    dbRuns: unknown[] = [],
  ) {
    mockComputeManualAnalysis.mockReturnValue(analysis);

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockReturnValue(chain);
        chain.in.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: dbRuns, error: null }),
        );
        return chain;
      }
      if (table === 'evolution_run_agent_metrics') {
        const chain = createChain();
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      return createChain();
    });
  }

  it('transitions to completed when runs exist', async () => {
    const exp = baseExperiment({ status: 'analyzing' });
    const dbRuns = [
      { id: 'run-1', status: 'completed', total_cost_usd: 2, run_summary: { topVariants: [{ mu: 10 }] }, config: { _experimentRow: 1 }, strategy_config_id: 'strat-1' },
      { id: 'run-2', status: 'completed', total_cost_usd: 3, run_summary: { topVariants: [{ mu: 8 }] }, config: { _experimentRow: 2 }, strategy_config_id: 'strat-2' },
    ];
    setupAnalyzingMocks(exp, {
      type: 'manual',
      runs: dbRuns.map(r => ({ runId: r.id, configLabel: 'test', elo: 1600, cost: 1, eloPer$: 400 })),
      completedRuns: 2,
      totalRuns: 2,
      warnings: [],
    }, dbRuns);

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('completed');
    expect(result.transitions[0].detail).toContain('Completed');
  });

  it('transitions to failed when all runs failed', async () => {
    const exp = baseExperiment({ status: 'analyzing' });
    const dbRuns = [
      { id: 'run-1', status: 'failed', total_cost_usd: 1, run_summary: null, config: { _experimentRow: 1 }, strategy_config_id: null },
      { id: 'run-2', status: 'failed', total_cost_usd: 0, run_summary: null, config: { _experimentRow: 2 }, strategy_config_id: null },
    ];
    setupAnalyzingMocks(exp, {
      type: 'manual',
      runs: [],
      completedRuns: 0,
      totalRuns: 2,
      warnings: ['2 of 2 runs incomplete'],
    }, dbRuns);

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('failed');
    expect(result.transitions[0].detail).toContain('failed');
  });
});

// ─── Terminal State Summary ──────────────────────────────────────

describe('terminal state results summary', () => {
  it('writes results_summary when completing', async () => {
    const exp = baseExperiment({ status: 'analyzing' });

    mockComputeManualAnalysis.mockReturnValue({
      type: 'manual',
      runs: [{ runId: 'r1', configLabel: 'test', elo: 1600, cost: 1, eloPer$: 400 }],
      completedRuns: 2,
      totalRuns: 2,
      warnings: [],
    });

    const updateCalls: Array<{ table: string; data: unknown }> = [];

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        const chain = createChain();
        chain.update.mockImplementation((data: unknown) => {
          updateCalls.push({ table, data });
          return chain;
        });
        return chain;
      }
      if (table === 'evolution_run_agent_metrics') {
        const chain = createChain();
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_runs') {
        const completedRuns = [
          { id: 'run-1', status: 'completed', run_summary: { topVariants: [{ mu: 10 }] }, config: { _experimentRow: 1 }, total_cost_usd: 2, strategy_config_id: 'strat-1' },
        ];
        const chain = createChain();
        chain.eq.mockReturnValue(chain);
        chain.in.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: completedRuns, error: null }),
        );
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('completed');

    const summaryUpdate = updateCalls.find(
      c => c.table === 'evolution_experiments' && (c.data as Record<string, unknown>).results_summary,
    );
    expect(summaryUpdate).toBeDefined();
    const summary = (summaryUpdate?.data as Record<string, unknown>).results_summary as Record<string, unknown>;
    expect(summary.terminationReason).toBe('completed');
    expect(summary.factorRanking).toBeDefined();
  });
});

// ─── Multiple Experiments ────────────────────────────────────────

describe('multiple experiments', () => {
  it('processes multiple active experiments', async () => {
    const exp1 = baseExperiment({ id: 'exp-1', status: 'running' });
    const exp2 = baseExperiment({ id: 'exp-2', status: 'running' });

    let firstCall = true;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && firstCall) {
        firstCall = false;
        return createChain({ data: [exp1, exp2], error: null });
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockResolvedValue({
          data: [{ status: 'running', total_cost_usd: 0 }],
          error: null,
        });
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.processed).toBe(2);
    expect(result.transitions).toHaveLength(2);
  });
});

// ─── Error Handling ──────────────────────────────────────────────

describe('error handling', () => {
  it('handles fetch error by throwing', async () => {
    mockFrom.mockImplementation(() => createChain({ data: null, error: { message: 'DB error' } }));

    await expect(advanceExperiments(buildSupabase())).rejects.toThrow('Experiment driver fetch error');
  });

  it('handles per-experiment errors without stopping others', async () => {
    const exp1 = baseExperiment({ id: 'exp-1', status: 'running' });
    const exp2 = baseExperiment({ id: 'exp-2', status: 'running' });

    let firstCall = true;
    let runCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && firstCall) {
        firstCall = false;
        return createChain({ data: [exp1, exp2], error: null });
      }
      if (table === 'evolution_runs') {
        runCallCount++;
        if (runCallCount === 1) {
          throw new Error('Run fetch failed');
        }
        const chain = createChain();
        chain.eq.mockResolvedValue({
          data: [{ status: 'running', total_cost_usd: 0 }],
          error: null,
        });
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.processed).toBe(2);
    expect(result.transitions[0].detail).toContain('Error');
    expect(result.transitions[1].to).toBeNull();
  });
});

// ─── Report Generation ──────────────────────────────────────────

describe('report generation', () => {
  function setupCompletingMocks() {
    const exp = baseExperiment({ status: 'analyzing' });
    const completedRuns = [
      { id: 'run-1', status: 'completed', run_summary: { topVariants: [{ mu: 10 }] }, config: { _experimentRow: 1 }, total_cost_usd: 2, strategy_config_id: 'strat-1' },
    ];

    mockComputeManualAnalysis.mockReturnValue({
      type: 'manual',
      runs: [{ runId: 'run-1', configLabel: 'test', elo: 1600, cost: 2, eloPer$: 200 }],
      completedRuns: 1,
      totalRuns: 1,
      warnings: [],
    });

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_run_agent_metrics') {
        const chain = createChain();
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockReturnValue(chain);
        chain.in.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: completedRuns, error: null }),
        );
        return chain;
      }
      return createChain();
    });
  }

  it('calls callLLM for report generation on terminal state', async () => {
    setupCompletingMocks();
    mockCallLLM.mockResolvedValue('## Summary\nTest report');

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('completed');
    expect(mockCallLLM).toHaveBeenCalledWith(
      'Mock prompt',
      'experiment_report_generation',
      '00000000-0000-4000-8000-000000000001',
      'gpt-4.1-nano',
      false,
      null,
    );
  });

  it('does not block experiment completion when callLLM throws', async () => {
    setupCompletingMocks();
    mockCallLLM.mockRejectedValue(new Error('LLM service unavailable'));

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('completed');
  });
});

// ─── Manual Experiment Lifecycle ─────────────────────────────────

describe('manual experiment analyzing', () => {
  it('uses computeManualAnalysis for design=manual', async () => {
    const exp = baseExperiment({ status: 'analyzing', design: 'manual', factor_definitions: {} });
    const dbRuns = [
      { id: 'run-1', status: 'completed', total_cost_usd: 0.45, run_summary: { topVariants: [{ mu: 10 }] }, config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4.1-nano' }, strategy_config_id: null },
    ];

    mockComputeManualAnalysis.mockReturnValue({
      type: 'manual',
      runs: [{ runId: 'run-1', configLabel: 'gpt-4o / gpt-4.1-nano', elo: 1360, cost: 0.45, 'eloPer$': 3022 }],
      completedRuns: 1,
      totalRuns: 1,
      warnings: [],
    });

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_run_agent_metrics') {
        const chain = createChain();
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockReturnValue(chain);
        chain.in.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: dbRuns, error: null }),
        );
        return chain;
      }
      return createChain();
    });

    const result = await advanceExperiments(buildSupabase());
    expect(result.transitions[0].to).toBe('completed');
    expect(mockComputeManualAnalysis).toHaveBeenCalled();
  });
});
