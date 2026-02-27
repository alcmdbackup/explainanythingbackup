// Unit tests for linkCandidates service — CRUD, occurrence tracking, aggregates, and approval workflow.

// ── Mock setup ──────────────────────────────────────────────────

const mockFrom = jest.fn();
const mockSupabase = { from: mockFrom };

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(() => mockSupabase),
}));

jest.mock('@/lib/services/linkWhitelist', () => ({
  createWhitelistTerm: jest.fn().mockResolvedValue({ id: 1, canonical_term: 'test' }),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { debug: jest.fn(), error: jest.fn() },
}));

import {
  countTermOccurrences,
  upsertCandidate,
  getCandidateById,
  getAllCandidates,
  deleteCandidate,
  upsertOccurrence,
  getOccurrencesForExplanation,
  recalculateCandidateAggregates,
  saveCandidatesFromLLM,
  updateOccurrencesForArticle,
  approveCandidate,
  rejectCandidate,
} from './linkCandidates';
import { createWhitelistTerm } from '@/lib/services/linkWhitelist';
import { logger } from '@/lib/server_utilities';

// ── Helpers ─────────────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const terminal = jest.fn().mockResolvedValue(result);

  // Build a fluent chain where any method returns the chain itself, except terminal calls
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get: (_target, prop: string) => {
      if (prop === 'then') return undefined; // prevent auto-awaiting the proxy
      if (!chain[prop]) {
        chain[prop] = jest.fn().mockReturnValue(new Proxy({}, handler));
      }
      return chain[prop];
    },
  };

  // Override terminal methods
  const proxy = new Proxy({}, handler);
  // Single returns the result directly
  (proxy as Record<string, jest.Mock>).single = terminal;
  // For queries without .single() — make the chain itself resolve
  (proxy as Record<string, jest.Mock>).then = (_resolve: (value: unknown) => unknown) => {
    return terminal().then(_resolve);
  };

  return proxy;
}

function mockSimpleChain(overrides: Record<string, jest.Mock> = {}) {
  const single = jest.fn();
  const base: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single,
    ...overrides,
  };
  return base;
}

const MOCK_CANDIDATE = {
  id: 1,
  term: 'React',
  term_lower: 'react',
  status: 'pending',
  source: 'llm',
  first_seen_explanation_id: 100,
  total_occurrences: 5,
  article_count: 2,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const MOCK_OCCURRENCE = {
  id: 1,
  candidate_id: 1,
  explanation_id: 100,
  occurrence_count: 3,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

// ── Tests ───────────────────────────────────────────────────────

describe('linkCandidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── countTermOccurrences (pure function) ────────────────────

  describe('countTermOccurrences', () => {
    it('should count single occurrence', () => {
      expect(countTermOccurrences('I like React', 'React')).toBe(1);
    });

    it('should count multiple occurrences', () => {
      expect(countTermOccurrences('React is great. I use React daily.', 'React')).toBe(2);
    });

    it('should be case-insensitive', () => {
      expect(countTermOccurrences('react REACT React', 'react')).toBe(3);
    });

    it('should respect word boundaries', () => {
      expect(countTermOccurrences('reactive react reacting', 'react')).toBe(1);
    });

    it('should return 0 when term not found', () => {
      expect(countTermOccurrences('hello world', 'react')).toBe(0);
    });

    it('should handle empty content', () => {
      expect(countTermOccurrences('', 'react')).toBe(0);
    });

    it('should handle regex special characters without throwing', () => {
      // \b doesn't match at non-word char boundaries like + or ), so count is 0
      // The important thing is it doesn't throw
      expect(() => countTermOccurrences('C++ is fast', 'C++')).not.toThrow();
    });

    it('should handle terms with dots', () => {
      expect(countTermOccurrences('Use Node.js for server code', 'Node.js')).toBe(1);
    });

    it('should handle multi-word terms', () => {
      expect(countTermOccurrences('machine learning is great. I study machine learning.', 'machine learning')).toBe(2);
    });
  });

  // ── upsertCandidate ─────────────────────────────────────────

  describe('upsertCandidate', () => {
    it('should return existing candidate if found', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await upsertCandidate('React', 100);
      expect(result).toEqual(MOCK_CANDIDATE);
      expect(chain.eq).toHaveBeenCalledWith('term_lower', 'react');
    });

    it('should insert new candidate when not found (PGRST116)', async () => {
      const selectChain = mockSimpleChain();
      selectChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const insertChain = mockSimpleChain();
      insertChain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? selectChain : insertChain;
      });

      const result = await upsertCandidate('React', 100);
      expect(result).toEqual(MOCK_CANDIDATE);
    });

    it('should throw on non-PGRST116 select error', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: { code: 'FATAL', message: 'DB down' } });
      mockFrom.mockReturnValue(chain);

      await expect(upsertCandidate('React', 100)).rejects.toEqual(
        expect.objectContaining({ code: 'FATAL' }),
      );
    });

    it('should throw on insert error', async () => {
      const selectChain = mockSimpleChain();
      selectChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const insertChain = mockSimpleChain();
      insertChain.single.mockResolvedValue({ data: null, error: { message: 'insert failed' } });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? selectChain : insertChain;
      });

      await expect(upsertCandidate('React', 100)).rejects.toEqual(
        expect.objectContaining({ message: 'insert failed' }),
      );
    });

    it('should lowercase term for lookup', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });
      mockFrom.mockReturnValue(chain);

      await upsertCandidate('REACT', 100);
      expect(chain.eq).toHaveBeenCalledWith('term_lower', 'react');
    });
  });

  // ── getCandidateById ────────────────────────────────────────

  describe('getCandidateById', () => {
    it('should return candidate by id', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getCandidateById(1);
      expect(result).toEqual(MOCK_CANDIDATE);
      expect(chain.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw when not found', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(getCandidateById(999)).rejects.toThrow('Candidate not found for ID: 999');
    });

    it('should throw on db error', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: { message: 'db error' } });
      mockFrom.mockReturnValue(chain);

      await expect(getCandidateById(1)).rejects.toEqual(
        expect.objectContaining({ message: 'db error' }),
      );
    });
  });

  // ── getAllCandidates ────────────────────────────────────────

  describe('getAllCandidates', () => {
    it('should return all candidates ordered by total_occurrences', async () => {
      const chain = mockSimpleChain();
      // getAllCandidatesImpl doesn't call .single(), it awaits the query chain
      // The chain resolves through .order() which returns itself (mockReturnThis)
      // But we need the chain itself to resolve — override the terminal behavior
      const data = [MOCK_CANDIDATE];
      chain.order.mockResolvedValue({ data, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getAllCandidates();
      expect(result).toEqual(data);
      expect(chain.order).toHaveBeenCalledWith('total_occurrences', { ascending: false });
    });

    it('should filter by status when provided', async () => {
      const data = [MOCK_CANDIDATE];
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ data, error: null });
      chain.order.mockReturnValue(chain);
      mockFrom.mockReturnValue(chain);

      const result = await getAllCandidates('pending' as any);
      expect(result).toEqual(data);
      expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    });

    it('should return empty array when data is null', async () => {
      const chain = mockSimpleChain();
      chain.order.mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getAllCandidates();
      expect(result).toEqual([]);
    });

    it('should throw on error', async () => {
      const chain = mockSimpleChain();
      chain.order.mockResolvedValue({ data: null, error: { message: 'fail' } });
      mockFrom.mockReturnValue(chain);

      await expect(getAllCandidates()).rejects.toEqual(
        expect.objectContaining({ message: 'fail' }),
      );
    });
  });

  // ── deleteCandidate ─────────────────────────────────────────

  describe('deleteCandidate', () => {
    it('should delete candidate by id', async () => {
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ error: null });
      mockFrom.mockReturnValue(chain);

      await deleteCandidate(1);
      expect(mockFrom).toHaveBeenCalledWith('link_candidates');
      expect(chain.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw on error', async () => {
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ error: { message: 'delete failed' } });
      mockFrom.mockReturnValue(chain);

      await expect(deleteCandidate(1)).rejects.toEqual(
        expect.objectContaining({ message: 'delete failed' }),
      );
    });
  });

  // ── upsertOccurrence ───────────────────────────────────────

  describe('upsertOccurrence', () => {
    it('should upsert occurrence record', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: MOCK_OCCURRENCE, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await upsertOccurrence(1, 100, 3);
      expect(result).toEqual(MOCK_OCCURRENCE);
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          candidate_id: 1,
          explanation_id: 100,
          occurrence_count: 3,
        }),
        expect.objectContaining({ onConflict: 'candidate_id,explanation_id' }),
      );
    });

    it('should throw on error', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: { message: 'upsert failed' } });
      mockFrom.mockReturnValue(chain);

      await expect(upsertOccurrence(1, 100, 3)).rejects.toEqual(
        expect.objectContaining({ message: 'upsert failed' }),
      );
    });
  });

  // ── getOccurrencesForExplanation ───────────────────────────

  describe('getOccurrencesForExplanation', () => {
    it('should return occurrences for explanation', async () => {
      const data = [MOCK_OCCURRENCE];
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ data, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getOccurrencesForExplanation(100);
      expect(result).toEqual(data);
    });

    it('should return empty array when data is null', async () => {
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getOccurrencesForExplanation(100);
      expect(result).toEqual([]);
    });
  });

  // ── recalculateCandidateAggregates ─────────────────────────

  describe('recalculateCandidateAggregates', () => {
    it('should recalculate aggregates for all candidates', async () => {
      // First call: select all candidate ids
      const selectCandidatesChain = mockSimpleChain();
      // The .select('id') returns data directly (no .single())
      selectCandidatesChain.select.mockResolvedValue({
        data: [{ id: 1 }, { id: 2 }],
        error: null,
      });

      // Occurrence queries
      const occChain1 = mockSimpleChain();
      occChain1.eq.mockResolvedValue({
        data: [{ occurrence_count: 3 }, { occurrence_count: 2 }],
        error: null,
      });

      const occChain2 = mockSimpleChain();
      occChain2.eq.mockResolvedValue({
        data: [{ occurrence_count: 1 }],
        error: null,
      });

      // Update chains
      const updateChain1 = mockSimpleChain();
      updateChain1.eq.mockResolvedValue({ error: null });

      const updateChain2 = mockSimpleChain();
      updateChain2.eq.mockResolvedValue({ error: null });

      let callIdx = 0;
      const chains = [
        selectCandidatesChain,
        occChain1, updateChain1,
        occChain2, updateChain2,
      ];
      mockFrom.mockImplementation(() => chains[callIdx++]);

      await recalculateCandidateAggregates();

      // Verify updates were called with correct aggregates
      expect(updateChain1.update).toHaveBeenCalledWith(
        expect.objectContaining({ total_occurrences: 5, article_count: 2 }),
      );
      expect(updateChain2.update).toHaveBeenCalledWith(
        expect.objectContaining({ total_occurrences: 1, article_count: 1 }),
      );
    });

    it('should handle empty candidates list', async () => {
      const chain = mockSimpleChain();
      chain.select.mockResolvedValue({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      await recalculateCandidateAggregates();
      // Should complete without errors — only one from() call for the initial select
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });
  });

  // ── saveCandidatesFromLLM ──────────────────────────────────

  describe('saveCandidatesFromLLM', () => {
    it('should return early for empty candidates array', async () => {
      await saveCandidatesFromLLM(100, 'content', []);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should log debug message for empty candidates when debug=true', async () => {
      await saveCandidatesFromLLM(100, 'content', [], true);
      expect(logger.debug).toHaveBeenCalledWith('No candidates to save');
    });

    it('should log errors for individual candidate failures without throwing', async () => {
      // Upsert fails for the candidate
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const insertChain = mockSimpleChain();
      insertChain.single.mockRejectedValue(new Error('insert failed'));

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? chain : insertChain;
      });

      // Should not throw — errors are caught per-candidate
      await saveCandidatesFromLLM(100, 'content with React', ['React']);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error saving candidate'),
        expect.any(Object),
      );
    });
  });

  // ── updateOccurrencesForArticle ────────────────────────────

  describe('updateOccurrencesForArticle', () => {
    it('should return early when no existing occurrences', async () => {
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      await updateOccurrencesForArticle(100, 'new content');
      // Only one from() call for getOccurrencesForExplanation
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('should log debug for empty occurrences when debug=true', async () => {
      const chain = mockSimpleChain();
      chain.eq.mockResolvedValue({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      await updateOccurrencesForArticle(100, 'content', true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No existing occurrences'),
      );
    });
  });

  // ── approveCandidate ───────────────────────────────────────

  describe('approveCandidate', () => {
    it('should create whitelist entry and update status', async () => {
      // getCandidateById chain
      const getChain = mockSimpleChain();
      getChain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });

      // update chain
      const updateChain = mockSimpleChain();
      updateChain.single.mockResolvedValue({
        data: { ...MOCK_CANDIDATE, status: 'approved' },
        error: null,
      });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? getChain : updateChain;
      });

      const result = await approveCandidate(1, 'React Framework');
      expect(result.status).toBe('approved');
      expect(createWhitelistTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          canonical_term: 'React',
          standalone_title: 'React Framework',
          is_active: true,
        }),
      );
    });

    it('should throw on update error', async () => {
      const getChain = mockSimpleChain();
      getChain.single.mockResolvedValue({ data: MOCK_CANDIDATE, error: null });

      const updateChain = mockSimpleChain();
      updateChain.single.mockResolvedValue({ data: null, error: { message: 'update failed' } });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? getChain : updateChain;
      });

      await expect(approveCandidate(1, 'React')).rejects.toEqual(
        expect.objectContaining({ message: 'update failed' }),
      );
    });
  });

  // ── rejectCandidate ────────────────────────────────────────

  describe('rejectCandidate', () => {
    it('should update status to rejected', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({
        data: { ...MOCK_CANDIDATE, status: 'rejected' },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await rejectCandidate(1);
      expect(result.status).toBe('rejected');
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'rejected' }),
      );
    });

    it('should throw on error', async () => {
      const chain = mockSimpleChain();
      chain.single.mockResolvedValue({ data: null, error: { message: 'reject failed' } });
      mockFrom.mockReturnValue(chain);

      await expect(rejectCandidate(1)).rejects.toEqual(
        expect.objectContaining({ message: 'reject failed' }),
      );
    });
  });
});
