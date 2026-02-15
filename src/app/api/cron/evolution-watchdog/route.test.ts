// Unit tests for evolution watchdog cron endpoint.
// Covers auth, stale run detection, and SCRIPT-4 env-configurable threshold.

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

jest.mock('@/lib/utils/cronAuth', () => ({
  requireCronAuth: jest.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';

function makeRequest(): Request {
  return {
    headers: {
      get: (name: string) => name.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null,
    },
  } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireCronAuth as jest.Mock).mockReturnValue(null); // auth passes
});

describe('evolution-watchdog', () => {
  it('returns error when auth fails', async () => {
    const errorResponse = { status: 401, json: async () => ({ error: 'Unauthorized' }) };
    (requireCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const response = await GET(makeRequest());
    expect(response).toBe(errorResponse);
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

  it('marks stale runs as failed', async () => {
    const staleRuns = [
      { id: 'run-1', runner_id: 'r1', last_heartbeat: '2020-01-01', current_iteration: 1, phase: 'running' },
    ];

    const updateMock = jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        lt: jest.fn().mockResolvedValue({ data: staleRuns, error: null }),
        update: updateMock,
      }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.staleRunsFound).toBe(1);
    expect(body.markedFailed).toEqual(['run-1']);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  // SCRIPT-4: Verify the stale threshold produces expected cutoff range
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
