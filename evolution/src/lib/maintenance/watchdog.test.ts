// Tests for V2 watchdog — stale run detection, failure marking, and orphaned reservation cleanup.

const mockCleanup = jest.fn();

jest.mock('@/lib/services/llmSpendingGate', () => ({
  getSpendingGate: jest.fn().mockReturnValue({
    cleanupOrphanedReservations: () => mockCleanup(),
  }),
}));

import { runWatchdog, cleanupOrphanedReservations } from './watchdog';

function buildWatchdogMock(opts: { staleRuns?: Array<Record<string, unknown>> }) {
  const { staleRuns = [] } = opts;

  // B060: the update chain is `update().eq().(eq|is)().in().select('id')`, and
  // returns the array of actually-updated rows. The mock reports every stale
  // run as successfully updated so markedFailed matches staleRuns.
  const updateChain = (row: Record<string, unknown>) => ({
    // terminal select returns the single row when the compare-and-set predicate
    // "matches".
    in: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ data: [{ id: row.id }], error: null }),
    }),
  });

  return {
    from: jest.fn().mockImplementation(() => {
      // Separate call to `update()` per run; we need a fresh chain each time.
      let runCursor = 0;
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        or: jest.fn().mockResolvedValue({ data: staleRuns, error: null }),
        update: jest.fn().mockImplementation(() => {
          const row = staleRuns[runCursor] ?? { id: `noop-${runCursor}` };
          runCursor++;
          return {
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue(updateChain(row)),
              is: jest.fn().mockReturnValue(updateChain(row)),
            }),
          };
        }),
      };
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

describe('cleanupOrphanedReservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls spending gate cleanup', async () => {
    mockCleanup.mockResolvedValue(undefined);
    await cleanupOrphanedReservations();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from spending gate', async () => {
    mockCleanup.mockRejectedValue(new Error('DB connection failed'));
    await expect(cleanupOrphanedReservations()).rejects.toThrow('DB connection failed');
  });
});
