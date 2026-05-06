// Unit tests for POST /api/evolution/run: auth guard, success response, error handling.

import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@evolution/lib/pipeline/claimAndExecuteRun', () => ({
  claimAndExecuteRun: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockClaimAndExecuteRun = claimAndExecuteRun as jest.MockedFunction<typeof claimAndExecuteRun>;

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3008/api/evolution/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/evolution/run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin-user-id');
  });

  it('returns 403 when not authenticated', async () => {
    mockRequireAdmin.mockRejectedValue(new Error('Unauthorized: Not authenticated'));

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Unauthorized: Not authenticated');
  });

  it('returns 403 when not admin', async () => {
    mockRequireAdmin.mockRejectedValue(new Error('Unauthorized: Not an admin'));

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Unauthorized: Not an admin');
  });

  it('returns RunnerResult on success', async () => {
    // B079: targetRunId must now be a UUID (z.string().uuid()). Use a real UUID
    // here rather than 'run-123' so the request passes validation.
    const VALID_UUID = '00000000-0000-4000-8000-000000000001';
    const mockResult = { claimed: true, runId: VALID_UUID, stopReason: 'completed', durationMs: 5000 };
    mockClaimAndExecuteRun.mockResolvedValue(mockResult);

    const response = await POST(makeRequest({ targetRunId: VALID_UUID }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockResult);
    expect(mockClaimAndExecuteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerId: expect.stringMatching(/^api-/),
        targetRunId: VALID_UUID,
      }),
    );
  });

  it('returns RunnerResult when no run claimed', async () => {
    mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.claimed).toBe(false);
  });

  it('returns 500 on pipeline error', async () => {
    mockClaimAndExecuteRun.mockRejectedValue(new Error('DB connection failed'));

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
  });

  it('handles empty body gracefully', async () => {
    mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });

    const req = new NextRequest('http://localhost:3008/api/evolution/run', {
      method: 'POST',
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mockClaimAndExecuteRun).toHaveBeenCalledWith(
      expect.objectContaining({ targetRunId: undefined }),
    );
  });
});
