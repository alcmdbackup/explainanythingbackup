// Unit tests for evolution watchdog cron endpoint.
// Covers auth, stale run detection, per-run structured error, configurable threshold,
// defense-in-depth checkpoint recovery, and stale continuation_pending abandonment.

import { GET } from './route';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

function makeRequest(bearer = 'Bearer test-secret'): Request {
  return {
    headers: {
      get: (name: string) => name.toLowerCase() === 'authorization' ? bearer : null,
    },
  } as unknown as Request;
}

/** Build a mock supabase that handles the watchdog's query pattern:
 *  1. from('content_evolution_runs').select().in().lt() — stale claimed/running
 *  2. For each stale run: from('evolution_checkpoints').select().eq().gt().order().limit().maybeSingle()
 *  3. For each stale run: from('content_evolution_runs').update().eq()...
 *  4. from('content_evolution_runs').select().eq().lt() — stale continuation_pending
 *  5. For each stale continuation: from('content_evolution_runs').update().eq().eq()
 */
function buildWatchdogMock(opts: {
  staleRuns?: Array<Record<string, unknown>>;
  checkpointForRun?: Record<string, { created_at: string } | null>;
  staleContinuations?: Array<Record<string, unknown>>;
  updateError?: boolean;
}) {
  const {
    staleRuns = [],
    checkpointForRun = {},
    staleContinuations = [],
  } = opts;

  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ error: null }),
    }),
  });

  const updateFailedMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  });

  const updateContinuationMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  });

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
    // content_evolution_runs — need to distinguish query vs update
    return {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockImplementation((_col: string, _val: string) => {
        // This is either the stale runs query or the continuation query.
        // We use a counter to distinguish.
        return Promise.resolve({ data: ltCallCount++ === 0 ? staleRuns : staleContinuations, error: null });
      }),
      update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
        if (payload.status === 'continuation_pending') {
          updateMock(payload);
          return {
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (payload.status === 'failed' && typeof payload.error_message === 'string' && payload.error_message.includes('not resumed')) {
          updateContinuationMock(payload);
          return {
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        updateFailedMock(payload);
        return {
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      }),
    };
  });

  let ltCallCount = 0;

  return { fromMock, updateMock, updateFailedMock, updateContinuationMock };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('evolution-watchdog', () => {
  it('returns 401 when auth fails', async () => {
    const response = await GET(makeRequest('Bearer wrong-secret'));
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when CRON_SECRET is not configured (fail-closed)', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it('returns ok with 0 stale runs when none found', async () => {
    const { fromMock } = buildWatchdogMock({});
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({ from: fromMock });

    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.staleRunsFound).toBe(0);
    expect(body.markedFailed).toEqual([]);
    expect(body.recoveredViaContinuation).toEqual([]);
    expect(body.abandonedContinuations).toEqual([]);
  });

  it('marks stale runs as failed with structured error when no checkpoint exists', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 1, phase: 'running', continuation_count: 0 },
    ];

    const { fromMock, updateFailedMock } = buildWatchdogMock({ staleRuns });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({ from: fromMock });

    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.staleRunsFound).toBe(1);
    expect(body.markedFailed).toEqual(['run-1']);
    expect(updateFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', runner_id: null }),
    );
    // Verify structured error message
    const updateArg = updateFailedMock.mock.calls[0][0] as Record<string, unknown>;
    const parsedError = JSON.parse(updateArg.error_message as string);
    expect(parsedError.source).toBe('evolution-watchdog');
    expect(parsedError.lastIteration).toBe(1);
  });

  it('recovers stale run via checkpoint instead of marking failed', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 2, phase: 'EXPANSION', continuation_count: 0 },
    ];

    const { fromMock, updateMock } = buildWatchdogMock({
      staleRuns,
      checkpointForRun: { 'run-1': { created_at: '2020-01-01T00:01:00Z' } },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({ from: fromMock });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.recoveredViaContinuation).toEqual(['run-1']);
    expect(body.markedFailed).toEqual([]);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'continuation_pending', runner_id: null }),
    );
  });

  it('marks stale continuation_pending runs as abandoned after 30 min', async () => {
    const staleContinuation = [
      { id: 'run-cont-1', last_heartbeat: '2020-01-01' },
    ];

    const { fromMock, updateContinuationMock } = buildWatchdogMock({
      staleContinuations: staleContinuation,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({ from: fromMock });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.abandonedContinuations).toEqual(['run-cont-1']);
    expect(body.markedFailed).toEqual([]);
  });
});
