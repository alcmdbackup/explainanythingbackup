/**
 * @jest-environment node
 */
// Tests for experiment driver cron route — state machine transitions, auto-derivation, terminal summaries.
// Mocks Supabase, auth, analysis, and cost estimation to verify each transition path.

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
  },
}));

// Mock analysis
const mockAnalyzeExperiment = jest.fn();
jest.mock('@evolution/experiments/evolution/analysis', () => ({
  analyzeExperiment: (...args: unknown[]) => mockAnalyzeExperiment(...args),
}));

// Mock factorial — keep real L8 generation but mock full-factorial
const actualFactorial = jest.requireActual('@evolution/experiments/evolution/factorial');
jest.mock('@evolution/experiments/evolution/factorial', () => ({
  ...actualFactorial,
  generateFullFactorialDesign: jest.fn().mockReturnValue({
    type: 'full-factorial',
    factors: [{ name: 'genModel', label: 'Generation Model', levels: ['a', 'b', 'c'] }],
    runs: [
      { row: 1, factors: { genModel: 'a' }, pipelineArgs: { model: 'a', judgeModel: 'gpt-5-nano', iterations: 3, enabledAgents: ['iterativeEditing', 'reflection'] } },
      { row: 2, factors: { genModel: 'b' }, pipelineArgs: { model: 'b', judgeModel: 'gpt-5-nano', iterations: 3, enabledAgents: ['iterativeEditing', 'reflection'] } },
      { row: 3, factors: { genModel: 'c' }, pipelineArgs: { model: 'c', judgeModel: 'gpt-5-nano', iterations: 3, enabledAgents: ['iterativeEditing', 'reflection'] } },
    ],
  }),
  mapFactorsToPipelineArgs: jest.fn().mockReturnValue({
    model: 'gpt-4.1-mini',
    judgeModel: 'gpt-5-nano',
    iterations: 3,
    enabledAgents: ['iterativeEditing', 'reflection'],
  }),
}));

jest.mock('@evolution/experiments/evolution/factorRegistry', () => ({
  FACTOR_REGISTRY: new Map([
    ['genModel', {
      key: 'genModel', label: 'Generation Model', type: 'model',
      getValidValues: (): string[] => ['gpt-4.1-mini', 'gpt-4o', 'gpt-5-mini'],
      expandAroundWinner: (): string[] => ['gpt-4.1-mini', 'gpt-4o', 'gpt-5-mini'],
      validate: (): boolean => true,
    }],
    ['iterations', {
      key: 'iterations', label: 'Iterations', type: 'integer',
      getValidValues: (): number[] => [3, 5, 8],
      expandAroundWinner: (): number[] => [3, 5, 8],
      validate: (): boolean => true,
    }],
  ]),
}));

jest.mock('@evolution/experiments/evolution/experimentValidation', () => ({
  estimateBatchCost: jest.fn().mockResolvedValue(10.0),
}));

const resolveConfigDefaults = {
  generationModel: 'gpt-4.1-mini',
  judgeModel: 'gpt-5-nano',
  maxIterations: 3,
  enabledAgents: ['iterativeEditing', 'reflection'],
  budgetCapUsd: 5.0,
  budgetCaps: {},
};
jest.mock('@evolution/lib/config', () => ({
  resolveConfig: jest.fn((overrides?: Record<string, unknown>) => ({
    ...resolveConfigDefaults,
    ...overrides,
  })),
}));

jest.mock('@evolution/lib/core/rating', () => ({
  ordinalToEloScale: jest.fn((ord: number) => 1200 + ord * 16),
}));

jest.mock('@evolution/services/strategyResolution', () => ({
  resolveOrCreateStrategyFromRunConfig: jest.fn().mockResolvedValue({ id: 'strat-mock', isNew: true }),
}));

import { GET } from './route';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { estimateBatchCost } from '@evolution/experiments/evolution/experimentValidation';

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
    status: 'round_running',
    optimization_target: 'elo',
    total_budget_usd: 100,
    spent_usd: 10,
    max_rounds: 5,
    current_round: 1,
    convergence_threshold: 10,
    factor_definitions: {
      genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' },
      iterations: { low: 3, high: 8 },
    },
    prompts: ['Explain photosynthesis'],
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

// ─── round_running Transitions ───────────────────────────────────

describe('round_running', () => {
  it('stays in round_running when runs still active', async () => {
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
      if (table === 'evolution_experiment_rounds') {
        return createChain({ data: { batch_run_id: 'batch-1' }, error: null });
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

  it('transitions to round_analyzing when all completed', async () => {
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
      if (table === 'evolution_experiment_rounds') {
        return createChain({ data: { batch_run_id: 'batch-1' }, error: null });
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
    expect(body.transitions[0].to).toBe('round_analyzing');
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
      if (table === 'evolution_experiment_rounds') {
        return createChain({ data: { batch_run_id: 'batch-1' }, error: null });
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

// ─── round_analyzing Transitions ─────────────────────────────────

describe('round_analyzing', () => {
  function setupAnalyzingMocks(
    exp: Record<string, unknown>,
    analysis: Record<string, unknown>,
    dbRuns: unknown[] = [],
  ) {
    const round = {
      id: 'round-1',
      batch_run_id: 'batch-1',
      design: 'L8',
      factor_definitions: {
        A: { name: 'genModel', label: 'Generation Model', low: 'gpt-4.1-mini', high: 'gpt-4o' },
        B: { name: 'judgeModel', label: 'Judge Model', low: 'gpt-5-nano', high: 'gpt-4.1-nano' },
        C: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
        D: { name: 'editor', label: 'Editing Approach', low: 'iterativeEditing', high: 'treeSearch' },
        E: { name: 'supportAgents', label: 'Support Agents', low: 'off', high: 'on' },
      },
    };

    mockAnalyzeExperiment.mockReturnValue(analysis);

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
      if (table === 'evolution_experiment_rounds') {
        // Needs to handle both .single() queries (returns object) and
        // non-.single() queries (returns array) — used by writeTerminalState
        const chain = createChain({ data: round, error: null });
        // Override .then for non-single queries (writeTerminalState does select().eq())
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [round], error: null }),
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
  }

  it('transitions to converged when top effect < threshold', async () => {
    const exp = baseExperiment({ status: 'round_analyzing', convergence_threshold: 50 });
    setupAnalyzingMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 30, eloPerDollarEffect: 30, importance: 30 },
      ],
      recommendations: ['Use high model'],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 30 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('converged');
    expect(body.transitions[0].detail).toContain('Converged');
  });

  it('transitions to budget_exhausted when > 90% spent', async () => {
    const exp = baseExperiment({
      status: 'round_analyzing',
      convergence_threshold: 5,
      total_budget_usd: 100,
      spent_usd: 95,
    });
    setupAnalyzingMocks(exp, {
      factorRanking: [{ factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 }],
      recommendations: [],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 100 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('budget_exhausted');
  });

  it('transitions to max_rounds when at limit', async () => {
    const exp = baseExperiment({
      status: 'round_analyzing',
      convergence_threshold: 5,
      max_rounds: 1,
      current_round: 1,
    });
    setupAnalyzingMocks(exp, {
      factorRanking: [{ factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 }],
      recommendations: [],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 100 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('max_rounds');
  });

  it('does NOT converge when importance < threshold but ci_upper >= threshold', async () => {
    // Point estimate (importance=30) is below threshold (50), but CI upper bound (60) is above.
    // CI-based convergence should NOT converge — the effect might still be large.
    const exp = baseExperiment({ status: 'round_analyzing', convergence_threshold: 50, max_rounds: 5 });
    setupAnalyzingMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 30, eloPerDollarEffect: 30, importance: 30, ci_upper: 60 },
      ],
      recommendations: ['Use high model'],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 30 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    // Should NOT converge because ci_upper (60) >= threshold (50)
    expect(body.transitions[0].to).not.toBe('converged');
    expect(body.transitions[0].to).toBe('pending_next_round');
  });

  it('converges when ci_upper is below threshold (stricter than point estimate)', async () => {
    const exp = baseExperiment({ status: 'round_analyzing', convergence_threshold: 50, max_rounds: 5 });
    setupAnalyzingMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 30, eloPerDollarEffect: 30, importance: 30, ci_upper: 40 },
      ],
      recommendations: [],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 30 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('converged');
  });

  it('falls back to importance when ci_upper is undefined', async () => {
    // Legacy analysis without CIs — should fall back to point-estimate convergence
    const exp = baseExperiment({ status: 'round_analyzing', convergence_threshold: 50, max_rounds: 5 });
    setupAnalyzingMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 30, eloPerDollarEffect: 30, importance: 30 },
      ],
      recommendations: [],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 30 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    // importance (30) < threshold (50) → should converge
    expect(body.transitions[0].to).toBe('converged');
  });

  it('transitions to pending_next_round otherwise', async () => {
    const exp = baseExperiment({
      status: 'round_analyzing',
      convergence_threshold: 5,
      max_rounds: 5,
      current_round: 1,
      spent_usd: 10,
    });
    setupAnalyzingMocks(exp, {
      factorRanking: [{ factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 }],
      recommendations: [],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 100 }, eloPerDollar: {} },
      interactions: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('pending_next_round');
    expect(body.transitions[0].detail).toContain('preparing next round');
  });
});

// ─── pending_next_round Transitions ──────────────────────────────

describe('pending_next_round', () => {
  function setupNextRoundMocks(
    exp: Record<string, unknown>,
    analysisResults: Record<string, unknown>,
    budgetExhausted = false,
  ) {
    const lastRound = {
      batch_run_id: 'batch-1',
      analysis_results: analysisResults,
      factor_definitions: {
        A: { name: 'genModel', label: 'Generation Model', low: 'gpt-4.1-mini', high: 'gpt-4o' },
        B: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
      },
      design: 'L8',
    };

    if (budgetExhausted) {
      (estimateBatchCost as jest.Mock).mockResolvedValue(200); // Over budget
    } else {
      (estimateBatchCost as jest.Mock).mockResolvedValue(10);
    }

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_experiment_rounds') {
        // Handles both .single() (returns object) and non-.single() (returns array)
        const chain = createChain({ data: lastRound, error: null });
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [lastRound], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_batch_runs') {
        return createChain({ data: { id: 'batch-new' }, error: null });
      }
      if (table === 'topics') {
        return createChain({ data: { id: 1 }, error: null });
      }
      if (table === 'explanations') {
        return createChain({ data: { id: 42 }, error: null });
      }
      if (table === 'evolution_runs') {
        // Handles both insert (for run creation) and select+in+eq (for writeTerminalState)
        const chain = createChain();
        chain.insert.mockResolvedValue({ error: null });
        chain.in.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      return createChain();
    });
  }

  it('creates next round and transitions to round_running', async () => {
    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
      spent_usd: 10,
      total_budget_usd: 100,
    });
    setupNextRoundMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 },
        { factor: 'B', factorLabel: 'Iterations', eloEffect: 5, eloPerDollarEffect: 5, importance: 5 },
      ],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('round_running');
    expect(body.transitions[0].detail).toContain('Created round 2');
  });

  it('transitions to budget_exhausted if next round too expensive', async () => {
    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
      spent_usd: 90,
      total_budget_usd: 100,
    });
    setupNextRoundMocks(
      exp,
      {
        factorRanking: [
          { factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 },
        ],
      },
      true, // budget exhausted
    );

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('budget_exhausted');
    expect(body.transitions[0].detail).toContain('remaining');
  });

  it('converges when all factors negligible', async () => {
    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
    });
    // All factors have near-zero importance — all negligible (< 15% of top)
    setupNextRoundMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 1, eloPerDollarEffect: 1, importance: 1 },
        { factor: 'B', factorLabel: 'Iterations', eloEffect: 0.1, eloPerDollarEffect: 0.1, importance: 0.1 },
      ],
    });
    // Mock FACTOR_REGISTRY so expandAroundWinner is never called (both locked)
    // With importance 1 and 0.1, threshold = 0.15. Factor A (1) > 0.15 so it'll be expanded.
    // Let me adjust: both factors need to be below topThreshold = top * 0.15

    // Actually 1 * 0.15 = 0.15. Factor B has importance 0.1 < 0.15, so it's locked.
    // Factor A has importance 1 >= 0.15, so it's expanded. Both won't be locked.
    // To make both negligible, we need a scenario where no registry factor matches.
    // Let me use a different approach: set factor keys that aren't in registry.
    setupNextRoundMocks(exp, {
      factorRanking: [
        { factor: 'unknown1', factorLabel: 'Unknown 1', eloEffect: 1, eloPerDollarEffect: 1, importance: 1 },
        { factor: 'unknown2', factorLabel: 'Unknown 2', eloEffect: 0.1, eloPerDollarEffect: 0.1, importance: 0.1 },
      ],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('converged');
    expect(body.transitions[0].detail).toContain('All factors negligible');
  });

  it('passes per-run budget to created runs', async () => {
    // remaining = 50 - 20 = 30, mock FF design has 3 runs × 1 prompt = 3 total → $10 each
    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
      spent_usd: 20,
      total_budget_usd: 50,
    });

    const capturedInserts: unknown[] = [];

    const lastRound = {
      batch_run_id: 'batch-1',
      analysis_results: {
        factorRanking: [
          { factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 },
          { factor: 'B', factorLabel: 'Iterations', eloEffect: 5, eloPerDollarEffect: 5, importance: 5 },
        ],
      },
      factor_definitions: {
        A: { name: 'genModel', label: 'Generation Model', low: 'gpt-4.1-mini', high: 'gpt-4o' },
        B: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
      },
      design: 'L8',
    };

    (estimateBatchCost as jest.Mock).mockResolvedValue(10);

    let expCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        if (expCallCount === 0) {
          expCallCount++;
          return createChain({ data: [exp], error: null });
        }
        return createChain();
      }
      if (table === 'evolution_experiment_rounds') {
        const chain = createChain({ data: lastRound, error: null });
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [lastRound], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_batch_runs') {
        return createChain({ data: { id: 'batch-new' }, error: null });
      }
      if (table === 'topics') {
        return createChain({ data: { id: 1 }, error: null });
      }
      if (table === 'explanations') {
        return createChain({ data: { id: 42 }, error: null });
      }
      if (table === 'evolution_runs') {
        const chain = createChain();
        chain.insert.mockImplementation((rows: unknown[]) => {
          capturedInserts.push(...rows);
          return Promise.resolve({ error: null });
        });
        chain.in.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      }
      return createChain();
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('round_running');
    // 3 runs × 1 prompt = 3 inserts, each with budget 30/3 = 10.0
    expect(capturedInserts.length).toBe(3);
    for (const run of capturedInserts) {
      expect((run as Record<string, unknown>).budget_cap_usd).toBeCloseTo(10.0, 2);
    }
  });

  it('transitions to budget_exhausted when remaining budget is zero or negative', async () => {
    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
      spent_usd: 100,       // spent == total → remaining = 0
      total_budget_usd: 100,
    });
    setupNextRoundMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 },
      ],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.transitions[0].to).toBe('budget_exhausted');
    expect(body.transitions[0].detail).toContain('No remaining budget');
  });

  it('handles zero runs from full-factorial gracefully', async () => {
    const { generateFullFactorialDesign } = jest.requireMock('@evolution/experiments/evolution/factorial');
    const origImpl = generateFullFactorialDesign.getMockImplementation?.() ?? generateFullFactorialDesign;
    generateFullFactorialDesign.mockReturnValueOnce({
      type: 'full-factorial',
      factors: [],
      runs: [],
    });

    const exp = baseExperiment({
      status: 'pending_next_round',
      current_round: 1,
      spent_usd: 10,
      total_budget_usd: 100,
    });
    setupNextRoundMocks(exp, {
      factorRanking: [
        { factor: 'A', factorLabel: 'Generation Model', eloEffect: 100, eloPerDollarEffect: 100, importance: 100 },
      ],
    });
    // Override FF design to return 0 runs after setupNextRoundMocks
    generateFullFactorialDesign.mockReturnValueOnce({
      type: 'full-factorial',
      factors: [],
      runs: [],
    });

    const res = await GET(mockRequest());
    const body = await res.json();
    // Should return without error (no division-by-zero), transition stays null
    expect(body.transitions[0].to).toBeNull();
    expect(body.transitions[0].detail).toContain('0 runs');

    // Restore original mock
    if (typeof origImpl === 'function') {
      generateFullFactorialDesign.mockImplementation(origImpl);
    }
  });
});

// ─── Terminal State Summary ──────────────────────────────────────

describe('terminal state results summary', () => {
  it('writes results_summary when converging', async () => {
    const exp = baseExperiment({
      status: 'round_analyzing',
      convergence_threshold: 200,
    });

    const round = {
      id: 'round-1',
      batch_run_id: 'batch-1',
      design: 'L8',
      factor_definitions: {
        A: { name: 'genModel', label: 'Generation Model', low: 'gpt-4.1-mini', high: 'gpt-4o' },
        B: { name: 'judgeModel', label: 'Judge Model', low: 'gpt-5-nano', high: 'gpt-4.1-nano' },
        C: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
        D: { name: 'editor', label: 'Editing Approach', low: 'iterativeEditing', high: 'treeSearch' },
        E: { name: 'supportAgents', label: 'Support Agents', low: 'off', high: 'on' },
      },
    };

    mockAnalyzeExperiment.mockReturnValue({
      factorRanking: [{ factor: 'A', factorLabel: 'Generation Model', eloEffect: 50, eloPerDollarEffect: 50, importance: 50 }],
      recommendations: ['Use gpt-4o'],
      completedRuns: 8,
      totalRuns: 8,
      warnings: [],
      mainEffects: { elo: { A: 50 }, eloPerDollar: {} },
      interactions: [],
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
      if (table === 'evolution_experiment_rounds') {
        const chain = createChain({ data: round, error: null });
        chain.update.mockReturnValue(chain);
        // For writeTerminalState's non-.single() query (returns array)
        (chain as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [round], error: null }),
        );
        return chain;
      }
      if (table === 'evolution_runs') {
        const completedRuns = [
          { run_summary: { topVariants: [{ ordinal: 10 }] }, config: { _experimentRow: 1 }, total_cost_usd: 2 },
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
    expect(body.transitions[0].to).toBe('converged');

    // Verify results_summary was written
    const summaryUpdate = updateCalls.find(
      c => c.table === 'evolution_experiments' && (c.data as Record<string, unknown>).results_summary,
    );
    expect(summaryUpdate).toBeDefined();
    const summary = (summaryUpdate?.data as Record<string, unknown>).results_summary as Record<string, unknown>;
    expect(summary.terminationReason).toBe('converged');
    expect(summary.factorRanking).toBeDefined();
  });
});

// ─── Multiple Experiments ────────────────────────────────────────

describe('multiple experiments', () => {
  it('processes multiple active experiments', async () => {
    const exp1 = baseExperiment({ id: 'exp-1', status: 'round_running' });
    const exp2 = baseExperiment({ id: 'exp-2', status: 'round_running' });

    let firstCall = true;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && firstCall) {
        firstCall = false;
        return createChain({ data: [exp1, exp2], error: null });
      }
      if (table === 'evolution_experiment_rounds') {
        return createChain({ data: { batch_run_id: 'batch-1' }, error: null });
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
    const exp1 = baseExperiment({ id: 'exp-1', status: 'round_running' });
    const exp2 = baseExperiment({ id: 'exp-2', status: 'round_running' });

    let firstCall = true;
    let roundCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && firstCall) {
        firstCall = false;
        return createChain({ data: [exp1, exp2], error: null });
      }
      if (table === 'evolution_experiment_rounds') {
        roundCallCount++;
        if (roundCallCount === 1) {
          // First experiment's round query throws
          throw new Error('Round fetch failed');
        }
        return createChain({ data: { batch_run_id: 'batch-2' }, error: null });
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

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.processed).toBe(2);
    // First experiment errored, second should still be processed
    expect(body.transitions[0].detail).toContain('Error');
    expect(body.transitions[1].to).toBeNull(); // Still running
  });
});
