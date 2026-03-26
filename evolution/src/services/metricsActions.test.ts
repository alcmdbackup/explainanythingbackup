// Tests for metricsActions: getEntityMetricsAction and getBatchMetricsAction.
// Uses manual middleware (NOT adminAction factory), getBatchMetricsAction uses dynamic import.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseChainMock, createTableAwareMock, TEST_UUIDS } from '@evolution/testing/service-test-mocks';

// ─── Mocks (must be before imports of modules under test) ────

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@evolution/lib/metrics/recomputeMetrics', () => ({
  recomputeStaleMetrics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@evolution/lib/metrics/readMetrics', () => ({
  getMetricsForEntities: jest.fn(),
}));

import { getEntityMetricsAction, getBatchMetricsAction } from './metricsActions';
import { recomputeStaleMetrics } from '@evolution/lib/metrics/recomputeMetrics';
import { getMetricsForEntities } from '@evolution/lib/metrics/readMetrics';

const VALID_UUID = TEST_UUIDS.uuid1;
const VALID_UUID_2 = TEST_UUIDS.uuid2;

const MOCK_METRIC = {
  id: 'metric-1',
  entity_type: 'run',
  entity_id: VALID_UUID,
  metric_name: 'cost',
  value: 2.5,
  stale: false,
  computed_at: '2026-03-01T12:00:00Z',
};

const MOCK_STALE_METRIC = {
  ...MOCK_METRIC,
  id: 'metric-2',
  metric_name: 'winner_elo',
  value: 1500,
  stale: true,
};

describe('metricsActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── getEntityMetricsAction ──────────────────────────────────

  describe('getEntityMetricsAction', () => {
    it('returns metrics for a valid entity', async () => {
      const metrics = [MOCK_METRIC];
      mockSupabase = createSupabaseChainMock({ data: metrics, error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      const result = await getEntityMetricsAction('run', VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(metrics);
      expect(result.error).toBeNull();
    });

    it('calls requireAdmin', async () => {
      mockSupabase = createSupabaseChainMock({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      await getEntityMetricsAction('run', VALID_UUID);

      expect(requireAdmin).toHaveBeenCalled();
    });

    it('rejects invalid entity type', async () => {
      const result = await getEntityMetricsAction('invalid_type', VALID_UUID);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('rejects invalid UUID', async () => {
      const result = await getEntityMetricsAction('run', 'not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('returns error on Supabase query failure', async () => {
      mockSupabase = createSupabaseChainMock({ data: null, error: { message: 'DB error' } });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      const result = await getEntityMetricsAction('run', VALID_UUID);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('returns empty array when no metrics exist', async () => {
      mockSupabase = createSupabaseChainMock({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      const result = await getEntityMetricsAction('run', VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    describe('stale metrics recomputation', () => {
      it('triggers recomputation for stale metrics', async () => {
        const staleMetrics = [MOCK_STALE_METRIC];
        const freshMetrics = [{ ...MOCK_STALE_METRIC, stale: false, value: 1600 }];

        // First query returns stale, second returns fresh
        const mock = createTableAwareMock([
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: staleMetrics, error: null }),
            );
          },
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: freshMetrics, error: null }),
            );
          },
        ]);
        (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

        const result = await getEntityMetricsAction('run', VALID_UUID);

        expect(recomputeStaleMetrics).toHaveBeenCalledWith(
          mock, 'run', VALID_UUID, staleMetrics,
        );
        expect(result.success).toBe(true);
        expect(result.data).toEqual(freshMetrics);
      });

      it('does not recompute when no stale metrics', async () => {
        const freshMetrics = [MOCK_METRIC];
        mockSupabase = createSupabaseChainMock({ data: freshMetrics, error: null });
        (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

        await getEntityMetricsAction('run', VALID_UUID);

        expect(recomputeStaleMetrics).not.toHaveBeenCalled();
      });

      it('returns error if re-read after recomputation fails', async () => {
        const staleMetrics = [MOCK_STALE_METRIC];

        const mock = createTableAwareMock([
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: staleMetrics, error: null }),
            );
          },
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: null, error: { message: 'Re-read failed' } }),
            );
          },
        ]);
        (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

        const result = await getEntityMetricsAction('run', VALID_UUID);

        expect(result.success).toBe(false);
        expect(result.error).not.toBeNull();
      });

      it('handles mix of stale and fresh metrics', async () => {
        const mixedMetrics = [MOCK_METRIC, MOCK_STALE_METRIC];
        const freshMetrics = [MOCK_METRIC, { ...MOCK_STALE_METRIC, stale: false }];

        const mock = createTableAwareMock([
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: mixedMetrics, error: null }),
            );
          },
          (b) => {
            b.then = jest.fn((resolve: (v: unknown) => void) =>
              resolve({ data: freshMetrics, error: null }),
            );
          },
        ]);
        (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

        const result = await getEntityMetricsAction('run', VALID_UUID);

        expect(recomputeStaleMetrics).toHaveBeenCalledWith(
          mock, 'run', VALID_UUID, [MOCK_STALE_METRIC],
        );
        expect(result.success).toBe(true);
      });
    });

    it('handles all valid entity types', async () => {
      mockSupabase = createSupabaseChainMock({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      for (const entityType of ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt']) {
        const result = await getEntityMetricsAction(entityType, VALID_UUID);
        expect(result.success).toBe(true);
      }
    });

    it('returns error when requireAdmin throws', async () => {
      (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('Unauthorized'));

      const result = await getEntityMetricsAction('run', VALID_UUID);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('queries evolution_metrics table with correct filters', async () => {
      mockSupabase = createSupabaseChainMock({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

      await getEntityMetricsAction('strategy', VALID_UUID);

      expect(mockSupabase.from).toHaveBeenCalledWith('evolution_metrics');
    });
  });

  // ─── getBatchMetricsAction ───────────────────────────────────

  describe('getBatchMetricsAction', () => {
    it('returns metrics grouped by entity ID', async () => {
      const metricsMap = new Map([
        [VALID_UUID, [MOCK_METRIC]],
        [VALID_UUID_2, [{ ...MOCK_METRIC, entity_id: VALID_UUID_2 }]],
      ]);
      (getMetricsForEntities as jest.Mock).mockResolvedValue(metricsMap);

      const result = await getBatchMetricsAction(
        'run',
        [VALID_UUID, VALID_UUID_2],
        ['cost'],
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        [VALID_UUID]: [MOCK_METRIC],
        [VALID_UUID_2]: [{ ...MOCK_METRIC, entity_id: VALID_UUID_2 }],
      });
    });

    it('calls requireAdmin', async () => {
      (getMetricsForEntities as jest.Mock).mockResolvedValue(new Map());

      await getBatchMetricsAction('run', [VALID_UUID], ['cost']);

      expect(requireAdmin).toHaveBeenCalled();
    });

    it('returns empty object for empty entityIds', async () => {
      const result = await getBatchMetricsAction('run', [], ['cost']);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
      expect(getMetricsForEntities).not.toHaveBeenCalled();
    });

    it('returns empty object for empty metricNames', async () => {
      const result = await getBatchMetricsAction('run', [VALID_UUID], []);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
      expect(getMetricsForEntities).not.toHaveBeenCalled();
    });

    it('rejects invalid entity type', async () => {
      const result = await getBatchMetricsAction('invalid', [VALID_UUID], ['cost']);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('passes correct arguments to getMetricsForEntities', async () => {
      (getMetricsForEntities as jest.Mock).mockResolvedValue(new Map());

      await getBatchMetricsAction('strategy', [VALID_UUID, VALID_UUID_2], ['cost', 'run_count']);

      expect(getMetricsForEntities).toHaveBeenCalledWith(
        expect.anything(), 'strategy', [VALID_UUID, VALID_UUID_2], ['cost', 'run_count'],
      );
    });

    it('converts Map to Record in response', async () => {
      const metricsMap = new Map([
        [VALID_UUID, [MOCK_METRIC]],
      ]);
      (getMetricsForEntities as jest.Mock).mockResolvedValue(metricsMap);

      const result = await getBatchMetricsAction('run', [VALID_UUID], ['cost']);

      expect(result.data).not.toBeInstanceOf(Map);
      expect(typeof result.data).toBe('object');
    });

    it('returns error when getMetricsForEntities throws', async () => {
      (getMetricsForEntities as jest.Mock).mockRejectedValue(new Error('batch query failed'));

      const result = await getBatchMetricsAction('run', [VALID_UUID], ['cost']);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('returns error when requireAdmin throws', async () => {
      (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('Unauthorized'));

      const result = await getBatchMetricsAction('run', [VALID_UUID], ['cost']);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it('handles single entity with multiple metrics', async () => {
      const metricsMap = new Map([
        [VALID_UUID, [MOCK_METRIC, { ...MOCK_METRIC, metric_name: 'winner_elo', value: 1500 }]],
      ]);
      (getMetricsForEntities as jest.Mock).mockResolvedValue(metricsMap);

      const result = await getBatchMetricsAction('run', [VALID_UUID], ['cost', 'winner_elo']);

      expect(result.success).toBe(true);
      expect(result.data![VALID_UUID]).toHaveLength(2);
    });

    it('handles all valid entity types', async () => {
      (getMetricsForEntities as jest.Mock).mockResolvedValue(new Map());

      for (const entityType of ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt']) {
        const result = await getBatchMetricsAction(entityType, [VALID_UUID], ['cost']);
        expect(result.success).toBe(true);
      }
    });
  });
});
