// Tests for evolution server actions: cost breakdown, history, rollback, and date filtering.

import {
  getEvolutionCostBreakdownAction,
  getEvolutionHistoryAction,
  rollbackEvolutionAction,
  getEvolutionRunsAction,
} from './evolutionActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn(),
}));

/** Build a Supabase mock where every method chains and .single()/.limit() are terminal. */
function createChainMock() {
  const mock: Record<string, jest.Mock> = {};
  const chain = () => mock;
  // All chain methods return the mock itself (chainable)
  for (const m of ['from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'in', 'is',
    'order', 'limit', 'range', 'single', 'maybeSingle']) {
    mock[m] = jest.fn(chain);
  }
  return mock;
}

describe('Evolution Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  // ─── Cost Breakdown ────────────────────────────────────────────

  describe('getEvolutionCostBreakdownAction', () => {
    it('groups costs by agent and strips evolution_ prefix', async () => {
      const mock = createChainMock();
      let callCount = 0;

      // Override single for run lookup, and lte for LLM call query terminal
      mock.single.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mock.lte.mockImplementation(() => {
        // This is the terminal for the second query
        return Promise.resolve({
          data: [
            { call_source: 'evolution_generation', estimated_cost_usd: 0.01 },
            { call_source: 'evolution_generation', estimated_cost_usd: 0.02 },
            { call_source: 'evolution_calibration', estimated_cost_usd: 0.005 },
          ],
          error: null,
        });
      });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-1');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]).toEqual({ agent: 'generation', calls: 2, costUsd: 0.03 });
      expect(result.data![1]).toEqual({ agent: 'calibration', calls: 1, costUsd: 0.005 });
    });

    it('returns empty array when no calls found', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
        error: null,
      });
      mock.lte.mockResolvedValueOnce({ data: [], error: null });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error when run not found', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Evolution History ─────────────────────────────────────────

  describe('getEvolutionHistoryAction', () => {
    it('returns filtered content history rows', async () => {
      const mock = createChainMock();
      mock.order.mockResolvedValueOnce({
        data: [
          {
            id: 1,
            explanation_id: 42,
            source: 'evolution_pipeline',
            evolution_run_id: 'run-1',
            applied_by: 'admin-123',
            created_at: '2026-01-15T10:00:00Z',
          },
        ],
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionHistoryAction(42);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].applied_at).toBe('2026-01-15T10:00:00Z');
    });

    it('returns empty array for no history', async () => {
      const mock = createChainMock();
      mock.order.mockResolvedValueOnce({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionHistoryAction(999);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── Rollback ──────────────────────────────────────────────────

  describe('rollbackEvolutionAction', () => {
    it('restores previous content and creates audit entry', async () => {
      const mock = createChainMock();
      let singleCount = 0;
      mock.single.mockImplementation(() => {
        singleCount++;
        if (singleCount === 1) {
          // Fetch history row
          return Promise.resolve({
            data: { id: 1, explanation_id: 42, previous_content: 'old content' },
            error: null,
          });
        }
        if (singleCount === 2) {
          // Fetch current content
          return Promise.resolve({
            data: { content: 'current content' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      // insert and update chain terminals need to resolve
      mock.insert.mockImplementation(() => {
        // insert → returns object with error field (no further chain)
        return Promise.resolve({ error: null });
      });
      // eq is the terminal after update().eq()
      let eqCount = 0;
      mock.eq.mockImplementation(() => {
        eqCount++;
        // For the first 2 eq calls (single chains), return self for chaining
        if (eqCount <= 4) return mock;
        // After insert, update().eq() is the terminal
        return Promise.resolve({ error: null });
      });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await rollbackEvolutionAction({ explanationId: 42, historyId: 1 });
      expect(result.success).toBe(true);
    });

    it('fails when history row not found', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await rollbackEvolutionAction({ explanationId: 42, historyId: 999 });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Date filter ───────────────────────────────────────────────

  describe('getEvolutionRunsAction with startDate', () => {
    it('applies gte filter when startDate provided', async () => {
      const mock = createChainMock();
      // The chain is: from→select→order→limit then gte is applied
      // The result resolves from limit (after gte)
      mock.gte.mockResolvedValueOnce({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getEvolutionRunsAction({ startDate: '2026-01-01T00:00:00Z' });
      expect(mock.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00Z');
    });

    it('does not apply gte filter without startDate', async () => {
      const mock = createChainMock();
      // Without startDate, chain ends at eq (for status filter) or limit
      mock.eq.mockResolvedValueOnce({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getEvolutionRunsAction({ status: 'completed' });
      expect(mock.gte).not.toHaveBeenCalled();
    });
  });
});
