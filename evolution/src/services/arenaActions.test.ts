// Tests for arena server actions: topic CRUD, entry listing, and entry detail.
// Verifies V2 schema (elo_rating on entries directly, no separate elo table).

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
} from './arenaActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

const MOCK_TOPIC = {
  id: VALID_UUID,
  prompt: 'Explain photosynthesis to a 5-year-old.',
  title: 'Photosynthesis Explainer',
  status: 'active' as const,
  created_at: '2026-03-01T09:00:00Z',
};

const MOCK_ENTRY = {
  id: VALID_UUID_2,
  prompt_id: VALID_UUID,
  run_id: null,
  variant_id: null,
  content: 'Plants use sunlight to make food.',
  generation_method: 'manual',
  model: null,
  cost_usd: null,
  elo_rating: 1200,
  mu: 1200,
  sigma: 100,
  match_count: 0,
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
        // evolution_arena_entries (count)
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
      expect(result.data![0].entry_count).toBe(2);
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
    it('returns topic detail by id', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_TOPIC, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaTopicDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.title).toBe('Photosynthesis Explainer');
    });

    it('rejects invalid topicId', async () => {
      const result = await getArenaTopicDetailAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid topicId');
    });

    it('returns error when topic not found', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found', code: 'PGRST116' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

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
        title: 'Photosynthesis Explainer',
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
        title: 'Duplicate',
      });

      expect(result.success).toBe(false);
    });

    it('rejects input with empty title', async () => {
      const result = await createArenaTopicAction({
        prompt: 'Valid prompt text here.',
        title: '',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── getArenaEntriesAction ───────────────────────────────────

  describe('getArenaEntriesAction', () => {
    it('returns entries sorted by elo_rating', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_ENTRY], error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].elo_rating).toBe(1200);
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
          resolve({ data: null, error: { message: 'query failed' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getArenaEntriesAction({ topicId: VALID_UUID });

      expect(result.success).toBe(false);
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
      expect(result.data!.elo_rating).toBe(1200);
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

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        getArenaTopicsAction(undefined),
        getArenaTopicDetailAction(VALID_UUID),
        createArenaTopicAction({ prompt: 'Some prompt', title: 'Test' }),
        getArenaEntriesAction({ topicId: VALID_UUID }),
        getArenaEntryDetailAction(VALID_UUID_2),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
