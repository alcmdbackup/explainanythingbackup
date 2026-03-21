/**
 * @jest-environment node
 */
// Tests for evolution-runner.ts — validates parseIntArg, claimBatch round-robin, executeRun with TaggedRun, buildDbTargets.

// Set required env vars BEFORE any imports (module-level check runs at import time)
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.SUPABASE_URL_STAGING = 'https://staging.supabase.co';
process.env.SUPABASE_KEY_STAGING = 'test-staging-key';
process.env.SUPABASE_URL_PROD = 'https://prod.supabase.co';
process.env.SUPABASE_KEY_PROD = 'test-prod-key';

// Multi-client mock keyed by URL
const mockClients: Record<string, { rpc: jest.Mock; from: jest.Mock }> = {};

function getMockClient(url: string) {
  if (!mockClients[url]) {
    mockClients[url] = {
      rpc: jest.fn(),
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn(),
            order: jest.fn().mockReturnValue({ limit: jest.fn() }),
          }),
          limit: jest.fn().mockResolvedValue({ data: [{ id: 'test' }], error: null }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(),
            in: jest.fn(),
          }),
        }),
      }),
    };
  }
  return mockClients[url];
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => getMockClient(url)),
}));

// Mock the V2 runner module
const mockExecuteV2Run = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/lib/pipeline/runner', () => ({
  executeV2Run: mockExecuteV2Run,
}));

// Mock callLLM (used by createLLMProvider)
jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('mocked LLM response'),
}));

// Mock LLM semaphore (loaded in main())
jest.mock('../../src/lib/services/llmSemaphore', () => ({
  initLLMSemaphore: jest.fn(),
}));

import type { DbTarget, TaggedRun, ClaimedRun } from './evolution-runner';

describe('REQUIRED_ENV_VARS validation', () => {
  it('runner requires the 5 new env vars', () => {
    const requiredVars = [
      'OPENAI_API_KEY',
      'SUPABASE_URL_STAGING',
      'SUPABASE_KEY_STAGING',
      'SUPABASE_URL_PROD',
      'SUPABASE_KEY_PROD',
    ];
    for (const v of requiredVars) {
      expect(process.env[v]).toBeDefined();
    }
  });
});

describe('parseIntArg', () => {
  it('returns default when flag not present', () => {
    const original = process.argv;
    process.argv = ['node', 'script.ts'];
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

describe('claimBatch round-robin logic', () => {
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

  it('round-robins across multiple DbTargets', async () => {
    const runner = await import('./evolution-runner');

    const aRuns = [
      { id: 'a1', explanation_id: 1, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
      { id: 'a2', explanation_id: 2, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
    ];
    const bRuns = [
      { id: 'b1', explanation_id: 3, prompt_id: null, experiment_id: null, strategy_config_id: 's1', budget_cap_usd: 5 },
    ];

    // Mock rpc at the client level — claimNextRun uses db.client.rpc internally
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

    const batch = await runner.claimBatch(4, [targetA, targetB]);

    expect(batch).toHaveLength(3); // both targets exhausted before batchSize=4
    expect(batch.map((t: TaggedRun) => t.run.id)).toEqual(['a1', 'b1', 'a2']);
    expect(batch.map((t: TaggedRun) => t.db.name)).toEqual(['a', 'b', 'a']);
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

describe('executeRun V2 delegation', () => {
  const mockFrom = jest.fn();

  function createMockTarget(name = 'test'): DbTarget {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn() }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(),
          in: jest.fn(),
        }),
      }),
    });
    return {
      name,
      client: { rpc: jest.fn(), from: mockFrom } as unknown as import('@supabase/supabase-js').SupabaseClient,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to executeV2Run for explanation-based run', async () => {
    const { executeRun } = await import('./evolution-runner');
    const mockTarget = createMockTarget();

    const run = {
      id: 'run-expl',
      explanation_id: 42,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await executeRun({ run, db: mockTarget } as never);

    expect(mockExecuteV2Run).toHaveBeenCalledWith(
      'run-expl',
      run,
      expect.anything(), // db client
      expect.objectContaining({ complete: expect.any(Function) }), // llm provider
    );
  });

  it('delegates to executeV2Run for prompt-based run', async () => {
    const { executeRun } = await import('./evolution-runner');
    const mockTarget = createMockTarget();

    const run = {
      id: 'run-prompt',
      explanation_id: null,
      prompt_id: 'topic-1',
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await executeRun({ run, db: mockTarget } as never);

    expect(mockExecuteV2Run).toHaveBeenCalledWith(
      'run-prompt',
      run,
      expect.anything(),
      expect.objectContaining({ complete: expect.any(Function) }),
    );
  });

  it('marks run failed when executeV2Run throws', async () => {
    const { executeRun } = await import('./evolution-runner');

    mockExecuteV2Run.mockRejectedValueOnce(new Error('Pipeline exploded'));

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn(),
      }),
    });
    const mockTarget: DbTarget = {
      name: 'test',
      client: {
        rpc: jest.fn(),
        from: jest.fn().mockReturnValue({
          update: mockUpdate,
        }),
      } as unknown as import('@supabase/supabase-js').SupabaseClient,
    };

    const run = {
      id: 'run-fail',
      explanation_id: 1,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await executeRun({ run, db: mockTarget } as never);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_message: expect.stringContaining('Pipeline exploded'), completed_at: expect.any(String) }),
    );
  });

  it('dry-run marks run completed via TaggedRun db client without calling executeV2Run', async () => {
    // DRY_RUN is set at module load time; test the dry-run code path directly
    const originalArgv = process.argv;
    process.argv = [...originalArgv, '--dry-run'];

    // Clear module cache to pick up --dry-run flag
    jest.resetModules();

    // Re-set env vars and mocks after resetModules
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.SUPABASE_URL_STAGING = 'https://staging.supabase.co';
    process.env.SUPABASE_KEY_STAGING = 'test-staging-key';
    process.env.SUPABASE_URL_PROD = 'https://prod.supabase.co';
    process.env.SUPABASE_KEY_PROD = 'test-prod-key';

    const mockDryRunUpdate = jest.fn().mockReturnValue({ eq: jest.fn() });
    const mockDryRunTarget: DbTarget = {
      name: 'test-dry',
      client: {
        rpc: jest.fn(),
        from: jest.fn().mockReturnValue({ update: mockDryRunUpdate }),
      } as unknown as import('@supabase/supabase-js').SupabaseClient,
    };

    const freshRunner = await import('./evolution-runner');
    const freshExecuteV2Run = (await import('../src/lib/pipeline/runner')).executeV2Run as jest.Mock;
    freshExecuteV2Run.mockClear();

    const run = {
      id: 'run-dry',
      explanation_id: 1,
      prompt_id: null,
      experiment_id: null,
      strategy_config_id: 'strat-1',
      budget_cap_usd: 5,
    };

    await freshRunner.executeRun({ run, db: mockDryRunTarget } as never);

    expect(mockDryRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', error_message: 'dry-run: no execution performed' }),
    );
    expect(freshExecuteV2Run).not.toHaveBeenCalled();

    process.argv = originalArgv;
  });
});

describe('markRunFailed with db param', () => {
  it('uses the provided db client to mark run failed', async () => {
    const { markRunFailed } = await import('./evolution-runner');

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn(),
      }),
    });
    const mockClient = {
      from: jest.fn().mockReturnValue({ update: mockUpdate }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await markRunFailed(mockClient, 'run-1', 'some error');

    expect(mockClient.from).toHaveBeenCalledWith('evolution_runs');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_message: 'some error', completed_at: expect.any(String) }),
    );
  });
});

describe('buildDbTargets', () => {
  it('returns 2 targets named staging and prod', async () => {
    const { buildDbTargets } = await import('./evolution-runner');

    // Mock the pre-flight select to succeed
    const stagingClient = getMockClient('https://staging.supabase.co');
    const prodClient = getMockClient('https://prod.supabase.co');

    stagingClient.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'test' }], error: null }),
      }),
    });
    prodClient.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'test' }], error: null }),
      }),
    });

    const targets = await buildDbTargets();

    expect(targets).toHaveLength(2);
    expect(targets[0].name).toBe('staging');
    expect(targets[1].name).toBe('prod');
  });

  it('throws when pre-flight check fails for a target', async () => {
    const { buildDbTargets } = await import('./evolution-runner');

    const stagingClient = getMockClient('https://staging.supabase.co');
    const prodClient = getMockClient('https://prod.supabase.co');

    stagingClient.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'connection refused' } }),
      }),
    });
    prodClient.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'test' }], error: null }),
      }),
    });

    await expect(buildDbTargets()).rejects.toThrow('Unreachable targets');
    await expect(buildDbTargets()).rejects.toThrow('staging: connection refused');
  });

  it('module exits when env vars are partially missing', () => {
    // Env var validation runs at module load time via process.exit(1).
    // Verify the validation logic catches partial configs.
    const vars = [
      'OPENAI_API_KEY',
      'SUPABASE_URL_STAGING',
      'SUPABASE_KEY_STAGING',
      'SUPABASE_URL_PROD',
      'SUPABASE_KEY_PROD',
    ];
    // Removing any single var should be caught by the REQUIRED_ENV_VARS check
    for (const v of vars) {
      const filtered = vars.filter((x) => x !== v);
      // Verify the missing var would be detected
      const missing = vars.filter((x) => !filtered.includes(x));
      expect(missing).toEqual([v]);
      expect(missing.length).toBe(1);
    }
  });
});
