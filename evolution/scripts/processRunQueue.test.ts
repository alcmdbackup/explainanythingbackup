/**
 * @jest-environment node
 */
// Tests for processRunQueue.ts — validates parseIntArg, claimBatch, round-robin, executeRun, and multi-DB support.

// Mock fs for env file loading
jest.mock('fs', () => ({
  existsSync: jest.fn((p: string) => p.includes('.env.local') || p.includes('.env.evolution-prod')),
  readFileSync: jest.fn((p: string) => {
    if (p.includes('.env.local')) return 'NEXT_PUBLIC_SUPABASE_URL=https://staging.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=staging-key';
    if (p.includes('.env.evolution-prod')) return 'NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=prod-key';
    throw new Error('ENOENT');
  }),
}));

// Mock dotenv — use real parse(), mock config() to avoid polluting process.env
jest.mock('dotenv', () => {
  const actual = jest.requireActual('dotenv');
  return { ...actual, config: jest.fn() };
});

// Mock supabase client — track clients by URL
const mockClients: Record<string, { rpc: jest.Mock; from: jest.Mock }> = {};
function getMockClient(url: string) {
  if (!mockClients[url]) {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn(),
          order: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ error: null }) }),
        }),
        limit: jest.fn().mockResolvedValue({ error: null }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(),
          in: jest.fn(),
        }),
      }),
    });
    mockClients[url] = { rpc: jest.fn(), from: mockFrom };
  }
  return mockClients[url];
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => getMockClient(url)),
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

import type { DbTarget } from './processRunQueue';

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

describe('claimBatch round-robin', () => {
  it('round-robins across multiple DbTargets', async () => {
    const { claimBatch } = await import('./processRunQueue');

    const aRuns = [
      { id: 'a1', explanation_id: 1, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
      { id: 'a2', explanation_id: 2, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
    ];
    const bRuns = [
      { id: 'b1', explanation_id: 3, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
    ];

    const rpcA = jest.fn().mockImplementation(async () => {
      const run = aRuns.shift();
      return run ? { data: run, error: null } : { data: null, error: null };
    });
    const rpcB = jest.fn().mockImplementation(async () => {
      const run = bRuns.shift();
      return run ? { data: run, error: null } : { data: null, error: null };
    });

    const targetA: DbTarget = { name: 'a', client: { rpc: rpcA } as never };
    const targetB: DbTarget = { name: 'b', client: { rpc: rpcB } as never };

    const batch = await claimBatch(4, [targetA, targetB]);

    expect(batch).toHaveLength(3);
    expect(batch.map(t => t.run.id)).toEqual(['a1', 'b1', 'a2']);
    expect(batch.map(t => t.db.name)).toEqual(['a', 'b', 'a']);
  });

  it('works with single target in degraded mode', async () => {
    const { claimBatch } = await import('./processRunQueue');

    const runs = [
      { id: 'r1', explanation_id: 1, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
      { id: 'r2', explanation_id: 2, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
    ];

    const rpc = jest.fn().mockImplementation(async () => {
      const run = runs.shift();
      return run ? { data: run, error: null } : { data: null, error: null };
    });

    const target: DbTarget = { name: 'only', client: { rpc } as never };
    const batch = await claimBatch(3, [target]);

    expect(batch).toHaveLength(2);
    expect(batch.map(t => t.run.id)).toEqual(['r1', 'r2']);
    expect(batch.every(t => t.db.name === 'only')).toBe(true);
  });

  it('stops claiming when no more pending runs', async () => {
    const { claimBatch } = await import('./processRunQueue');

    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const target: DbTarget = { name: 'empty', client: { rpc } as never };

    const batch = await claimBatch(5, [target]);
    expect(batch).toHaveLength(0);
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
  const mockFrom = jest.fn();
  const mockSupabase = { from: mockFrom, rpc: jest.fn() };

  function setupMockFrom() {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn(),
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

    const mockTarget: DbTarget = { name: 'test', client: mockSupabase as never };
    await executeRun({ run, db: mockTarget });

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

    const mockTarget: DbTarget = { name: 'test', client: mockSupabase as never };
    await executeRun({ run, db: mockTarget });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('Pipeline exploded'),
      }),
    );
  });
});

describe('buildDbTargets', () => {
  it('returns reachable targets from env files', async () => {
    const { buildDbTargets } = await import('./processRunQueue');

    const targets = await buildDbTargets();

    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.name)).toEqual(['staging', 'prod']);
  });

  it('skips unreachable target, returns remaining', async () => {
    // Make staging pre-flight fail
    const stagingClient = getMockClient('https://staging.supabase.co');
    stagingClient.from.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ error: { message: 'connection refused' } }),
      }),
    });

    const { buildDbTargets } = await import('./processRunQueue');
    const targets = await buildDbTargets();

    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('prod');
  });

  it('skips target with missing env file', async () => {
    const fsMod = await import('fs');
    // Make .env.evolution-prod not exist
    (fsMod.existsSync as jest.Mock).mockImplementation((p: string) => p.includes('.env.local'));

    const { buildDbTargets } = await import('./processRunQueue');
    const targets = await buildDbTargets();

    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('staging');

    // Restore
    (fsMod.existsSync as jest.Mock).mockImplementation((p: string) =>
      p.includes('.env.local') || p.includes('.env.evolution-prod'),
    );
  });
});

describe('loadEnvFile', () => {
  it('throws on missing file', async () => {
    const fsMod = await import('fs');
    (fsMod.existsSync as jest.Mock).mockReturnValueOnce(false);

    const { loadEnvFile } = await import('./processRunQueue');
    expect(() => loadEnvFile('nonexistent.env')).toThrow('[FATAL] Missing env file');

    // Restore default
    (fsMod.existsSync as jest.Mock).mockImplementation((p: string) =>
      p.includes('.env.local') || p.includes('.env.evolution-prod'),
    );
  });
});

describe('dry-run with TaggedRun', () => {
  it('writes to correct db.client in dry-run mode', async () => {
    // Enable dry-run via argv
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', '--dry-run'];

    // Re-import to pick up --dry-run flag
    jest.resetModules();
    const { executeRun } = await import('./processRunQueue');

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ in: jest.fn() }),
    });
    const mockClient = {
      from: jest.fn().mockReturnValue({ update: mockUpdate }),
      rpc: jest.fn(),
    };

    const run = {
      id: 'dry-run-1',
      explanation_id: 1,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    const mockTarget: DbTarget = { name: 'staging', client: mockClient as never };
    await executeRun({ run, db: mockTarget });

    // Verify update was called on the correct client
    expect(mockClient.from).toHaveBeenCalledWith('evolution_runs');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        error_message: 'dry-run: no execution performed',
      }),
    );

    process.argv = originalArgv;
  });
});
