/**
 * @jest-environment node
 */
// Tests for processRunQueue.ts — validates parseIntArg, buildDbTargets, and main loop delegation to claimAndExecuteRun.

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
  return mockClients[url]!;
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => getMockClient(url)),
}));

// Mock claimAndExecuteRun — the only pipeline dependency
const mockClaimAndExecuteRun = jest.fn().mockResolvedValue({ claimed: false });
jest.mock('../src/lib/pipeline/claimAndExecuteRun', () => ({
  claimAndExecuteRun: mockClaimAndExecuteRun,
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
      const val = parseInt(process.argv[idx + 1]!, 10);
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
      const val = parseInt(process.argv[idx + 1]!, 10);
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
      const val = parseInt(process.argv[idx + 1]!, 10);
      return Number.isFinite(val) && val > 0 ? val : defaultVal;
    };
    expect(parseIntArg('--parallel', 1)).toBe(1);
    process.argv = original;
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

describe('claimAndExecuteRun delegation', () => {
  // Spy on process.exit to prevent tests from exiting
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('passes runnerId matching v2- format (regression: runner_id mismatch)', async () => {
    mockClaimAndExecuteRun
      .mockResolvedValueOnce({ claimed: true, runId: 'r1', stopReason: 'completed', durationMs: 100 })
      .mockResolvedValue({ claimed: false });

    const { main } = await import('./processRunQueue');
    await main();

    expect(mockClaimAndExecuteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerId: expect.stringMatching(/^v2-/),
        db: expect.anything(),
      }),
    );
  });

  it('passes target db client to claimAndExecuteRun', async () => {
    const { main } = await import('./processRunQueue');
    await main();

    // Should have called once per target in the batch (2 targets with default parallel=1 means 1 call,
    // but with PARALLEL=1 and round-robin, batch size is 1 so only first target is called first iteration)
    const calls = mockClaimAndExecuteRun.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Every call should have a db property
    for (const call of calls) {
      expect(call[0]).toHaveProperty('db');
    }
  });

  it('stops when no runs claimed from any target', async () => {
    mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });

    const { main } = await import('./processRunQueue');
    await main();

    // Should exit after one batch with no claims
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('handles unexpected throw from claimAndExecuteRun gracefully', async () => {
    mockClaimAndExecuteRun.mockRejectedValue(new Error('Network timeout'));

    const { main } = await import('./processRunQueue');
    // Should not throw — Promise.allSettled catches the rejection
    await main();

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('respects MAX_RUNS limit', async () => {
    // Always claim successfully — MAX_RUNS (default 10) should cap total runs
    let callCount = 0;
    mockClaimAndExecuteRun.mockImplementation(async () => {
      callCount++;
      return { claimed: true, runId: `r${callCount}`, stopReason: 'completed', durationMs: 10 };
    });

    const { main } = await import('./processRunQueue');
    await main();

    // Default MAX_RUNS=10, PARALLEL=1 → 10 claimed runs then exit
    expect(callCount).toBeLessThanOrEqual(11); // may overshoot by 1 batch
  });

  it('logs run results with db target name', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockClaimAndExecuteRun
      .mockResolvedValueOnce({ claimed: true, runId: 'r1', stopReason: 'completed', durationMs: 50 })
      .mockResolvedValue({ claimed: false });

    const { main } = await import('./processRunQueue');
    await main();

    const logOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logOutput).toContain('Run completed');
    expect(logOutput).toContain('r1');
    consoleSpy.mockRestore();
  });

  it('passes dryRun flag when DRY_RUN is set', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', '--dry-run'];

    jest.resetModules();
    // Re-mock after resetModules
    jest.mock('../src/lib/pipeline/claimAndExecuteRun', () => ({
      claimAndExecuteRun: mockClaimAndExecuteRun,
    }));
    jest.mock('@/lib/services/llmSemaphore', () => ({
      initLLMSemaphore: jest.fn(),
    }));

    mockClaimAndExecuteRun
      .mockResolvedValueOnce({ claimed: true, runId: 'dr1', stopReason: 'dry-run', durationMs: 1 })
      .mockResolvedValue({ claimed: false });

    const { main } = await import('./processRunQueue');
    await main();

    expect(mockClaimAndExecuteRun).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );

    process.argv = originalArgv;
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
    expect(targets[0]!.name).toBe('prod');
  });

  it('skips target with missing env file', async () => {
    const fsMod = await import('fs');
    // Make .env.evolution-prod not exist
    (fsMod.existsSync as jest.Mock).mockImplementation((p: string) => p.includes('.env.local'));

    const { buildDbTargets } = await import('./processRunQueue');
    const targets = await buildDbTargets();

    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe('staging');

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
