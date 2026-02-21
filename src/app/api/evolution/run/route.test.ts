/**
 * @jest-environment node
 */
// Tests for the unified evolution runner endpoint (dual auth, GET/POST, targetRunId, error handling).

import { GET, POST, maxDuration } from './route';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { NextResponse } from 'next/server';

jest.mock('@/lib/utils/cronAuth', () => ({
  requireCronAuth: jest.fn(),
}));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));
jest.mock('@evolution/services/evolutionRunnerCore', () => ({
  claimAndExecuteEvolutionRun: jest.fn(),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('12345678-1234-4123-8123-123456789abc'),
}));

const mockRequireCronAuth = requireCronAuth as jest.MockedFunction<typeof requireCronAuth>;
const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockClaimAndExecute = claimAndExecuteEvolutionRun as jest.MockedFunction<typeof claimAndExecuteEvolutionRun>;

describe('Unified Evolution Runner API (/api/evolution/run)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createGetRequest(): Request {
    return new Request('http://localhost/api/evolution/run', { method: 'GET' });
  }

  function createPostRequest(body?: Record<string, unknown>): Request {
    if (body === undefined) {
      return new Request('http://localhost/api/evolution/run', { method: 'POST' });
    }
    return new Request('http://localhost/api/evolution/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ─── Dual auth ─────────────────────────────────────────────────

  describe('Dual auth', () => {
    it('passes when cron secret is valid (requireCronAuth returns null)', async () => {
      mockRequireCronAuth.mockReturnValue(null);
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(false);
      expect(mockRequireAdmin).not.toHaveBeenCalled();
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ runnerId: expect.stringContaining('cron-runner-') }),
      );
    });

    it('passes when admin session is valid (cron auth fails, requireAdmin succeeds)', async () => {
      mockRequireCronAuth.mockReturnValue(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );
      mockRequireAdmin.mockResolvedValue('admin-user-id');
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(false);
      expect(mockRequireAdmin).toHaveBeenCalled();
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ runnerId: 'admin-trigger' }),
      );
    });

    it('returns 401 when neither cron secret nor admin session passes', async () => {
      mockRequireCronAuth.mockReturnValue(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );
      mockRequireAdmin.mockRejectedValue(new Error('Not authenticated'));

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
      expect(mockClaimAndExecute).not.toHaveBeenCalled();
    });
  });

  // ─── GET behavior ──────────────────────────────────────────────

  describe('GET', () => {
    beforeEach(() => {
      mockRequireCronAuth.mockReturnValue(null);
    });

    it('returns { claimed: false } when no pending runs', async () => {
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ claimed: false, message: 'No pending runs' });
    });

    it('returns 500 when claim errors', async () => {
      mockClaimAndExecute.mockResolvedValue({ claimed: false, error: 'Failed to claim run: Connection refused' });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('Failed to claim run');
    });

    it('returns { claimed: true, runId, stopReason, durationMs } on successful run', async () => {
      mockClaimAndExecute.mockResolvedValue({
        claimed: true,
        runId: 'run-abc',
        stopReason: 'completed',
        durationMs: 42000,
      });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        claimed: true,
        runId: 'run-abc',
        stopReason: 'completed',
        durationMs: 42000,
      });
    });

    it('returns 500 with { claimed: true, error } on pipeline failure', async () => {
      mockClaimAndExecute.mockResolvedValue({
        claimed: true,
        runId: 'run-fail',
        error: 'Pipeline crashed',
      });

      const response = await GET(createGetRequest());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        claimed: true,
        runId: 'run-fail',
        error: 'Pipeline crashed',
      });
    });
  });

  // ─── POST behavior ─────────────────────────────────────────────

  describe('POST', () => {
    beforeEach(() => {
      mockRequireCronAuth.mockReturnValue(null);
    });

    it('passes targetRunId to shared core when valid UUID is provided', async () => {
      const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockClaimAndExecute.mockResolvedValue({ claimed: true, runId: validUuid, stopReason: 'completed', durationMs: 1000 });

      const response = await POST(createPostRequest({ runId: validUuid }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(true);
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetRunId: validUuid }),
      );
    });

    it('returns 400 when runId is not a valid UUID', async () => {
      const response = await POST(createPostRequest({ runId: 'not-a-uuid' }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid runId');
      expect(mockClaimAndExecute).not.toHaveBeenCalled();
    });

    it('returns 400 when runId is a number instead of string', async () => {
      const response = await POST(createPostRequest({ runId: 12345 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid runId');
      expect(mockClaimAndExecute).not.toHaveBeenCalled();
    });

    it('treats malformed JSON body as run-next-pending (no targetRunId)', async () => {
      const request = new Request('http://localhost/api/evolution/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad-json',
      });
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(false);
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetRunId: undefined }),
      );
    });

    it('claims oldest pending when body has no runId field', async () => {
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await POST(createPostRequest({}));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(false);
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetRunId: undefined }),
      );
    });

    it('claims oldest pending when POST has no body', async () => {
      mockClaimAndExecute.mockResolvedValue({ claimed: false });

      const response = await POST(
        new Request('http://localhost/api/evolution/run', { method: 'POST' }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(false);
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetRunId: undefined }),
      );
    });
  });

  // ─── maxDuration export ────────────────────────────────────────

  describe('maxDuration export', () => {
    it('equals 800', () => {
      expect(maxDuration).toBe(800);
    });
  });
});
