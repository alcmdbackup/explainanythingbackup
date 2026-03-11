/**
 * @jest-environment node
 */
// Tests for experiment driver cron route — state machine transitions, terminal summaries.
// Mocks Supabase, auth, analysis, and LLM to verify each transition path in the flat experiment model.

import { NextResponse } from 'next/server';

// ─── Mocks ───────────────────────────────────────────────────────

// Supabase mock
const mockSingle = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

jest.mock('@/lib/utils/cronAuth', () => ({
  requireCronAuth: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock analysis
const mockComputeManualAnalysis = jest.fn();
jest.mock('@evolution/experiments/evolution/analysis', () => ({
  computeManualAnalysis: (...args: unknown[]) => mockComputeManualAnalysis(...args),
}));

jest.mock('@evolution/lib/core/rating', () => ({
  toEloScale: jest.fn((mu: number) => 1200 + mu * 16),
}));

jest.mock('@evolution/services/strategyResolution', () => ({
  resolveOrCreateStrategyFromRunConfig: jest.fn().mockResolvedValue({ id: 'strat-mock', isNew: true }),
}));

// LLM mocks for report generation in writeTerminalState
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

import { GET } from './route';
import { requireCronAuth } from '@/lib/utils/cronAuth';

// ─── Helpers ─────────────────────────────────────────────────────

function mockRequest(): Request {
  return new Request('http://localhost/api/cron/experiment-driver', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

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

/** Create a chainable Supabase query builder mock. */
function createChain(resolved: unknown = { data: null, error: null }) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn();
  }
  // All chain methods return chain (for chaining), except single which resolves
  for (const m of methods) {
    if (m === 'single') {
      chain[m].mockResolvedValue(resolved);
    } else {
      chain[m].mockReturnValue(chain);
    }
  }
  // Also make the chain itself thenable (for await without .single())
  chain.then = jest.fn((resolve: (v: unknown) => void) => resolve(resolved));
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireCronAuth as jest.Mock).mockReturnValue(null);
});

// ─── Auth Tests ──────────────────────────────────────────────────

describe('authentication', () => {
  it('rejects unauthorized requests', async () => {
    (requireCronAuth as jest.Mock).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(mockRequest());
    expect(res.status).toBe(401);
  });

  it('rejects when CRON_SECRET missing', async () => {
    (requireCronAuth as jest.Mock).mockReturnValue(
      NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 }),
    );
    const res = await GET(mockRequest());
    expect(res.status).toBe(500);
  });
});

// ─── No Active Experiments ───────────────────────────────────────

describe('no active experiments', () => {
  it('returns ok with processed=0', async () => {
    const chain = createChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.processed).toBe(0);
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBeNull();
    expect(body.transitions[0].detail).toContain('still active');
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
        // Update calls
        return createChain({ data: null, error: null });
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.eq.mockResolvedValue({ data: runs, error: null });
        return chain;
      }
      return createChain();
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('analyzing');
    expect(body.transitions[0].detail).toContain('2/2 runs completed');
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('failed');
    expect(body.transitions[0].detail).toContain('failed');
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
        // Subsequent calls are updates
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
      { id: 'run-1', status: 'completed', total_cost_usd: 2, run_summary: { topVariants: [{ ordinal: 10 }] }, config: { _experimentRow: 1 }, strategy_config_id: 'strat-1' },
      { id: 'run-2', status: 'completed', total_cost_usd: 3, run_summary: { topVariants: [{ ordinal: 8 }] }, config: { _experimentRow: 2 }, strategy_config_id: 'strat-2' },
    ];
    setupAnalyzingMocks(exp, {
      type: 'manual',
      runs: dbRuns.map(r => ({ runId: r.id, configLabel: 'test', elo: 1600, cost: 1, eloPer$: 400 })),
      completedRuns: 2,
      totalRuns: 2,
      warnings: [],
    }, dbRuns);

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('completed');
    expect(body.transitions[0].detail).toContain('Completed');
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('failed');
    expect(body.transitions[0].detail).toContain('failed');
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
        // Capture update calls
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
          { id: 'run-1', status: 'completed', run_summary: { topVariants: [{ ordinal: 10 }] }, config: { _experimentRow: 1 }, total_cost_usd: 2, strategy_config_id: 'strat-1' },
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('completed');

    // Verify results_summary was written
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
        // Still running — no transition
        chain.eq.mockResolvedValue({
          data: [{ status: 'running', total_cost_usd: 0 }],
          error: null,
        });
        return chain;
      }
      return createChain();
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.processed).toBe(2);
    expect(body.transitions).toHaveLength(2);
  });
});

// ─── Error Handling ──────────────────────────────────────────────

describe('error handling', () => {
  it('handles fetch error gracefully', async () => {
    mockFrom.mockImplementation(() => createChain({ data: null, error: { message: 'DB error' } }));

    const res = await GET(mockRequest());
    expect(res.status).toBe(500);
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
          // First experiment's run query throws
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.processed).toBe(2);
    // First experiment errored, second should still be processed
    expect(body.transitions[0].detail).toContain('Error');
    expect(body.transitions[1].to).toBeNull(); // Still running
  });
});

// ─── Report Generation in writeTerminalState ─────────────────────

describe('report generation', () => {
  function setupCompletingMocks(overrides: Partial<Record<string, unknown>> = {}) {
    const exp = baseExperiment({
      status: 'analyzing',
      ...overrides,
    });

    const completedRuns = [
      { id: 'run-1', status: 'completed', run_summary: { topVariants: [{ ordinal: 10 }] }, config: { _experimentRow: 1 }, total_cost_usd: 2, strategy_config_id: 'strat-1' },
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

    return { exp, completedRuns };
  }

  it('calls callLLM for report generation on terminal state', async () => {
    setupCompletingMocks();
    mockCallLLM.mockResolvedValue('## Summary\nTest report');

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('completed');
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

    const res = await GET(mockRequest());
    const body = await res.json();
    // Experiment should still complete despite report failure
    expect(body.transitions[0].to).toBe('completed');
  });
});

// ─── Manual Experiment Lifecycle ─────────────────────────────────

describe('manual experiment analyzing', () => {
  it('uses computeManualAnalysis for design=manual', async () => {
    const exp = baseExperiment({ status: 'analyzing', design: 'manual', factor_definitions: {} });
    const dbRuns = [
      { id: 'run-1', status: 'completed', total_cost_usd: 0.45, run_summary: { topVariants: [{ ordinal: 10 }] }, config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4.1-nano' }, strategy_config_id: null },
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('completed');
    expect(mockComputeManualAnalysis).toHaveBeenCalled();
  });
});
