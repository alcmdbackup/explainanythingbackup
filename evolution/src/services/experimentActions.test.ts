// Unit tests for experiment server actions: validation, start, status, list, cancel.
// Tests server action wrappers with mocked Supabase and auth.

// ─── Supabase mock setup ─────────────────────────────────────────

const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockIs = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockIn = jest.fn();

// Chain builder: .from().insert().select().single() etc.
function chainMock() {
  const chain = {
    insert: mockInsert.mockReturnThis(),
    select: mockSelect.mockReturnThis(),
    single: mockSingle,
    update: mockUpdate.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    is: mockIs.mockReturnThis(),
    order: mockOrder.mockReturnThis(),
    limit: mockLimit.mockReturnThis(),
    in: mockIn.mockReturnThis(),
  };
  return chain;
}

const mockFrom = jest.fn().mockReturnValue(chainMock());

const mockRpc = jest.fn();

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

// Mock server dependencies before importing
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  serverReadRequestId: (fn: Function) => fn,
}));
jest.mock('@/lib/errorHandling', () => ({
  handleError: (err: Error, context: string) => ({
    message: err.message,
    context,
  }),
}));

jest.mock('@evolution/services/strategyResolution', () => ({
  resolveOrCreateStrategyFromRunConfig: jest.fn().mockResolvedValue({ id: 'strat-mock', isNew: true }),
}));

jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('## Executive Summary\nMock report text'),
}));

jest.mock('@evolution/lib/core/llmClient', () => ({
  EVOLUTION_SYSTEM_USERID: '00000000-0000-4000-8000-000000000001',
}));

jest.mock('@evolution/services/experimentReportPrompt', () => ({
  buildExperimentReportPrompt: jest.fn().mockReturnValue('mock prompt'),
  REPORT_MODEL: 'gpt-4.1-nano',
}));

const mockComputeRunMetrics = jest.fn();
const mockAggregateMetrics = jest.fn();
jest.mock('@evolution/experiments/evolution/experimentMetrics', () => ({
  computeRunMetrics: (...args: unknown[]) => mockComputeRunMetrics(...args),
  aggregateMetrics: (...args: unknown[]) => mockAggregateMetrics(...args),
}));

import {
  getExperimentStatusAction,
  listExperimentsAction,
  cancelExperimentAction,
  archiveExperimentAction,
  unarchiveExperimentAction,
  createManualExperimentAction,
  addRunToExperimentAction,
  startManualExperimentAction,
  deleteExperimentAction,
  getExperimentMetricsAction,
  getStrategyMetricsAction,
  getExperimentNameAction,
  getRunMetricsAction,
} from './experimentActions';
import { extractTopElo } from './experimentHelpers';
import { requireAdmin } from '@/lib/services/adminAuth';

// ─── Helpers ─────────────────────────────────────────────────────

/** Configure Supabase mock chain to return specific data per table. */
function setupSupabaseMock(config: {
  topics?: { id: number } | null;
  experiment?: { id: string } | null;
  explanation?: { id: number } | null;
  runsError?: string | null;
  promptRegistry?: { id: string; prompt: string }[] | null;
}) {
  let callCount = 0;
  mockFrom.mockImplementation((table: string) => {
    const chain = chainMock();
    if (table === 'evolution_arena_topics') {
      // resolvePromptId: .select().eq().is().single() → returns single row
      const prompts = config.promptRegistry ?? [{ id: 'uuid-1', prompt: 'Explain photosynthesis' }];
      const prompt = prompts.length > 0 ? prompts[0] : null;
      mockSingle.mockResolvedValue({ data: prompt, error: prompt ? null : { message: 'Not found' } });
      return chain;
    } else if (table === 'topics') {
      mockSingle.mockResolvedValue({ data: config.topics ?? { id: 1 }, error: null });
    } else if (table === 'evolution_experiments') {
      if (callCount === 0 || !config.experiment) {
        mockSingle.mockResolvedValue({ data: config.experiment ?? { id: 'exp-1' }, error: null });
      } else {
        // update call
        mockEq.mockResolvedValue({ error: null });
      }
      callCount++;
    } else if (table === 'explanations') {
      mockSingle.mockResolvedValue({ data: config.explanation ?? { id: 42 }, error: null });
    } else if (table === 'evolution_runs') {
      chain.insert = jest.fn().mockResolvedValue({ error: config.runsError ? { message: config.runsError } : null });
      return chain;
    }
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: all DB calls succeed
  setupSupabaseMock({});
});

// ─── Get Experiment Status Tests ─────────────────────────────────

describe('getExperimentStatusAction', () => {
  it('returns experiment with run counts', async () => {
    const mockExp = {
      id: 'exp-1', name: 'Test', status: 'running',
      optimization_target: 'elo', total_budget_usd: 50, spent_usd: 5,
      convergence_threshold: 10,
      factor_definitions: {}, prompt_id: 'prompt-uuid-1',
      evolution_arena_topics: { prompt: 'Explain photosynthesis' },
      results_summary: null,
      error_message: null, created_at: '2026-01-01',
      analysis_results: null,
    };
    const mockRuns = [
      { status: 'completed' }, { status: 'completed' }, { status: 'pending' },
    ];

    mockFrom.mockImplementation((table: string) => {
      const chain = chainMock();
      if (table === 'evolution_experiments') {
        mockSingle.mockResolvedValue({ data: mockExp, error: null });
      } else if (table === 'evolution_runs') {
        mockEq.mockResolvedValue({ data: mockRuns, error: null });
      }
      return chain;
    });

    const result = await getExperimentStatusAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Test');
    expect(result.data?.runCounts.completed).toBe(2);
    expect(result.data?.runCounts.pending).toBe(1);
    expect(result.data?.analysisResults).toBeNull();
    expect(result.data?.promptId).toBe('prompt-uuid-1');
    expect(result.data?.promptTitle).toBe('Explain photosynthesis');
  });

  it('handles missing experiment', async () => {
    mockFrom.mockImplementation(() => {
      const chain = chainMock();
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });
      return chain;
    });

    const result = await getExperimentStatusAction({ experimentId: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('not found');
  });
});

// ─── List Experiments Tests ──────────────────────────────────────

describe('listExperimentsAction', () => {
  it('returns list of experiment summaries', async () => {
    const mockRows = [
      { id: 'exp-1', name: 'A', status: 'running',
        total_budget_usd: 50, spent_usd: 10, created_at: '2026-01-01' },
      { id: 'exp-2', name: 'B', status: 'completed',
        total_budget_usd: 100, spent_usd: 80, created_at: '2026-01-02' },
    ];

    mockFrom.mockImplementation(() => {
      // Each method returns a fresh object that chains and eventually resolves
      const resolved = { data: mockRows, error: null };
      const obj = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve(resolved)),
      };
      return obj;
    });

    const result = await listExperimentsAction(undefined);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0].name).toBe('A');
  });

  it('supports status filter', async () => {
    // Supabase query builders are thenable — eq() is called after limit() for filtered queries
    const resolved = { data: [], error: null };
    const thenableChain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: jest.fn((resolve: (v: unknown) => void) => resolve(resolved)),
    };
    mockFrom.mockImplementation(() => thenableChain);

    const result = await listExperimentsAction({ status: 'completed' });
    expect(result.success).toBe(true);
    expect(thenableChain.eq).toHaveBeenCalledWith('status', 'completed');
  });
});

// ─── Cancel Experiment Tests ─────────────────────────────────────

describe('cancelExperimentAction', () => {
  it('cancels a running experiment', async () => {
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments' && callNum === 0) {
        // First call: SELECT to check status
        callNum++;
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'exp-1', status: 'running' }, error: null }),
        };
      }
      if (table === 'evolution_experiments') {
        // Second call: UPDATE status
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'evolution_runs') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return chainMock();
    });

    const result = await cancelExperimentAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(true);
    expect(result.data?.cancelled).toBe(true);
  });

  it('rejects cancellation of terminal experiment', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'exp-1', status: 'completed' }, error: null }),
    }));

    const result = await cancelExperimentAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('terminal state');
  });
});

// ─── extractTopElo Tests ─────────────────────────────────────────

describe('extractTopElo', () => {
  it('returns null for null run_summary', () => {
    expect(extractTopElo(null)).toBeNull();
  });

  it('returns null for empty topVariants', () => {
    expect(extractTopElo({ topVariants: [] })).toBeNull();
  });

  it('returns null for missing topVariants', () => {
    expect(extractTopElo({})).toBeNull();
  });

  it('extracts elo from mu path (V2)', () => {
    const result = extractTopElo({ topVariants: [{ mu: 25 }] });
    // toEloScale(25) = 800 + 25 * 16 = 1200
    expect(result).toBe(1200);
  });

  it('extracts elo from V2 ordinal path using old formula', () => {
    const result = extractTopElo({ topVariants: [{ ordinal: 0 }] });
    // V2 legacy: 1200 + 0 * 16 = 1200
    expect(result).toBe(1200);
  });

  it('extracts elo from elo path (V1)', () => {
    const result = extractTopElo({ topVariants: [{ elo: 1350 }] });
    expect(result).toBe(1350);
  });

  it('prefers mu over elo when both present', () => {
    const result = extractTopElo({ topVariants: [{ mu: 25, elo: 999 }] });
    expect(result).toBe(1200); // mu path takes precedence
  });
});

// ─── Manual Experiment Actions Tests ────────────────────────────

describe('createManualExperimentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('creates a manual experiment with design=manual', async () => {
    let insertedData: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_arena_topics') {
        // resolvePromptId (singular) — .select().eq().is().single()
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'p1', prompt: 'Test prompt' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'evolution_explanations') {
        // evolution_explanation insert for the experiment's prompt
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'evo-expl-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'evolution_experiments') {
        return {
          insert: jest.fn().mockImplementation((data: Record<string, unknown>) => {
            insertedData = data;
            return {
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'exp-manual-1' },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
      return chainMock();
    });

    const result = await createManualExperimentAction({
      name: 'Manual Test',
      promptId: 'p1',
    });

    expect(result.success).toBe(true);
    expect(result.data?.experimentId).toBe('exp-manual-1');
    expect(insertedData).toEqual(
      expect.objectContaining({
        name: 'Manual Test',
        design: 'manual',
        factor_definitions: {},
        status: 'pending',
      }),
    );
  });

  it('fails with empty name', async () => {
    const result = await createManualExperimentAction({
      name: '',
      promptId: 'p1',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('name is required');
  });

  it('fails with no prompt', async () => {
    const result = await createManualExperimentAction({
      name: 'Test',
      promptId: '',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('prompt');
  });
});

describe('addRunToExperimentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('rejects budget above MAX_RUN_BUDGET_USD', async () => {
    const result = await addRunToExperimentAction({
      experimentId: 'exp-1',
      config: {
        generationModel: 'gpt-4o',
        judgeModel: 'gpt-4.1-nano',
        budgetCapUsd: 5.00, // exceeds $1.00 cap
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('$1.00');
  });

  it('rejects budget below $0.01', async () => {
    const result = await addRunToExperimentAction({
      experimentId: 'exp-1',
      config: {
        generationModel: 'gpt-4o',
        judgeModel: 'gpt-4.1-nano',
        budgetCapUsd: 0.001,
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('$0.01');
  });

  it('rejects adding run to completed experiment', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'exp-1', status: 'completed', total_budget_usd: 5, prompts: ['p1'] },
                error: null,
              }),
            }),
          }),
        };
      }
      return chainMock();
    });

    const result = await addRunToExperimentAction({
      experimentId: 'exp-1',
      config: {
        generationModel: 'gpt-4o',
        judgeModel: 'gpt-4.1-nano',
        budgetCapUsd: 0.50,
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('completed');
  });
});

describe('startManualExperimentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('rejects experiment with no runs', async () => {
    // Build self-contained chains for each .from() call
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_experiments') {
        // .select().eq().single()
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'exp-1', status: 'pending' },
                error: null,
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'evolution_runs') {
        // .select('id', { count, head }).eq() — awaited directly
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        };
      }
      return chainMock();
    });

    const result = await startManualExperimentAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('0 runs');
  });
});

describe('deleteExperimentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('rejects deletion of non-pending experiment', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'exp-1', status: 'running' },
            error: null,
          }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    }));

    const result = await deleteExperimentAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('pending');
  });
});

// ─── Experiment Metrics Action Tests ────────────────────────────

describe('getExperimentMetricsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
    mockComputeRunMetrics.mockResolvedValue({
      metrics: { maxElo: { value: 1500, sigma: null, ci: null, n: 1 }, cost: { value: 1.5, sigma: null, ci: null, n: 1 } },
      variantRatings: [{ mu: 25, sigma: 5 }],
    });
  });

  it('returns ExperimentMetricsResult shape', async () => {
    const mockRuns = [
      { id: 'run-1', status: 'completed', total_cost_usd: 1.5, run_summary: null, config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4.1-nano' }, strategy_config_id: 's1' },
      { id: 'run-2', status: 'failed', total_cost_usd: 0, run_summary: null, config: {}, strategy_config_id: null },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_runs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: mockRuns, error: null }),
        };
      }
      return chainMock();
    });

    const result = await getExperimentMetricsAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(true);
    expect(result.data?.runs).toHaveLength(2);
    expect(result.data?.completedRuns).toBe(1);
    expect(result.data?.totalRuns).toBe(2);
    expect(result.data?.runs[0].metrics.maxElo?.value).toBe(1500);
    expect(result.data?.runs[1].metrics).toEqual({}); // failed run has empty metrics
    expect(result.data?.warnings).toContain('1 of 2 runs incomplete');
  });
});

// ─── Strategy Metrics Action Tests ──────────────────────────────

describe('getStrategyMetricsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
    mockComputeRunMetrics.mockResolvedValue({
      metrics: { maxElo: { value: 1500, sigma: null, ci: null, n: 1 } },
      variantRatings: [{ mu: 25, sigma: 5 }],
    });
    mockAggregateMetrics.mockReturnValue({
      maxElo: { value: 1490, sigma: null, ci: [1450, 1530], n: 3 },
    });
  });

  it('returns StrategyMetricsResult with aggregate CIs', async () => {
    const mockRuns = [
      { id: 'r1', status: 'completed', config: { generationModel: 'gpt-4o' } },
      { id: 'r2', status: 'completed', config: { generationModel: 'gpt-4o' } },
      { id: 'r3', status: 'failed', config: {} },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'evolution_runs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: mockRuns, error: null }),
        };
      }
      return chainMock();
    });

    const result = await getStrategyMetricsAction({ strategyConfigId: 'strat-1' });
    expect(result.success).toBe(true);
    expect(result.data?.runs).toHaveLength(2); // only completed
    expect(result.data?.aggregate.maxElo?.ci).toEqual([1450, 1530]);
    expect(mockAggregateMetrics).toHaveBeenCalledTimes(1);
  });
});

// ─── Experiment Name Action Tests ───────────────────────────────

describe('getExperimentNameAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('returns experiment name for valid ID', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { name: 'My Experiment' },
            error: null,
          }),
        }),
      }),
    }));

    const result = await getExperimentNameAction('11111111-1111-1111-1111-111111111111');
    expect(result.success).toBe(true);
    expect(result.data).toBe('My Experiment');
  });

  it('rejects invalid UUID format', async () => {
    const result = await getExperimentNameAction('bad-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid');
  });

  it('returns error when experiment not found', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'not found' },
          }),
        }),
      }),
    }));

    const result = await getExperimentNameAction('11111111-1111-1111-1111-111111111111');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('not found');
  });
});

// ─── Archive / Unarchive Experiment Tests ────────────────────────

describe('archiveExperimentAction', () => {
  it('calls archive_experiment RPC', async () => {
    mockRpc.mockResolvedValue({ error: null });

    const result = await archiveExperimentAction({ experimentId: '11111111-1111-1111-1111-111111111111' });
    expect(result.success).toBe(true);
    expect(result.data?.archived).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('archive_experiment', { p_experiment_id: '11111111-1111-1111-1111-111111111111' });
  });

  it('returns error on RPC failure', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'Only terminal experiments can be archived' } });

    const result = await archiveExperimentAction({ experimentId: '11111111-1111-1111-1111-111111111111' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Failed to archive');
  });

  it('rejects invalid UUID', async () => {
    const result = await archiveExperimentAction({ experimentId: 'not-a-uuid' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid');
  });
});

describe('unarchiveExperimentAction', () => {
  it('calls unarchive_experiment RPC', async () => {
    mockRpc.mockResolvedValue({ error: null });

    const result = await unarchiveExperimentAction({ experimentId: '11111111-1111-1111-1111-111111111111' });
    expect(result.success).toBe(true);
    expect(result.data?.unarchived).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('unarchive_experiment', { p_experiment_id: '11111111-1111-1111-1111-111111111111' });
  });

  it('returns error on RPC failure', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'Experiment is not archived' } });

    const result = await unarchiveExperimentAction({ experimentId: '11111111-1111-1111-1111-111111111111' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Failed to unarchive');
  });
});

// ─── getRunMetricsAction ──────────────────────────────────────────

describe('getRunMetricsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(chainMock());
  });

  it('wraps computeRunMetrics and extracts agent breakdown', async () => {
    mockComputeRunMetrics.mockResolvedValue({
      metrics: {
        totalVariants: { value: 8, sigma: null, ci: null, n: 8 },
        medianElo: { value: 1100, sigma: 20, ci: [1061, 1139], n: 8 },
        'agentCost:generation': { value: 0.25, sigma: null, ci: null, n: 6 },
        'agentCost:calibration': { value: 0.10, sigma: null, ci: null, n: 3 },
      },
      variantRatings: null,
    });

    const result = await getRunMetricsAction('11111111-1111-1111-1111-111111111111');

    expect(result.success).toBe(true);
    expect(result.data!.metrics.totalVariants!.value).toBe(8);
    expect(result.data!.agentBreakdown).toHaveLength(2);
    // Sorted by cost desc
    expect(result.data!.agentBreakdown[0]).toEqual({ agent: 'generation', costUsd: 0.25, calls: 6 });
    expect(result.data!.agentBreakdown[1]).toEqual({ agent: 'calibration', costUsd: 0.10, calls: 3 });
  });

  it('rejects invalid runId', async () => {
    const result = await getRunMetricsAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid runId');
  });

  it('returns error when computeRunMetrics throws', async () => {
    mockComputeRunMetrics.mockRejectedValue(new Error('DB timeout'));

    const result = await getRunMetricsAction('11111111-1111-1111-1111-111111111111');
    expect(result.success).toBe(false);
  });
});

// ─── renameExperimentAction ────────────────────────────────────

describe('renameExperimentAction', () => {
  let renameExperimentAction: typeof import('./experimentActions').renameExperimentAction;

  beforeAll(async () => {
    const mod = await import('./experimentActions');
    renameExperimentAction = mod.renameExperimentAction;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renames experiment with valid input', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: '11111111-1111-1111-1111-111111111111', name: 'New Name' },
      error: null,
    });

    const result = await renameExperimentAction({
      experimentId: '11111111-1111-1111-1111-111111111111',
      name: 'New Name',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: '11111111-1111-1111-1111-111111111111', name: 'New Name' });
  });

  it('rejects empty name after trim', async () => {
    const result = await renameExperimentAction({
      experimentId: '11111111-1111-1111-1111-111111111111',
      name: '   ',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('empty');
  });

  it('rejects invalid UUID', async () => {
    const result = await renameExperimentAction({
      experimentId: 'not-a-uuid',
      name: 'Valid Name',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid');
  });

  it('returns error when experiment not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'No rows returned' } });

    const result = await renameExperimentAction({
      experimentId: '11111111-1111-1111-1111-111111111111',
      name: 'New Name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-admin users', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth') as { requireAdmin: jest.Mock };
    requireAdmin.mockRejectedValueOnce(new Error('Unauthorized'));

    const result = await renameExperimentAction({
      experimentId: '11111111-1111-1111-1111-111111111111',
      name: 'New Name',
    });
    expect(result.success).toBe(false);
  });
});
