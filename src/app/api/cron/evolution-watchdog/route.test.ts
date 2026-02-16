// Unit tests for evolution watchdog cron endpoint.
// Covers auth, stale run detection, per-run structured error, and configurable threshold.

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
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        lt: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.staleRunsFound).toBe(0);
  });

  it('marks stale runs as failed with structured error', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 1, phase: 'running' },
    ];

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const fromMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      lt: jest.fn().mockResolvedValue({ data: staleRuns, error: null }),
      update: updateMock,
    });

    const mockSupabase = { from: fromMock };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.staleRunsFound).toBe(1);
    expect(body.markedFailed).toEqual(['run-1']);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', runner_id: null }),
    );
    // Verify structured error message
    const updateArg = updateMock.mock.calls[0][0] as Record<string, unknown>;
    const parsedError = JSON.parse(updateArg.error_message as string);
    expect(parsedError.source).toBe('evolution-watchdog');
    expect(parsedError.lastIteration).toBe(1);
  });

  it('uses configurable stale threshold (defaults to 10 min)', async () => {
    let capturedCutoff = '';
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        lt: jest.fn().mockImplementation((_col: string, val: string) => {
          capturedCutoff = val;
          return Promise.resolve({ data: [], error: null });
        }),
      }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

    await GET(makeRequest());

    // Default threshold is 10 minutes; cutoff should be ~10 min ago
    const cutoff = new Date(capturedCutoff);
    const diffMs = Date.now() - cutoff.getTime();
    expect(diffMs).toBeGreaterThan(9 * 60 * 1000);
    expect(diffMs).toBeLessThan(11 * 60 * 1000);
  });
});
