// Tests for V2 strategy registry CRUD server actions: list, detail, create, update, clone, archive, delete.
// Verifies V2 schema (config JSONB, config_hash, pipeline_type, no phase column).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseChainMock, createTableAwareMock } from '@evolution/testing/service-test-mocks';

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

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@evolution/lib/pipeline/setup/findOrCreateStrategy', () => ({
  hashStrategyConfig: jest.fn().mockReturnValue('abc123hash'),
  labelStrategyConfig: jest.fn().mockReturnValue('Gen: test | Judge: test | 3 iters'),
}));

import {
  listStrategiesAction,
  getStrategyDetailAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  deleteStrategyAction,
} from './strategyRegistryActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

const MOCK_V2_CONFIG = {
  generationModel: 'claude-3-5-haiku-20241022',
  judgeModel: 'claude-3-5-sonnet-20241022',
  iterations: 5,
  strategiesPerRound: 3,
  budgetUsd: 2.0,
};

const MOCK_STRATEGY = {
  id: VALID_UUID,
  name: 'Alpha Strategy',
  label: 'Gen: claude-3-5-haiku-20241022 | Judge: claude-3-5-sonnet-20241022 | 5 iters',
  description: 'A solid V2 strategy for testing',
  config: MOCK_V2_CONFIG,
  config_hash: 'abc123hash',
  pipeline_type: 'full',
  status: 'active',
  created_by: 'test-admin-user-id',
  run_count: 3,
  total_cost_usd: 6.0,
  avg_final_elo: 1250,
  first_used_at: '2026-02-01T00:00:00Z',
  last_used_at: '2026-03-01T00:00:00Z',
  created_at: '2026-01-15T00:00:00Z',
};

describe('strategyRegistryActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── listStrategiesAction ────────────────────────────────────

  describe('listStrategiesAction', () => {
    it('returns paginated strategy list', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [MOCK_STRATEGY], error: null, count: 1 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listStrategiesAction({ limit: 20, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.total).toBe(1);
      expect(result.data!.items[0].config_hash).toBe('abc123hash');
    });

    it('filters by status when provided', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listStrategiesAction({ limit: 20, offset: 0, status: 'archived' });

      expect(result.success).toBe(true);
      expect(chain.eq).toHaveBeenCalledWith('status', 'archived');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' }, count: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listStrategiesAction({ limit: 20, offset: 0 });

      expect(result.success).toBe(false);
    });
  });

  describe('listStrategiesAction filterTestContent', () => {
    it('calls .not() when filterTestContent is true', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listStrategiesAction({ limit: 20, offset: 0, filterTestContent: true });

      expect(result.success).toBe(true);
      expect(chain.not).toHaveBeenCalledWith('name', 'ilike', '%[TEST]%');
    });

    it('does not call .not() when filterTestContent is false', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listStrategiesAction({ limit: 20, offset: 0, filterTestContent: false });

      expect(result.success).toBe(true);
      expect(chain.not).not.toHaveBeenCalled();
    });
  });

  // ─── getStrategyDetailAction ─────────────────────────────────

  describe('getStrategyDetailAction', () => {
    it('returns strategy detail by id', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_STRATEGY, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getStrategyDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.pipeline_type).toBe('full');
      expect(result.data!.config).toEqual(MOCK_V2_CONFIG);
    });

    it('rejects invalid strategyId', async () => {
      const result = await getStrategyDetailAction('bad-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid strategyId');
    });

    it('returns error when strategy not found', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found', code: 'PGRST116' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getStrategyDetailAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── createStrategyAction ────────────────────────────────────

  describe('createStrategyAction', () => {
    it('creates strategy with hashed config', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_STRATEGY, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createStrategyAction({
        name: 'Alpha Strategy',
        generationModel: 'claude-3-5-haiku-20241022',
        judgeModel: 'claude-3-5-sonnet-20241022',
        iterations: 5,
        strategiesPerRound: 3,
        budgetUsd: 2.0,
      });

      expect(result.success).toBe(true);
      expect(result.data!.config_hash).toBe('abc123hash');
      const inserted = (chain.insert as jest.Mock).mock.calls[0][0];
      expect(inserted.config_hash).toBe('abc123hash');
    });

    it('returns error on DB insert failure', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'unique constraint violation' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createStrategyAction({
        name: 'Dupe',
        generationModel: 'claude-3-5-haiku-20241022',
        judgeModel: 'claude-3-5-sonnet-20241022',
        iterations: 3,
      });

      expect(result.success).toBe(false);
    });

    it('rejects input that fails schema validation', async () => {
      const result = await createStrategyAction({
        name: '',
        generationModel: 'model',
        judgeModel: 'judge',
        iterations: 0, // min is 1
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── updateStrategyAction ────────────────────────────────────

  describe('updateStrategyAction', () => {
    it('updates strategy name', async () => {
      const updated = { ...MOCK_STRATEGY, name: 'Beta Strategy' };
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updated, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await updateStrategyAction({ id: VALID_UUID, name: 'Beta Strategy' });

      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Beta Strategy');
    });

    it('rejects when no fields provided', async () => {
      const result = await updateStrategyAction({ id: VALID_UUID });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('No fields to update');
    });

    it('returns error on DB update failure', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'record not found' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await updateStrategyAction({ id: VALID_UUID, name: 'New Name' });

      expect(result.success).toBe(false);
    });
  });

  // ─── cloneStrategyAction ─────────────────────────────────────

  describe('cloneStrategyAction', () => {
    it('clones source strategy with new name', async () => {
      const cloned = { ...MOCK_STRATEGY, id: VALID_UUID_2, name: 'Alpha Strategy Clone' };

      const mock = createTableAwareMock([
        // fetch source
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: MOCK_STRATEGY, error: null });
        },
        // insert clone
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: cloned, error: null });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await cloneStrategyAction({
        sourceId: VALID_UUID,
        newName: 'Alpha Strategy Clone',
      });

      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Alpha Strategy Clone');
    });

    it('rejects invalid sourceId', async () => {
      const result = await cloneStrategyAction({ sourceId: 'bad', newName: 'Clone' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid sourceId');
    });

    it('returns error when source strategy not found', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Not found' },
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await cloneStrategyAction({ sourceId: VALID_UUID, newName: 'Clone' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Source strategy not found');
    });
  });

  // ─── archiveStrategyAction ───────────────────────────────────

  describe('archiveStrategyAction', () => {
    it('sets status=archived on strategy', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        insert: jest.fn(() => Promise.resolve({ error: null })),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archiveStrategyAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ archived: true });
    });

    it('rejects invalid strategyId', async () => {
      const result = await archiveStrategyAction('not-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid strategyId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'update error' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archiveStrategyAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── deleteStrategyAction ────────────────────────────────────

  describe('deleteStrategyAction', () => {
    it('deletes strategy when no runs reference it', async () => {
      const mock = createTableAwareMock([
        // evolution_runs count check
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null, count: 0 })
          );
        },
        // evolution_strategies delete
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await deleteStrategyAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ deleted: true });
    });

    it('rejects deletion when runs reference the strategy', async () => {
      const mock = createTableAwareMock([
        // evolution_runs count check returns 2 runs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null, count: 2 })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await deleteStrategyAction(VALID_UUID);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot delete strategy with existing runs');
    });

    it('rejects invalid strategyId', async () => {
      const result = await deleteStrategyAction('bad-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid strategyId');
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        listStrategiesAction({ limit: 10, offset: 0 }),
        getStrategyDetailAction(VALID_UUID),
        archiveStrategyAction(VALID_UUID),
        deleteStrategyAction(VALID_UUID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
