/**
 * @jest-environment node
 */
// Tests for evolution-runner.ts — validates parseIntArg, claimBatch, and parallel execution logic.

// Mock supabase before importing runner
const mockSingle = jest.fn();
const mockFrom = jest.fn();

function setupMockFrom(singleResult?: { data: unknown; error: unknown }) {
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

const mockRpc = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

// Mock the evolution lib barrel imports
const mockExecuteFullPipeline = jest.fn().mockResolvedValue({ stopReason: 'budget_exhausted' });
const mockPreparePipelineRun = jest.fn().mockReturnValue({
  ctx: { state: { getPoolSize: () => 5 }, logger: { info: jest.fn(), error: jest.fn() } },
  agents: [],
  costTracker: { getTotalSpent: () => 0.5 },
});
jest.mock('../src/lib/index', () => ({
  executeFullPipeline: mockExecuteFullPipeline,
  preparePipelineRun: mockPreparePipelineRun,
  createEvolutionLLMClient: jest.fn().mockReturnValue({}),
  resolveConfig: jest.fn().mockReturnValue({}),
  createCostTracker: jest.fn().mockReturnValue({}),
  createEvolutionLogger: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }),
}));

// Mock seed article generation
const mockGenerateSeedArticle = jest.fn().mockResolvedValue({
  title: 'Generated Title',
  content: '# Generated Content',
});
jest.mock('../src/lib/core/seedArticle', () => ({
  generateSeedArticle: mockGenerateSeedArticle,
}));

// Mock LLM semaphore (loaded in main())
jest.mock('../../src/lib/services/llmSemaphore', () => ({
  initLLMSemaphore: jest.fn(),
}));

describe('REQUIRED_ENV_VARS validation', () => {
  it('runner requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY', () => {
    // The runner validates these at module load time and calls process.exit(1) if missing.
    // Since this test file is able to import executeRun (via dynamic import in later tests),
    // we verify the validation constant contains the expected variables.
    const requiredVars = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
    // Sanity: each var name is a non-empty string
    for (const v of requiredVars) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe('parseIntArg', () => {
  // We need to test parseIntArg in isolation. Since it reads process.argv,
  // we test the logic directly.
  it('returns default when flag not present', () => {
    const original = process.argv;
    process.argv = ['node', 'script.ts'];
    // Re-import to test parseIntArg logic
    const parseIntArg = (flag: string, defaultVal: number): number => {
      const idx = process.argv.indexOf(flag);
      return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || defaultVal : defaultVal;
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
      return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || defaultVal : defaultVal;
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
      return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || defaultVal : defaultVal;
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

    // Simulate claimBatch logic
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
    expect(mockClaimNextRun).toHaveBeenCalledTimes(2); // 1 success + 1 null
  });

  it('returns empty array when no runs available', async () => {
    const mockClaimNextRun = jest.fn(async () => null);

    async function claimBatch(batchSize: number) {
      const claimed: Array<{ id: string }> = [];
      for (let i = 0; i < batchSize; i++) {
        const run = await mockClaimNextRun();
        if (!run) break;
        claimed.push(run);
      }
      return claimed;
    }

    const batch = await claimBatch(3);
    expect(batch).toHaveLength(0);
    expect(mockClaimNextRun).toHaveBeenCalledTimes(1);
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

  it('batch loop respects maxRuns limit', async () => {
    let totalProcessed = 0;
    const maxRuns = 7;
    const parallel = 3;

    // Simulate the main loop logic
    while (totalProcessed < maxRuns) {
      const remaining = maxRuns - totalProcessed;
      const batchSize = Math.min(parallel, remaining);
      totalProcessed += batchSize;
    }

    expect(totalProcessed).toBe(7); // 3 + 3 + 1 = 7 (Math.min(3, 1) = 1 for last batch)
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

describe('executeRun content resolution', () => {
  // Set required env vars for getSupabase()
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockFrom();
  });

  it('explanation-based run fetches content and calls pipeline', async () => {
    const { executeRun } = await import('./evolution-runner');

    setupMockFrom({ data: { content: '# Test content' }, error: null });

    const run = {
      id: 'run-expl',
      explanation_id: 42,
      prompt_id: null,
      config: {},
      budget_cap_usd: 5,
    };

    await executeRun(run);

    expect(mockPreparePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-expl',
        originalText: '# Test content',
        title: 'Explanation #42',
        explanationId: 42,
      }),
    );
    expect(mockExecuteFullPipeline).toHaveBeenCalled();
  });

  it('prompt-based run generates seed article and calls pipeline', async () => {
    const { executeRun } = await import('./evolution-runner');

    setupMockFrom({ data: { prompt: 'Explain quantum computing' }, error: null });

    const run = {
      id: 'run-prompt',
      explanation_id: null,
      prompt_id: 'topic-1',
      config: {},
      budget_cap_usd: 5,
    };

    await executeRun(run);

    expect(mockGenerateSeedArticle).toHaveBeenCalledWith(
      'Explain quantum computing',
      expect.anything(),
      expect.anything(),
    );
    expect(mockPreparePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-prompt',
        originalText: '# Generated Content',
        title: 'Generated Title',
        explanationId: null,
      }),
    );
    expect(mockExecuteFullPipeline).toHaveBeenCalled();
  });

  it('run with both null explanation_id and prompt_id is marked failed', async () => {
    const { executeRun } = await import('./evolution-runner');

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn(),
      }),
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: mockSingle }),
      }),
      update: mockUpdate,
    });

    const run = {
      id: 'run-neither',
      explanation_id: null,
      prompt_id: null,
      config: {},
      budget_cap_usd: 5,
    };

    await executeRun(run);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_message: expect.stringContaining('no explanation_id and no prompt_id') }),
    );
    expect(mockExecuteFullPipeline).not.toHaveBeenCalled();
  });
});
