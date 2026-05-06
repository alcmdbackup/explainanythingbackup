// Tests for arena server actions: topic CRUD, entry listing, and entry detail.
// Verifies V2 schema (elo_score on variants directly, no separate elo table).

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
  getArenaTopicsAction,
  getArenaTopicDetailAction,
  createArenaTopicAction,
  getArenaEntriesAction,
  getArenaEntryDetailAction,
  getArenaComparisonsAction,
  archiveArenaTopicAction,
  listPromptsAction,
  getPromptDetailAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  deletePromptAction,
} from './arenaActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

const MOCK_TOPIC = {
  id: VALID_UUID,
  prompt: 'Explain photosynthesis to a 5-year-old.',
  name: 'Photosynthesis Explainer',
  status: 'active' as const,
  created_at: '2026-03-01T09:00:00Z',
};

const MOCK_ENTRY = {
  id: VALID_UUID_2,
  prompt_id: VALID_UUID,
  run_id: null,
  variant_content: 'Plants use sunlight to make food.',
  synced_to_arena: true,
  generation_method: 'manual',
  model: null,
  cost_usd: null,
  elo_score: 1200,
  mu: 1200,
  sigma: 100,
  arena_match_count: 0,
  archived_at: null,
  created_at: '2026-03-01T09:30:00Z',
};

describe('arenaActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── getArenaTopicsAction ────────────────────────────────────

  describe('getArenaTopicsAction', () => {
    it('returns topics with entry counts', async () => {
      const entries = [
        { prompt_id: VALID_UUID },
        { prompt_id: VALID_UUID },
      ];

      const mock = createTableAwareMock([
        // evolution_prompts
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [MOCK_TOPIC], error: null })
          );
        },
        // evolution_variants (arena entry count)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: entries, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicsAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.entry_count).toBe(2);
    });

    it('returns error on DB failure', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: 'connection timeout' } })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicsAction(undefined);

      expect(result.success).toBe(false);
    });

    it('filters by status when provided', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicsAction({ status: 'archived' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── getArenaTopicDetailAction ───────────────────────────────

  describe('getArenaTopicDetailAction', () => {
    it('returns topic detail with seedVariant=null when no seed exists', async () => {
      const mock = createTableAwareMock([
        // evolution_prompts
        (b) => {
          b.single!.mockResolvedValueOnce({ data: MOCK_TOPIC, error: null });
        },
        // evolution_variants (seed lookup)
        (b) => {
          b.maybeSingle!.mockResolvedValueOnce({ data: null, error: null });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.name).toBe('Photosynthesis Explainer');
      expect(result.data!.seedVariant).toBeNull();
    });

    // UX 3 (20260421): seed panel data source. getArenaTopicDetailAction is the
    // single source of truth for the topic's seed variant — NOT the paginated
    // leaderboard. Sourcing the seed from the paginated entries would silently
    // hide the panel when the seed doesn't fit on page 1.
    it('returns seedVariant populated when a generation_method=seed row exists', async () => {
      const seedRow = {
        id: '770e8400-e29b-41d4-a716-446655440002',
        prompt_id: VALID_UUID,
        run_id: '880e8400-e29b-41d4-a716-446655440003',
        variant_content: '# Seed article title\n\nBody text...',
        synced_to_arena: true,
        generation_method: 'seed',
        model: null,
        cost_usd: 0.01,
        elo_score: 1200,
        mu: 25,
        sigma: 8.333,
        arena_match_count: 3,
        archived_at: null,
        created_at: '2026-03-01T10:00:00Z',
        generation: 0,
        parent_variant_id: null,
      };
      const mock = createTableAwareMock([
        (b) => { b.single!.mockResolvedValueOnce({ data: MOCK_TOPIC, error: null }); },
        (b) => { b.maybeSingle!.mockResolvedValueOnce({ data: seedRow, error: null }); },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.seedVariant).not.toBeNull();
      expect(result.data!.seedVariant!.id).toBe(seedRow.id);
      expect(result.data!.seedVariant!.is_seed).toBe(true);
      expect(result.data!.seedVariant!.generation_method).toBe('seed');
    });

    // Legacy pre-EVOLUTION_REUSE_SEED_RATING=true data may have multiple seed
    // rows per prompt. The action's ORDER BY elo_score DESC LIMIT 1 (secondary
    // created_at ASC) ensures we always pick the highest-Elo row deterministically.
    // Verified here by ensuring ordering chain methods are invoked with the
    // expected arguments.
    it('orders multi-seed lookups by elo_score DESC then created_at ASC (legacy tiebreak)', async () => {
      const orderCalls: Array<[string, { ascending: boolean }]> = [];
      const mock = createTableAwareMock([
        (b) => { b.single!.mockResolvedValueOnce({ data: MOCK_TOPIC, error: null }); },
        (b) => {
          const origOrder = b.order!;
          b.order = jest.fn((col: string, opts: { ascending: boolean }) => {
            orderCalls.push([col, opts]);
            return origOrder(col, opts);
          });
          b.maybeSingle!.mockResolvedValueOnce({ data: null, error: null });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getArenaTopicDetailAction(VALID_UUID);

      expect(orderCalls).toContainEqual(['elo_score', { ascending: false }]);
      expect(orderCalls).toContainEqual(['created_at', { ascending: true }]);
    });

    it('rejects invalid topicId', async () => {
      const result = await getArenaTopicDetailAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid topicId');
    });

    it('returns error when topic not found', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single!.mockResolvedValueOnce({
            data: null,
            error: { message: 'Not found', code: 'PGRST116' },
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicDetailAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── createArenaTopicAction ──────────────────────────────────

  describe('createArenaTopicAction', () => {
    it('creates a topic and returns it', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_TOPIC, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createArenaTopicAction({
        prompt: 'Explain photosynthesis to a 5-year-old.',
        name: 'Photosynthesis Explainer',
      });

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
    });

    it('returns error when DB insert fails', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'duplicate key' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createArenaTopicAction({
        prompt: 'Some prompt text',
        name: 'Duplicate',
      });

      expect(result.success).toBe(false);
    });

    it('rejects input with empty name', async () => {
      const result = await createArenaTopicAction({
        prompt: 'Valid prompt text here.',
        name: '',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── getArenaEntriesAction ───────────────────────────────────

  describe('getArenaEntriesAction', () => {
    it('returns entries sorted by elo_score with total count', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_ENTRY], count: 1, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.items[0]!.elo_score).toBe(1200);
      expect(result.data!.total).toBe(1);
    });

    it('rejects invalid topicId', async () => {
      const result = await getArenaEntriesAction({ topicId: 'bad-id' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid topicId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, count: null, error: { message: 'query failed' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(false);
    });

    // Phase 3 (track_tactic_effectiveness_evolution_20260422): tactic projection.
    it('projects agent_name from raw DB row through toArenaEntry', async () => {
      const entryWithAgent = { ...MOCK_ENTRY, agent_name: 'structural_transform' };
      const variantsChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [entryWithAgent], count: 1, error: null })
        ),
      };
      const tacticsChain = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [{ id: 'tactic-uuid-1', name: 'structural_transform' }], error: null }),
      };
      mockSupabase.from = jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_tactics') return tacticsChain;
        return variantsChain;
      });

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data!.items[0]!.agent_name).toBe('structural_transform');
      expect(result.data!.items[0]!.tactic_id).toBe('tactic-uuid-1');
    });

    it('leaves agent_name/tactic_id null when DB row has no agent_name (seed/manual)', async () => {
      const entryNoAgent = { ...MOCK_ENTRY, agent_name: null };
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [entryNoAgent], count: 1, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data!.items[0]!.agent_name).toBeNull();
      expect(result.data!.items[0]!.tactic_id).toBeNull();
    });

    it('tactic_id stays null when agent_name has no matching evolution_tactics row (legacy name)', async () => {
      const entryUnknownAgent = { ...MOCK_ENTRY, agent_name: 'legacy_deprecated_tactic' };
      const variantsChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [entryUnknownAgent], count: 1, error: null })
        ),
      };
      const tacticsChain = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.from = jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_tactics') return tacticsChain;
        return variantsChain;
      });

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data!.items[0]!.agent_name).toBe('legacy_deprecated_tactic');
      expect(result.data!.items[0]!.tactic_id).toBeNull();
    });
  });

  // ─── getArenaEntryDetailAction ───────────────────────────────

  describe('getArenaEntryDetailAction', () => {
    it('returns entry detail by id', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_ENTRY, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntryDetailAction(VALID_UUID_2);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID_2);
      expect(result.data!.elo_score).toBe(1200);
    });

    it('rejects invalid entryId', async () => {
      const result = await getArenaEntryDetailAction('not-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid entryId');
    });

    it('returns error when entry not found', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found', code: 'PGRST116' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntryDetailAction(VALID_UUID_2);

      expect(result.success).toBe(false);
    });
  });

  // ─── getArenaTopicsAction filterTestContent ─────────────────

  describe('getArenaTopicsAction filterTestContent', () => {
    it('filters test content when filterTestContent is true', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getArenaTopicsAction({ filterTestContent: true });

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('evolution_prompts');
    });
  });

  // ─── listPromptsAction ────────────────────────────────────

  describe('listPromptsAction', () => {
    it('calls .not() when filterTestContent is true', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listPromptsAction({ limit: 20, offset: 0, filterTestContent: true });

      expect(result.success).toBe(true);
      // Phase 1 (use_playwright_find_bugs_ux_issues_20260422): switched to
      // applyTestContentColumnFilter (.eq('is_test_content', false)).
      expect(chain.eq).toHaveBeenCalledWith('is_test_content', false);
    });

    it('does not call the column filter when filterTestContent is false', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listPromptsAction({ limit: 20, offset: 0, filterTestContent: false });

      expect(result.success).toBe(true);
      expect(chain.eq).not.toHaveBeenCalledWith('is_test_content', expect.anything());
    });
  });

  // ─── getArenaComparisonsAction ──────────────────────────────

  describe('getArenaComparisonsAction', () => {
    it('returns comparisons for a topic', async () => {
      const mockComparison = {
        id: VALID_UUID_2,
        prompt_id: VALID_UUID,
        entry_a: '111e8400-e29b-41d4-a716-446655440000',
        entry_b: '222e8400-e29b-41d4-a716-446655440000',
        winner: 'a',
        confidence: 0.85,
        run_id: null,
        status: 'completed',
        created_at: '2026-03-01T10:00:00Z',
      };
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [mockComparison], error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaComparisonsAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.winner).toBe('a');
    });

    it('rejects invalid topicId', async () => {
      const result = await getArenaComparisonsAction({ topicId: 'bad-id' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid topicId');
    });
  });

  // ─── archiveArenaTopicAction ──────────────────────────────────

  describe('archiveArenaTopicAction', () => {
    it('archives a topic successfully', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archiveArenaTopicAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ archived: true });
    });

    it('rejects invalid topicId', async () => {
      const result = await archiveArenaTopicAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid topicId');
    });
  });

  // ─── getPromptDetailAction ────────────────────────────────────

  describe('getPromptDetailAction', () => {
    it('returns prompt detail by id', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_TOPIC, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getPromptDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
    });

    it('rejects invalid promptId', async () => {
      const result = await getPromptDetailAction('bad-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
    });
  });

  // ─── createPromptAction ───────────────────────────────────────

  describe('createPromptAction', () => {
    it('creates a prompt and returns it', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_TOPIC, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createPromptAction({ name: 'New Prompt', prompt: 'Explain gravity.' });

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
    });

    it('rejects empty prompt text', async () => {
      const result = await createPromptAction({ name: 'Valid Name', prompt: '' });

      expect(result.success).toBe(false);
    });
  });

  // ─── updatePromptAction ───────────────────────────────────────

  describe('updatePromptAction', () => {
    it('updates a prompt name', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { ...MOCK_TOPIC, name: 'Updated' }, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await updatePromptAction({ id: VALID_UUID, name: 'Updated' });

      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Updated');
    });

    it('rejects when no fields to update', async () => {
      const result = await updatePromptAction({ id: VALID_UUID });

      expect(result.success).toBe(false);
    });
  });

  // ─── deletePromptAction ───────────────────────────────────────

  describe('deletePromptAction', () => {
    it('soft-deletes a prompt', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await deletePromptAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ deleted: true });
    });

    it('rejects invalid promptId', async () => {
      const result = await deletePromptAction('bad');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        getArenaTopicsAction(undefined),
        getArenaTopicDetailAction(VALID_UUID),
        createArenaTopicAction({ prompt: 'Some prompt', name: 'Test' }),
        getArenaEntriesAction({ topicId: VALID_UUID }),
        getArenaEntryDetailAction(VALID_UUID_2),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
