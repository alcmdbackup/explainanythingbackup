// Tests for V2 prompt registry CRUD server actions: list, detail, create, update, archive, delete.
// Operates on evolution_arena_topics; verifies soft-delete and pagination behavior.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseChainMock } from '@evolution/testing/service-test-mocks';

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
  listPromptsAction,
  getPromptDetailAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  deletePromptAction,
} from './promptRegistryActionsV2';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_PROMPT = {
  id: VALID_UUID,
  prompt: 'Explain how vaccines work to someone skeptical about medicine.',
  title: 'Vaccine Skeptic Explainer',
  difficulty_tier: 'hard',
  domain_tags: ['health', 'science'],
  status: 'active' as const,
  deleted_at: null,
  archived_at: null,
  created_at: '2026-03-01T09:00:00Z',
};

describe('promptRegistryActionsV2', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── listPromptsAction ───────────────────────────────────────

  describe('listPromptsAction', () => {
    it('returns paginated prompt list excluding deleted', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [MOCK_PROMPT], error: null, count: 1 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listPromptsAction({ limit: 20, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.total).toBe(1);
      expect(result.data!.items[0].deleted_at).toBeNull();
    });

    it('filters by status when provided', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listPromptsAction({ limit: 20, offset: 0, status: 'archived' });

      expect(result.success).toBe(true);
      expect(chain.eq).toHaveBeenCalledWith('status', 'archived');
    });

    it('filters by difficulty_tier when provided', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      await listPromptsAction({ limit: 10, offset: 0, difficulty_tier: 'hard' });

      expect(chain.eq).toHaveBeenCalledWith('difficulty_tier', 'hard');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: null, error: { message: 'timeout' }, count: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listPromptsAction({ limit: 20, offset: 0 });

      expect(result.success).toBe(false);
    });
  });

  // ─── getPromptDetailAction ───────────────────────────────────

  describe('getPromptDetailAction', () => {
    it('returns prompt detail by id', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_PROMPT, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getPromptDetailAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.difficulty_tier).toBe('hard');
    });

    it('rejects invalid promptId', async () => {
      const result = await getPromptDetailAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
    });

    it('returns error when prompt not found', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found', code: 'PGRST116' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getPromptDetailAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── createPromptAction ──────────────────────────────────────

  describe('createPromptAction', () => {
    it('creates prompt and parses domain_tags from comma-separated string', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: MOCK_PROMPT, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createPromptAction({
        title: 'Vaccine Skeptic Explainer',
        prompt: 'Explain how vaccines work to someone skeptical about medicine.',
        difficulty_tier: 'hard',
        domain_tags: 'health, science',
      });

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      const inserted = (chain.insert as jest.Mock).mock.calls[0][0];
      expect(inserted.domain_tags).toEqual(['health', 'science']);
    });

    it('returns error on DB insert failure', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'insert failed' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await createPromptAction({
        title: 'Failing Prompt',
        prompt: 'This will fail on insert.',
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty title', async () => {
      const result = await createPromptAction({
        title: '',
        prompt: 'Some valid prompt text here.',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── updatePromptAction ──────────────────────────────────────

  describe('updatePromptAction', () => {
    it('updates prompt title and domain_tags', async () => {
      const updated = { ...MOCK_PROMPT, title: 'Updated Title', domain_tags: ['health'] };
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updated, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await updatePromptAction({
        id: VALID_UUID,
        title: 'Updated Title',
        domain_tags: 'health',
      });

      expect(result.success).toBe(true);
      expect(result.data!.title).toBe('Updated Title');
    });

    it('rejects when no update fields provided', async () => {
      const result = await updatePromptAction({ id: VALID_UUID });

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
          error: { message: 'update failed' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await updatePromptAction({ id: VALID_UUID, title: 'New Title' });

      expect(result.success).toBe(false);
    });
  });

  // ─── archivePromptAction ─────────────────────────────────────

  describe('archivePromptAction', () => {
    it('sets status=archived and archived_at on prompt', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archivePromptAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ archived: true });
    });

    it('rejects invalid promptId', async () => {
      const result = await archivePromptAction('bad');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
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

      const result = await archivePromptAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── deletePromptAction ──────────────────────────────────────

  describe('deletePromptAction', () => {
    it('soft-deletes prompt by setting deleted_at', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await deletePromptAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ deleted: true });
      // Verify soft delete (update not hard delete)
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_at: expect.any(String) }),
      );
    });

    it('rejects invalid promptId', async () => {
      const result = await deletePromptAction('not-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'delete failed' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await deletePromptAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        listPromptsAction({ limit: 10, offset: 0 }),
        getPromptDetailAction(VALID_UUID),
        createPromptAction({ title: 'Test', prompt: 'Valid prompt text.' }),
        archivePromptAction(VALID_UUID),
        deletePromptAction(VALID_UUID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
