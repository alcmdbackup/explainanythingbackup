// Tests for V2 watchdog — stale run detection and failure marking.

import { runWatchdog } from './watchdog';

function buildWatchdogMock(opts: { staleRuns?: Array<Record<string, unknown>> }) {
  const { staleRuns = [] } = opts;

  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockResolvedValue({ data: staleRuns, error: null }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }),
  } as never;
}

describe('watchdog ops', () => {
  it('returns empty result when no stale runs found', async () => {
    const supabase = buildWatchdogMock({});
    const result = await runWatchdog(supabase);
    expect(result.staleRunsFound).toBe(0);
    expect(result.markedFailed).toEqual([]);
  });

  it('marks stale runs as failed', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', created_at: '2020-01-01' },
    ];
    const supabase = buildWatchdogMock({ staleRuns });
    const result = await runWatchdog(supabase);
    expect(result.staleRunsFound).toBe(1);
    expect(result.markedFailed).toEqual(['run-1']);
  });

  it('marks runs with null heartbeat as stale', async () => {
    const staleRuns = [
      { id: 'run-2', runner_id: 'r2', last_heartbeat: null, created_at: '2020-01-01' },
    ];
    const supabase = buildWatchdogMock({ staleRuns });
    const result = await runWatchdog(supabase);
    expect(result.staleRunsFound).toBe(1);
    expect(result.markedFailed).toEqual(['run-2']);
  });
});
