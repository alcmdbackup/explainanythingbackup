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

import * as fs from 'fs';
import * as path from 'path';
import {
  getVariantFullDetailAction,
  getVariantParentsAction,
  getVariantChildrenAction,
  getVariantLineageChainAction,
  getVariantMatchHistoryAction,
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
  parent_variant_ids: [VALID_UUID_3],
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
            data: { parent_variant_ids: [VALID_UUID_3] },
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
      expect(result.data![0]!.id).toBe(VALID_UUID_3);
      expect(result.data![0]!.eloScore).toBe(1200);
    });

    it('returns empty array when variant has no parent', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_ids: [] },
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
        // PR 2: getVariantChildrenAction now uses .contains('parent_variant_ids', [variantId]).
        contains: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: children, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getVariantChildrenAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.id).toBe(VALID_UUID_2);
      expect(result.data![0]!.eloScore).toBe(1350);
      expect(result.data![0]!.preview).toHaveLength(children[0]!.variant_content.length);
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
        parent_variant_ids: [],
      };
      const parent = {
        id: VALID_UUID_3,
        agent_name: 'mutator',
        generation: 1,
        elo_score: 1200,
        variant_content: 'Parent variant content',
        parent_variant_ids: [VALID_UUID_2],
      };

      const mock = createTableAwareMock([
        // fetch variant to get its parent_variant_id
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_ids: [VALID_UUID_3] },
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
      expect(result.data![0]!.id).toBe(VALID_UUID_3);
      expect(result.data![1]!.id).toBe(VALID_UUID_2);
    });

    it('returns empty array when variant has no parent', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: { parent_variant_ids: [] },
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

  // ─── getVariantMatchHistoryAction ────────────────────────────

  describe('getVariantMatchHistoryAction', () => {
    const VARIANT = VALID_UUID;
    const OPP_1 = '111e8400-e29b-41d4-a716-446655441001';
    const OPP_2 = '222e8400-e29b-41d4-a716-446655441002';
    const OPP_3 = '333e8400-e29b-41d4-a716-446655441003';

    function makeMock(
      comparisons: Array<Record<string, unknown>>,
      opponents: Array<Record<string, unknown>>,
      orFn?: jest.Mock,
    ): ReturnType<typeof createSupabaseChainMock> {
      const compChain = {
        select: jest.fn().mockReturnThis(),
        or: orFn ?? jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: comparisons, error: null }),
      };
      const oppChain = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: opponents, error: null }),
      };
      const fromMock = jest.fn((table: string) => {
        if (table === 'evolution_arena_comparisons') return compChain;
        if (table === 'evolution_variants') return oppChain;
        throw new Error(`Unexpected from(${table})`);
      });
      return { from: fromMock } as unknown as ReturnType<typeof createSupabaseChainMock>;
    }

    it('returns match entries with won=true when winner side matches variant side (entry_a)', async () => {
      const mock = makeMock(
        [
          { id: 'c1', entry_a: VARIANT, entry_b: OPP_1, winner: 'a', confidence: 0.9 },
          { id: 'c2', entry_a: VARIANT, entry_b: OPP_2, winner: 'b', confidence: 0.85 },
        ],
        [
          { id: OPP_1, mu: 25, sigma: 8.333, elo_score: 1200 },
          { id: OPP_2, mu: 27, sigma: 7, elo_score: 1280 },
        ],
      );
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantMatchHistoryAction(VARIANT);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      // entry_a + winner=a → won
      expect(result.data![0]!.opponentId).toBe(OPP_1);
      expect(result.data![0]!.won).toBe(true);
      expect(result.data![0]!.confidence).toBe(0.9);
      // entry_a + winner=b → lost
      expect(result.data![1]!.opponentId).toBe(OPP_2);
      expect(result.data![1]!.won).toBe(false);
    });

    it('inverts won correctly when variant is on entry_b side', async () => {
      const mock = makeMock(
        [
          { id: 'c1', entry_a: OPP_1, entry_b: VARIANT, winner: 'a', confidence: 0.7 },
          { id: 'c2', entry_a: OPP_2, entry_b: VARIANT, winner: 'b', confidence: 0.95 },
        ],
        [
          { id: OPP_1, mu: 25, sigma: 8, elo_score: 1200 },
          { id: OPP_2, mu: 25, sigma: 8, elo_score: 1190 },
        ],
      );
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantMatchHistoryAction(VARIANT);
      expect(result.success).toBe(true);
      // entry_b + winner=a → variant lost
      expect(result.data![0]!.opponentId).toBe(OPP_1);
      expect(result.data![0]!.won).toBe(false);
      // entry_b + winner=b → variant won
      expect(result.data![1]!.opponentId).toBe(OPP_2);
      expect(result.data![1]!.won).toBe(true);
    });

    it('treats draw as not-won (won=false on both sides)', async () => {
      const mock = makeMock(
        [
          { id: 'c1', entry_a: VARIANT, entry_b: OPP_1, winner: 'draw', confidence: 0.4 },
        ],
        [{ id: OPP_1, mu: 25, sigma: 8, elo_score: 1200 }],
      );
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantMatchHistoryAction(VARIANT);
      expect(result.success).toBe(true);
      expect(result.data![0]!.won).toBe(false);
    });

    it('returns empty array when no comparisons exist', async () => {
      const mock = makeMock([], []);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantMatchHistoryAction(VARIANT);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('handles orphan opponent (FK target deleted) — opponentElo null, no uncertainty', async () => {
      const mock = makeMock(
        [{ id: 'c1', entry_a: VARIANT, entry_b: OPP_3, winner: 'a', confidence: 0.8 }],
        [], // OPP_3 not present in opponents fetch
      );
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantMatchHistoryAction(VARIANT);
      expect(result.success).toBe(true);
      expect(result.data![0]!.opponentId).toBe(OPP_3);
      expect(result.data![0]!.opponentElo).toBeNull();
      expect(result.data![0]!.opponentUncertainty).toBeUndefined();
    });

    it('rejects invalid variantId', async () => {
      const result = await getVariantMatchHistoryAction('not-a-uuid');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid variantId');
    });

    // Guard A — call-site assertion: catches a future re-stub regression that
    // would otherwise pass a "mock returns 3 → action returns 3" check.
    it('Guard A: calls evolution_arena_comparisons with cross-column .or() filter', async () => {
      const orFn = jest.fn().mockReturnThis();
      const mock = makeMock(
        [{ id: 'c1', entry_a: VARIANT, entry_b: OPP_1, winner: 'a', confidence: 0.9 }],
        [{ id: OPP_1, mu: 25, sigma: 8, elo_score: 1200 }],
        orFn,
      );
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getVariantMatchHistoryAction(VARIANT);

      expect(mock.from).toHaveBeenCalledWith('evolution_arena_comparisons');
      expect(mock.from).toHaveBeenCalledWith('evolution_variants');
      expect(orFn).toHaveBeenCalledWith(
        expect.stringMatching(/^entry_a\.eq\.[0-9a-f-]+,entry_b\.eq\.[0-9a-f-]+$/),
      );
    });
  });

  // ─── getVariantFullDetailAction — Producing Invocation (Issue 3) ─────────

  describe('getVariantFullDetailAction with agent_invocation_id', () => {
    it('returns agentInvocationId + agentInvocationName when embedded JOIN populated', async () => {
      const variantWithInv = {
        ...MOCK_VARIANT,
        evolution_agent_invocations: {
          id: 'inv-uuid-1111-2222-3333-444444444444',
          agent_name: 'reflect_and_generate_from_previous_article',
        },
      };
      const mock = createTableAwareMock([
        (b) => { b.single = jest.fn().mockResolvedValue({ data: variantWithInv, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { status: 'completed', created_at: '2026-03-01T10:00:00Z' }, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { mu: 25, sigma: 8, elo_score: 1200, run_id: VALID_UUID_2 }, error: null }); },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantFullDetailAction(VALID_UUID);
      expect(result.success).toBe(true);
      expect(result.data!.agentInvocationId).toBe('inv-uuid-1111-2222-3333-444444444444');
      expect(result.data!.agentInvocationName).toBe('reflect_and_generate_from_previous_article');
    });

    it('returns null fields when embedded invocation is null (legacy variant)', async () => {
      const variantNoInv = {
        ...MOCK_VARIANT,
        evolution_agent_invocations: null,
      };
      const mock = createTableAwareMock([
        (b) => { b.single = jest.fn().mockResolvedValue({ data: variantNoInv, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { status: 'completed', created_at: '2026-03-01T10:00:00Z' }, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { mu: 25, sigma: 8, elo_score: 1200, run_id: VALID_UUID_2 }, error: null }); },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantFullDetailAction(VALID_UUID);
      expect(result.success).toBe(true);
      // Guard E (defensive): keys ALWAYS present; values null when absent.
      expect(result.data).toHaveProperty('agentInvocationId', null);
      expect(result.data).toHaveProperty('agentInvocationName', null);
    });

    it('handles array-shape embedded result (PostgREST may return 1-element array)', async () => {
      const variantArrayInv = {
        ...MOCK_VARIANT,
        evolution_agent_invocations: [
          { id: 'inv-array-shape-uuid', agent_name: 'generate_from_previous_article' },
        ],
      };
      const mock = createTableAwareMock([
        (b) => { b.single = jest.fn().mockResolvedValue({ data: variantArrayInv, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { status: 'completed', created_at: '2026-03-01T10:00:00Z' }, error: null }); },
        (b) => { b.single = jest.fn().mockResolvedValue({ data: { mu: 25, sigma: 8, elo_score: 1200, run_id: VALID_UUID_2 }, error: null }); },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getVariantFullDetailAction(VALID_UUID);
      expect(result.success).toBe(true);
      expect(result.data!.agentInvocationId).toBe('inv-array-shape-uuid');
      expect(result.data!.agentInvocationName).toBe('generate_from_previous_article');
    });
  });

  // ─── Guard F — Code-comment / stub regression guard ───────────────────────
  // Original Issue 1 root cause was a stale code comment in
  // getVariantMatchHistoryAction claiming "match history not persisted per-variant".
  // Asserts the source no longer carries that misleading claim.

  describe('Guard F — no stale stub claims in source', () => {
    it('variantDetailActions.ts source does not contain stale-claim substrings', () => {
      const sourcePath = path.join(__dirname, 'variantDetailActions.ts');
      const source = fs.readFileSync(sourcePath, 'utf8');
      // The original stub had: "match history not persisted per-variant"
      expect(source).not.toMatch(/match history not persisted/i);
      // and: "aggregated in run_summary JSONB" (in the same comment).
      expect(source).not.toMatch(/aggregated in run_summary/i);
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
        getVariantMatchHistoryAction(VALID_UUID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
