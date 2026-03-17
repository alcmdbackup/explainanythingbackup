// Tests for watchdog ops module — stale run detection, checkpoint recovery, continuation abandonment.

import { runWatchdog, WatchdogResult } from './watchdog';

/** Build a mock supabase that handles the watchdog's query pattern. */
function buildWatchdogMock(opts: {
  staleRuns?: Array<Record<string, unknown>>;
  checkpointForRun?: Record<string, { created_at: string } | null>;
  staleContinuations?: Array<Record<string, unknown>>;
}) {
  const {
    staleRuns = [],
    checkpointForRun = {},
    staleContinuations = [],
  } = opts;

  let ltCallCount = 0;

  const fromMock = jest.fn().mockImplementation((table: string) => {
    if (table === 'evolution_checkpoints') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation((_col: string, runId: string) => ({
          gt: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: checkpointForRun[runId] ?? null,
                  error: null,
                }),
              }),
            }),
          }),
        })),
      };
    }
    // evolution_runs
    return {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockImplementation(() => {
        return Promise.resolve({ data: ltCallCount++ === 0 ? staleRuns : staleContinuations, error: null });
      }),
      update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
        if (payload.status === 'continuation_pending') {
          return {
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (payload.status === 'failed' && typeof payload.error_message === 'string' && payload.error_message.includes('not resumed')) {
          return {
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      }),
    };
  });

  return { from: fromMock } as unknown as Parameters<typeof runWatchdog>[0];
}

describe('watchdog ops', () => {
  it('returns empty result when no stale runs found', async () => {
    const supabase = buildWatchdogMock({});
    const result = await runWatchdog(supabase);
    expect(result.staleRunsFound).toBe(0);
    expect(result.markedFailed).toEqual([]);
    expect(result.recoveredViaContinuation).toEqual([]);
    expect(result.abandonedContinuations).toEqual([]);
  });

  it('marks stale runs as failed with structured error when no checkpoint exists', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 1, phase: 'running', continuation_count: 0 },
    ];

    const supabase = buildWatchdogMock({ staleRuns });
    const result = await runWatchdog(supabase);
    expect(result.staleRunsFound).toBe(1);
    expect(result.markedFailed).toEqual(['run-1']);
  });

  it('recovers stale run via checkpoint instead of marking failed', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 2, phase: 'EXPANSION', continuation_count: 0 },
    ];

    const supabase = buildWatchdogMock({
      staleRuns,
      checkpointForRun: { 'run-1': { created_at: '2020-01-01T00:01:00Z' } },
    });
    const result = await runWatchdog(supabase);
    expect(result.recoveredViaContinuation).toEqual(['run-1']);
    expect(result.markedFailed).toEqual([]);
  });

  it('marks stale continuation_pending runs as abandoned after 30 min', async () => {
    const staleContinuation = [
      { id: 'run-cont-1', last_heartbeat: '2020-01-01' },
    ];

    const supabase = buildWatchdogMock({ staleContinuations: staleContinuation });
    const result = await runWatchdog(supabase);
    expect(result.abandonedContinuations).toEqual(['run-cont-1']);
    expect(result.markedFailed).toEqual([]);
  });
});
