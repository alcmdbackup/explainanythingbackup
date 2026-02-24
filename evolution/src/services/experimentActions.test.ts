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

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
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

import {
  validateExperimentConfigAction,
  startExperimentAction,
  getExperimentStatusAction,
  listExperimentsAction,
  cancelExperimentAction,
  getFactorMetadataAction,
} from './experimentActions';
import type { ValidateExperimentInput, StartExperimentInput } from './experimentActions';
import { requireAdmin } from '@/lib/services/adminAuth';

// ─── Helpers ─────────────────────────────────────────────────────

function validInput(): ValidateExperimentInput {
  return {
    factors: {
      genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' },
      iterations: { low: 5, high: 15 },
      supportAgents: { low: 'off', high: 'on' },
    },
    promptIds: ['uuid-1'],
  };
}

function validStartInput(): StartExperimentInput {
  return {
    name: 'Test Experiment',
    factors: {
      genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' },
      iterations: { low: 5, high: 15 },
      supportAgents: { low: 'off', high: 'on' },
    },
    promptIds: ['uuid-1'],
    budget: 50,
  };
}

/** Configure Supabase mock chain to return specific data per table. */
function setupSupabaseMock(config: {
  topics?: { id: number } | null;
  experiment?: { id: string } | null;
  batch?: { id: string } | null;
  explanation?: { id: number } | null;
  roundError?: string | null;
  runsError?: string | null;
  promptRegistry?: { id: string; prompt: string }[] | null;
}) {
  let callCount = 0;
  mockFrom.mockImplementation((table: string) => {
    const chain = chainMock();
    if (table === 'evolution_hall_of_fame_topics') {
      // resolvePromptIds: .select().in().is() → returns array
      const prompts = config.promptRegistry ?? [{ id: 'uuid-1', prompt: 'Explain photosynthesis' }];
      mockIs.mockResolvedValue({ data: prompts, error: null });
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
    } else if (table === 'evolution_batch_runs') {
      mockSingle.mockResolvedValue({ data: config.batch ?? { id: 'batch-1' }, error: null });
    } else if (table === 'evolution_experiment_rounds') {
      chain.insert = jest.fn().mockResolvedValue({ error: config.roundError ? { message: config.roundError } : null });
      return chain;
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

// ─── Validate Tests ──────────────────────────────────────────────

describe('validateExperimentConfigAction', () => {
  it('returns valid result for good input', async () => {
    const result = await validateExperimentConfigAction(validInput());
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(true);
    expect(result.data?.errors).toEqual([]);
    expect(result.data?.expandedRunCount).toBe(8);
    expect(result.data?.estimatedCost).toBeGreaterThan(0);
  });

  it('returns validation errors for bad input', async () => {
    const input = validInput();
    input.factors = { genModel: { low: 'bad-model', high: 'gpt-4o' } };
    const result = await validateExperimentConfigAction(input);
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(false);
    expect(result.data?.errors.length).toBeGreaterThan(0);
  });

  it('returns warnings for identical low/high', async () => {
    const input = validInput();
    input.factors.genModel = { low: 'gpt-4o', high: 'gpt-4o' };
    const result = await validateExperimentConfigAction(input);
    expect(result.data?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('identical low/high')]),
    );
  });

  it('requires admin authentication', async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('Not authorized'));
    const result = await validateExperimentConfigAction(validInput());
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Not authorized');
  });

  it('passes configDefaults through to validation', async () => {
    const input = validInput();
    input.configDefaults = { budgetCapUsd: 50 };
    const result = await validateExperimentConfigAction(input);
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(true);
  });

  it('fails when prompt ID not found in registry', async () => {
    setupSupabaseMock({ promptRegistry: [] });
    const input = validInput();
    input.promptIds = ['nonexistent-id'];
    const result = await validateExperimentConfigAction(input);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('not found');
  });
});

// ─── Start Experiment Tests ──────────────────────────────────────

describe('startExperimentAction', () => {
  it('returns experimentId on success', async () => {
    setupSupabaseMock({ experiment: { id: 'exp-abc' } });
    const result = await startExperimentAction(validStartInput());
    expect(result.success).toBe(true);
    expect(result.data?.experimentId).toBe('exp-abc');
  });

  it('calls requireAdmin', async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('Forbidden'));
    const result = await startExperimentAction(validStartInput());
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Forbidden');
  });

  it('rejects invalid experiment config', async () => {
    const input = validStartInput();
    input.factors = { genModel: { low: 'bad-model', high: 'gpt-4o' } };
    const result = await startExperimentAction(input);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid experiment config');
  });

  it('creates experiment, batch, round, and runs in order', async () => {
    const tablesAccessed: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      tablesAccessed.push(table);
      const chain = chainMock();
      if (table === 'evolution_hall_of_fame_topics') {
        mockIs.mockResolvedValue({ data: [{ id: 'uuid-1', prompt: 'Explain photosynthesis' }], error: null });
        return chain;
      }
      if (table === 'evolution_experiment_rounds') {
        chain.insert = jest.fn().mockResolvedValue({ error: null });
        return chain;
      }
      if (table === 'evolution_runs') {
        chain.insert = jest.fn().mockResolvedValue({ error: null });
        return chain;
      }
      mockSingle.mockResolvedValue({ data: { id: `mock-${table}` }, error: null });
      return chain;
    });

    await startExperimentAction(validStartInput());

    // Verify tables accessed in correct order
    expect(tablesAccessed).toContain('evolution_experiments');
    expect(tablesAccessed).toContain('evolution_batch_runs');
    expect(tablesAccessed).toContain('evolution_experiment_rounds');
    expect(tablesAccessed).toContain('evolution_runs');
    expect(tablesAccessed).toContain('explanations');

    // Experiment should be created before batch and round
    const expIdx = tablesAccessed.indexOf('evolution_experiments');
    const batchIdx = tablesAccessed.indexOf('evolution_batch_runs');
    const roundIdx = tablesAccessed.indexOf('evolution_experiment_rounds');
    expect(expIdx).toBeLessThan(batchIdx);
    expect(batchIdx).toBeLessThan(roundIdx);
  });

  it('applies optional target and maxRounds', async () => {
    setupSupabaseMock({});
    const input = validStartInput();
    input.target = 'elo_per_dollar';
    input.maxRounds = 3;
    const result = await startExperimentAction(input);
    expect(result.success).toBe(true);
  });
});

// ─── Get Experiment Status Tests ─────────────────────────────────

describe('getExperimentStatusAction', () => {
  it('returns experiment with rounds and run counts', async () => {
    const mockExp = {
      id: 'exp-1', name: 'Test', status: 'round_running',
      optimization_target: 'elo', total_budget_usd: 50, spent_usd: 5,
      max_rounds: 5, current_round: 1, convergence_threshold: 10,
      factor_definitions: {}, prompts: ['p1'], results_summary: null,
      error_message: null, created_at: '2026-01-01',
    };
    const mockRounds = [
      { round_number: 1, type: 'screening', design: 'L8', status: 'running',
        batch_run_id: 'batch-1', analysis_results: null, completed_at: null },
    ];
    const mockRuns = [
      { status: 'completed' }, { status: 'completed' }, { status: 'pending' },
    ];

    mockFrom.mockImplementation((table: string) => {
      const chain = chainMock();
      if (table === 'evolution_experiments') {
        mockSingle.mockResolvedValue({ data: mockExp, error: null });
      } else if (table === 'evolution_experiment_rounds') {
        mockOrder.mockReturnValue({ data: mockRounds, error: null });
      } else if (table === 'evolution_runs') {
        mockEq.mockResolvedValue({ data: mockRuns, error: null });
      }
      return chain;
    });

    const result = await getExperimentStatusAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Test');
    expect(result.data?.rounds).toHaveLength(1);
    expect(result.data?.rounds[0].runCounts.completed).toBe(2);
    expect(result.data?.rounds[0].runCounts.pending).toBe(1);
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
      { id: 'exp-1', name: 'A', status: 'running', current_round: 1,
        max_rounds: 5, total_budget_usd: 50, spent_usd: 10, created_at: '2026-01-01' },
      { id: 'exp-2', name: 'B', status: 'converged', current_round: 3,
        max_rounds: 5, total_budget_usd: 100, spent_usd: 80, created_at: '2026-01-02' },
    ];

    mockFrom.mockImplementation(() => {
      // Each method returns a fresh object that chains and eventually resolves
      const obj = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
        eq: jest.fn().mockReturnThis(),
      };
      return obj;
    });

    const result = await listExperimentsAction();
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

    const result = await listExperimentsAction({ status: 'converged' });
    expect(result.success).toBe(true);
    expect(thenableChain.eq).toHaveBeenCalledWith('status', 'converged');
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
          single: jest.fn().mockResolvedValue({ data: { id: 'exp-1', status: 'round_running' }, error: null }),
        };
      }
      if (table === 'evolution_experiments') {
        // Second call: UPDATE status
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'evolution_experiment_rounds') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [{ batch_run_id: 'batch-1' }], error: null }),
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
      single: jest.fn().mockResolvedValue({ data: { id: 'exp-1', status: 'converged' }, error: null }),
    }));

    const result = await cancelExperimentAction({ experimentId: 'exp-1' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('terminal state');
  });
});

// ─── Get Factor Metadata Tests ──────────────────────────────────

describe('getFactorMetadataAction', () => {
  it('returns factor metadata from registry', async () => {
    const result = await getFactorMetadataAction();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBeGreaterThanOrEqual(5);

    const genModel = result.data!.find(f => f.key === 'genModel');
    expect(genModel).toBeDefined();
    expect(genModel!.label).toBe('Generation Model');
    expect(genModel!.type).toBe('model');
    expect(genModel!.validValues.length).toBeGreaterThan(0);
  });

  it('includes all expected factor keys', async () => {
    const result = await getFactorMetadataAction();
    const keys = result.data!.map(f => f.key);
    expect(keys).toEqual(expect.arrayContaining(['genModel', 'judgeModel', 'iterations', 'supportAgents', 'editor']));
  });

  it('requires admin authentication', async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('Not authorized'));
    const result = await getFactorMetadataAction();
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Not authorized');
  });
});
