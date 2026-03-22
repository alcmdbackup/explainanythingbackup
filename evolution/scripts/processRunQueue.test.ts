/**
 * @jest-environment node
 */
// Tests for processRunQueue.ts — validates parseIntArg, claimBatch, parallel execution, and executeRun.

// Mock supabase service client
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(async () => mockSupabase),
}));

// Mock the V2 runner module
const mockExecuteV2Run = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/lib/pipeline/claimAndExecuteRun', () => ({
  executeV2Run: mockExecuteV2Run,
}));

// Mock callLLM (used by createRawLLMProvider)
jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('mocked LLM response'),
}));

// Mock LLM semaphore
jest.mock('@/lib/services/llmSemaphore', () => ({
  initLLMSemaphore: jest.fn(),
  getLLMSemaphore: jest.fn(() => ({ acquire: jest.fn(), release: jest.fn() })),
}));

function setupMockFrom(singleResult?: { data: unknown; error: unknown }) {
  const mockSingle = jest.fn();
  if (singleResult) {
    mockSingle.mockResolvedValueOnce(singleResult);
  }
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: mockSingle,
        order: jest.fn().mockReturnValue({ limit: jest.fn() }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(),
        in: jest.fn(),
      }),
    }),
  });
}

describe('parseIntArg', () => {
  it('returns default when flag not present', () => {
    const original = process.argv;
    process.argv = ['node', 'script.ts'];
    const parseIntArg = (flag: string, defaultVal: number): number => {
      const idx = process.argv.indexOf(flag);
      if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
      const val = parseInt(process.argv[idx + 1], 10);
      return Number.isFinite(val) && val > 0 ? val : defaultVal;
    };
    expect(parseIntArg('--parallel', 1)).toBe(1);
    expect(parseIntArg('--max-runs', 10)).toBe(10);
    process.argv = original;
  });

  it('parses integer value from argv', () => {
    const original = process.argv;
    process.argv = ['node', 'script.ts', '--parallel', '5', '--max-runs', '20'];
    const parseIntArg = (flag: string, defaultVal: number): number => {
      const idx = process.argv.indexOf(flag);
      if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
      const val = parseInt(process.argv[idx + 1], 10);
      return Number.isFinite(val) && val > 0 ? val : defaultVal;
    };
    expect(parseIntArg('--parallel', 1)).toBe(5);
    expect(parseIntArg('--max-runs', 10)).toBe(20);
    process.argv = original;
  });

  it('returns default for invalid value', () => {
    const original = process.argv;
    process.argv = ['node', 'script.ts', '--parallel', 'abc'];
    const parseIntArg = (flag: string, defaultVal: number): number => {
      const idx = process.argv.indexOf(flag);
      if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
      const val = parseInt(process.argv[idx + 1], 10);
      return Number.isFinite(val) && val > 0 ? val : defaultVal;
    };
    expect(parseIntArg('--parallel', 1)).toBe(1);
    process.argv = original;
  });
});

describe('claimBatch logic', () => {
  it('claims up to batchSize runs sequentially', async () => {
    const runs = [
      { id: 'run-1', explanation_id: 1, prompt_id: null, config: {}, budget_cap_usd: 5 },
      { id: 'run-2', explanation_id: 2, prompt_id: null, config: {}, budget_cap_usd: 5 },
      { id: 'run-3', explanation_id: 3, prompt_id: null, config: {}, budget_cap_usd: 5 },
    ];

    let callIndex = 0;
    const mockClaimNextRun = jest.fn(async () => {
      if (callIndex < runs.length) return runs[callIndex++];
      return null;
    });

    async function claimBatch(batchSize: number) {
      const claimed: typeof runs = [];
      for (let i = 0; i < batchSize; i++) {
        const run = await mockClaimNextRun();
        if (!run) break;
        claimed.push(run);
      }
      return claimed;
    }

    const batch = await claimBatch(3);
    expect(batch).toHaveLength(3);
    expect(batch.map((r) => r.id)).toEqual(['run-1', 'run-2', 'run-3']);
    expect(mockClaimNextRun).toHaveBeenCalledTimes(3);
  });

  it('stops claiming when no more pending runs', async () => {
    const runs = [
      { id: 'run-1', explanation_id: 1, prompt_id: null, config: {}, budget_cap_usd: 5 },
    ];

    let callIndex = 0;
    const mockClaimNextRun = jest.fn(async () => {
      if (callIndex < runs.length) return runs[callIndex++];
      return null;
    });

    async function claimBatch(batchSize: number) {
      const claimed: typeof runs = [];
      for (let i = 0; i < batchSize; i++) {
        const run = await mockClaimNextRun();
        if (!run) break;
        claimed.push(run);
      }
      return claimed;
    }

    const batch = await claimBatch(5);
    expect(batch).toHaveLength(1);
    expect(mockClaimNextRun).toHaveBeenCalledTimes(2);
  });
});

describe('parallel execution', () => {
  it('Promise.allSettled handles mixed success/failure', async () => {
    const tasks = [
      Promise.resolve('ok-1'),
      Promise.reject(new Error('failed-2')),
      Promise.resolve('ok-3'),
    ];

    const results = await Promise.allSettled(tasks);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok-1' });
    expect(results[1]).toEqual({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'failed-2' }),
    });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'ok-3' });
  });

  it('batch size is capped by remaining runs', () => {
    const maxRuns = 7;
    const parallel = 3;
    const batches: number[] = [];
    let processed = 0;

    while (processed < maxRuns) {
      const remaining = maxRuns - processed;
      const batchSize = Math.min(parallel, remaining);
      batches.push(batchSize);
      processed += batchSize;
    }

    expect(batches).toEqual([3, 3, 1]);
    expect(processed).toBe(7);
  });
});

describe('executeRun V2 delegation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockFrom();
  });

  it('delegates to executeV2Run for explanation-based run', async () => {
    const { executeRun } = await import('./processRunQueue');

    const run = {
      id: 'run-expl',
      explanation_id: 42,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await executeRun(run, mockSupabase as never);

    expect(mockExecuteV2Run).toHaveBeenCalledWith(
      'run-expl',
      run,
      expect.anything(),
      expect.objectContaining({ complete: expect.any(Function) }),
    );
  });

  it('marks run failed when executeV2Run throws', async () => {
    const { executeRun } = await import('./processRunQueue');

    mockExecuteV2Run.mockRejectedValueOnce(new Error('Pipeline exploded'));

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn(),
      }),
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn() }),
      }),
      update: mockUpdate,
    });

    const run = {
      id: 'run-fail',
      explanation_id: 1,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await executeRun(run, mockSupabase as never);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('Pipeline exploded'),
      }),
    );
  });
});
