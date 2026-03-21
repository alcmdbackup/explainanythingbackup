// Tests for variant detail server actions: full detail, parents, children, and lineage chain.
// Verifies V2 schema (no elo_attribution, uses parent_variant_id for lineage traversal).

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

import {
  getVariantFullDetailAction,
  getVariantParentsAction,
  getVariantChildrenAction,
  getVariantLineageChainAction,
} from './variantDetailActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_3 = '770e8400-e29b-41d4-a716-446655440002';

const MOCK_VARIANT = {
  id: VALID_UUID,
  run_id: VALID_UUID_2,
  explanation_id: null,
  variant_content: 'This is the variant text explaining something clearly.',
  elo_score: 1300,
  generation: 2,
  agent_name: 'mutator',
  match_count: 8,
  is_winner: true,
  parent_variant_id: VALID_UUID_3,
  created_at: '2026-03-01T11:00:00Z',
};

describe('variantDetailActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── getVariantFullDetailAction ──────────────────────────────

  describe('getVariantFullDetailAction', () => {
    it('returns assembled variant full detail with run info', async () => {
      const mock = createTableAwareMock([
        // evolution_variants single
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: MOCK_VARIANT, error: null });
        },
        // evolution_runs single (for run status)
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { status: 'completed', created_at: '2026-03-01T10:00:00Z' },
            error: null,
          });
        },
        // explanations — skipped because explanation_id is null (Promise.resolve)
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantFullDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.runId).toBe(VALID_UUID_2);
      expect(result.data!.runStatus).toBe('completed');
      expect(result.data!.eloScore).toBe(1300);
      expect(result.data!.isWinner).toBe(true);
      expect(result.data!.parentVariantId).toBe(VALID_UUID_3);
    });

    it('rejects invalid variantId', async () => {
      const result = await getVariantFullDetailAction('bad-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid variantId');
    });

    it('returns error when variant not found', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Row not found', code: 'PGRST116' },
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantFullDetailAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── getVariantParentsAction ─────────────────────────────────

  describe('getVariantParentsAction', () => {
    it('returns parent variant as VariantRelative', async () => {
      const parentVariant = {
        id: VALID_UUID_3,
        elo_score: 1200,
        generation: 1,
        agent_name: 'seed',
        is_winner: false,
        variant_content: 'Parent variant content here for preview',
      };

      const mock = createTableAwareMock([
        // fetch variant to get parent_variant_id
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_id: VALID_UUID_3 },
            error: null,
          });
        },
        // fetch parent variant
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: parentVariant, error: null });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantParentsAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe(VALID_UUID_3);
      expect(result.data![0].eloScore).toBe(1200);
    });

    it('returns empty array when variant has no parent', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_id: null },
            error: null,
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantParentsAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('rejects invalid variantId', async () => {
      const result = await getVariantParentsAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid variantId');
    });
  });

  // ─── getVariantChildrenAction ────────────────────────────────

  describe('getVariantChildrenAction', () => {
    it('returns children sorted by elo_score', async () => {
      const children = [
        {
          id: VALID_UUID_2,
          elo_score: 1350,
          generation: 3,
          agent_name: 'improver',
          is_winner: true,
          variant_content: 'Child variant content that was improved',
        },
      ];
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: children, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getVariantChildrenAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe(VALID_UUID_2);
      expect(result.data![0].eloScore).toBe(1350);
      expect(result.data![0].preview).toHaveLength(children[0].variant_content.length);
    });

    it('rejects invalid variantId', async () => {
      const result = await getVariantChildrenAction('bad');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid variantId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getVariantChildrenAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── getVariantLineageChainAction ────────────────────────────

  describe('getVariantLineageChainAction', () => {
    it('walks lineage chain up to root', async () => {
      const grandparent = {
        id: VALID_UUID_2,
        agent_name: 'seed',
        generation: 0,
        elo_score: 1100,
        variant_content: 'Grandparent content here',
        parent_variant_id: null,
      };
      const parent = {
        id: VALID_UUID_3,
        agent_name: 'mutator',
        generation: 1,
        elo_score: 1200,
        variant_content: 'Parent variant content',
        parent_variant_id: VALID_UUID_2,
      };

      const mock = createTableAwareMock([
        // fetch variant to get its parent_variant_id
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_id: VALID_UUID_3 },
            error: null,
          });
        },
        // fetch VALID_UUID_3 (parent)
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: parent, error: null });
        },
        // fetch VALID_UUID_2 (grandparent)
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: grandparent, error: null });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantLineageChainAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].id).toBe(VALID_UUID_3);
      expect(result.data![1].id).toBe(VALID_UUID_2);
    });

    it('returns empty array when variant has no parent', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_id: null },
            error: null,
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantLineageChainAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('rejects invalid variantId', async () => {
      const result = await getVariantLineageChainAction('not-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid variantId');
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        getVariantFullDetailAction(VALID_UUID),
        getVariantParentsAction(VALID_UUID),
        getVariantChildrenAction(VALID_UUID),
        getVariantLineageChainAction(VALID_UUID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
