/**
 * @jest-environment node
 */
// Tests for the POST-only evolution runner endpoint (admin auth, targetRunId, error handling).

import { POST, maxDuration } from './route';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));
jest.mock('@evolution/services/evolutionRunnerCore', () => ({
  claimAndExecuteEvolutionRun: jest.fn(),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockClaimAndExecute = claimAndExecuteEvolutionRun as jest.MockedFunction<typeof claimAndExecuteEvolutionRun>;

describe('Evolution Runner API (/api/evolution/run)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin-user-id');
  });

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

  // ─── POST behavior ─────────────────────────────────────────────

  describe('POST', () => {
    it('passes targetRunId to shared core when valid UUID is provided', async () => {
      const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockClaimAndExecute.mockResolvedValue({ claimed: true, runId: validUuid, stopReason: 'completed', durationMs: 1000 });

      const response = await POST(createPostRequest({ runId: validUuid }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.claimed).toBe(true);
      expect(mockClaimAndExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetRunId: validUuid, runnerId: 'admin-trigger' }),
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
