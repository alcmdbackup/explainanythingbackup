/**
 * Unit tests for promptRegistryActions CRUD operations.
 * Mocks Supabase and adminAuth — verifies action logic without hitting DB.
 */

// ─── Supabase Mock ───────────────────────────────────────────────

/** Build a chainable Supabase-like mock that resolves to the given result at the end. */
function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
        // Make the chain thenable — resolves like a Supabase query
        return (resolve: (val: unknown) => void) => resolve(result);
      }
      if (!chain[prop as string]) {
        chain[prop as string] = jest.fn().mockReturnValue(new Proxy(chain, handler));
      }
      return chain[prop as string];
    },
  };
  return new Proxy(chain, handler);
}

let fromResults: Map<string, Array<{ data: unknown; error: unknown }>>;

const mockFrom = jest.fn().mockImplementation((table: string) => {
  const queue = fromResults.get(table) ?? [];
  const result = queue.shift() ?? { data: null, error: null };
  return createQueryChain(result);
});

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  serverReadRequestId: (fn: Function) => fn,
}));

jest.mock('@/lib/errorHandling', () => ({
  handleError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

// Import after mocks
import {
  getPromptsAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  unarchivePromptAction,
  deletePromptAction,
  getPromptTitleAction,
} from './promptRegistryActions';

// ─── Test Setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

/** Helper: queue Supabase result for a table. Multiple calls queue multiple results. */
function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

// ─── Tests ───────────────────────────────────────────────────────

describe('promptRegistryActions', () => {
  describe('getPromptsAction', () => {
    it('returns active prompts by default', async () => {
      queueResult('evolution_arena_topics', {
        data: [{
          id: 'p1', prompt: 'Test', title: null, difficulty_tier: null,
          domain_tags: [], status: 'active', deleted_at: null, created_at: '2026-01-01',
        }],
        error: null,
      });

      const result = await getPromptsAction();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].status).toBe('active');
      expect(mockFrom).toHaveBeenCalledWith('evolution_arena_topics');
    });

    it('normalizes null domain_tags to empty array', async () => {
      queueResult('evolution_arena_topics', {
        data: [{
          id: 'p1', prompt: 'Test', title: null, difficulty_tier: null,
          domain_tags: null, status: null, deleted_at: null, created_at: '2026-01-01',
        }],
        error: null,
      });

      const result = await getPromptsAction();

      expect(result.success).toBe(true);
      expect(result.data![0].domain_tags).toEqual([]);
      expect(result.data![0].status).toBe('active');
    });
  });

  describe('createPromptAction', () => {
    it('creates a new prompt with metadata', async () => {
      // Uniqueness check: no match
      queueResult('evolution_arena_topics', { data: null, error: null });
      // Insert returns new row
      queueResult('evolution_arena_topics', {
        data: {
          id: 'new-id', prompt: 'Explain X', title: 'X', difficulty_tier: 'hard',
          domain_tags: ['science'], status: 'active', deleted_at: null, created_at: '2026-01-01',
        },
        error: null,
      });

      const result = await createPromptAction({
        prompt: 'Explain X',
        title: 'X',
        difficultyTier: 'hard',
        domainTags: ['science'],
      });

      expect(result.success).toBe(true);
      expect(result.data?.difficulty_tier).toBe('hard');
      expect(result.data?.domain_tags).toEqual(['science']);
    });

    it('rejects duplicate prompts (case-insensitive)', async () => {
      queueResult('evolution_arena_topics', { data: { id: 'existing' }, error: null });

      const result = await createPromptAction({ prompt: 'Existing prompt', title: 'Existing' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already exists');
    });

    it('rejects empty prompt text', async () => {
      const result = await createPromptAction({ prompt: '  ', title: 'Empty' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('required');
    });

    it('rejects empty title', async () => {
      const result = await createPromptAction({ prompt: 'Valid prompt', title: '  ' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Title is required');
    });
  });

  describe('updatePromptAction', () => {
    it('updates metadata fields', async () => {
      // No prompt text change → no uniqueness check; straight to update
      queueResult('evolution_arena_topics', {
        data: {
          id: 'p1', prompt: 'Existing', title: 'New Title', difficulty_tier: 'medium',
          domain_tags: ['math'], status: 'active', deleted_at: null, created_at: '2026-01-01',
        },
        error: null,
      });

      const result = await updatePromptAction({
        id: 'p1',
        title: 'New Title',
        difficultyTier: 'medium',
        domainTags: ['math'],
      });

      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('New Title');
    });

    it('checks uniqueness when prompt text changes', async () => {
      // Uniqueness check: conflict found
      queueResult('evolution_arena_topics', { data: { id: 'other' }, error: null });

      const result = await updatePromptAction({
        id: 'p1',
        prompt: 'New text that conflicts',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already exists');
    });

    it('rejects updates with no fields', async () => {
      const result = await updatePromptAction({ id: 'p1' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('No fields');
    });
  });

  describe('archivePromptAction', () => {
    it('sets status to archived', async () => {
      queueResult('evolution_arena_topics', { error: null, data: null });

      const result = await archivePromptAction('p1');

      expect(result.success).toBe(true);
      expect(result.data?.archived).toBe(true);
    });
  });

  describe('unarchivePromptAction', () => {
    it('sets status back to active', async () => {
      queueResult('evolution_arena_topics', { error: null, data: null });

      const result = await unarchivePromptAction('p1');

      expect(result.success).toBe(true);
      expect(result.data?.unarchived).toBe(true);
    });
  });

  describe('deletePromptAction', () => {
    it('soft-deletes prompts without runs', async () => {
      // No associated runs
      queueResult('evolution_runs', { data: [], error: null });
      // Soft delete
      queueResult('evolution_arena_topics', { error: null, data: null });

      const result = await deletePromptAction('p1');

      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
    });

    it('rejects deletion of prompts with runs', async () => {
      // Has associated runs
      queueResult('evolution_runs', { data: [{ id: 'run-1' }], error: null });

      const result = await deletePromptAction('p1');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot delete');
    });
  });

  describe('getPromptTitleAction', () => {
    it('returns title for valid prompt ID', async () => {
      queueResult('evolution_arena_topics', {
        data: { title: 'Quantum Entanglement' },
        error: null,
      });

      const result = await getPromptTitleAction('11111111-1111-1111-1111-111111111111');

      expect(result.success).toBe(true);
      expect(result.data).toBe('Quantum Entanglement');
    });

    it('returns truncated UUID when title is null', async () => {
      queueResult('evolution_arena_topics', {
        data: { title: null },
        error: null,
      });

      const result = await getPromptTitleAction('11111111-1111-1111-1111-111111111111');

      expect(result.success).toBe(true);
      expect(result.data).toBe('11111111');
    });

    it('rejects invalid UUID format', async () => {
      const result = await getPromptTitleAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid');
    });

    it('returns error when prompt not found', async () => {
      queueResult('evolution_arena_topics', { data: null, error: { message: 'not found' } });

      const result = await getPromptTitleAction('11111111-1111-1111-1111-111111111111');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not found');
    });
  });
});
