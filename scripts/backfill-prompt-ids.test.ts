/**
 * Unit tests for backfill-prompt-ids script.
 * Verifies idempotent backfill logic with bank-entry and explanation-title strategies.
 */

// ─── Supabase Mock ───────────────────────────────────────────────

function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
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

const mockSupabase = { from: (...args: unknown[]) => mockFrom(...args) };

import { backfillPromptIds } from './backfill-prompt-ids';

// ─── Helpers ─────────────────────────────────────────────────────

function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('backfillPromptIds', () => {
  it('returns zero counts when no runs need backfill', async () => {
    queueResult('content_evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });

  it('links via bank entry topic_id (strategy 1)', async () => {
    // Runs with null prompt_id
    queueResult('content_evolution_runs', {
      data: [{ id: 'run-1', explanation_id: 1 }],
      error: null,
    });
    // Bank entry lookup → found
    queueResult('article_bank_entries', {
      data: { topic_id: 'topic-abc' },
      error: null,
    });
    // Update prompt_id
    queueResult('content_evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, unlinked: 0 });
    expect(mockFrom).toHaveBeenCalledWith('article_bank_entries');
  });

  it('links via explanation title (strategy 2) when bank entry not found', async () => {
    queueResult('content_evolution_runs', {
      data: [{ id: 'run-2', explanation_id: 42 }],
      error: null,
    });
    // Bank entry → not found
    queueResult('article_bank_entries', { data: null, error: null });
    // Explanation → title found
    queueResult('explanations', {
      data: { explanation_title: 'Explain gravity' },
      error: null,
    });
    // Topic match
    queueResult('article_bank_topics', { data: { id: 'topic-grav' }, error: null });
    // Update prompt_id
    queueResult('content_evolution_runs', { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 1, unlinked: 0 });
  });

  it('counts unlinked runs when no match found', async () => {
    queueResult('content_evolution_runs', {
      data: [{ id: 'run-3', explanation_id: null }],
      error: null,
    });
    // Bank entry → not found
    queueResult('article_bank_entries', { data: null, error: null });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 1 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('run-3'));
    warnSpy.mockRestore();
  });

  it('throws on DB error fetching runs', async () => {
    queueResult('content_evolution_runs', { data: null, error: { message: 'DB down' } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(backfillPromptIds(mockSupabase as any)).rejects.toThrow('Failed to fetch runs');
  });

  it('is idempotent — re-running on already linked runs returns zero', async () => {
    // No runs with null prompt_id
    queueResult('content_evolution_runs', { data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillPromptIds(mockSupabase as any);

    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });
});
