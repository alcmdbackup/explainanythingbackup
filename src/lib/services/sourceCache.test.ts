/**
 * Unit tests for sourceCache.ts
 * Tests source cache CRUD operations and source management functions.
 * @jest-environment node
 */

import {
  insertSourceCache,
  getSourceByUrl,
  getSourceById,
  updateSourceCache,
  isSourceExpired,
  getOrCreateCachedSource,
  linkSourcesToExplanation,
  getSourcesByExplanationId,
  unlinkSourcesFromExplanation,
  updateSourcesForExplanation,
  addSourceToExplanation,
  removeSourceFromExplanation,
  reorderSources,
} from './sourceCache';
import { FetchStatus } from '@/lib/schemas/schemas';

// Mock Supabase
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
}));

// Mock sourceFetcher
jest.mock('./sourceFetcher', () => ({
  fetchAndExtractSource: jest.fn(),
  needsSummarization: jest.fn(),
  calculateExpiryDate: jest.fn(() => '2026-02-09T00:00:00.000Z'),
}));

// Mock sourceSummarizer
jest.mock('./sourceSummarizer', () => ({
  summarizeSourceContent: jest.fn(),
}));

// Mock logger
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';

type MockSupabaseClient = {
  from: jest.Mock;
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  single: jest.Mock;
  rpc: jest.Mock;
};

let mockSupabase: MockSupabaseClient;

function createChainableMock(): MockSupabaseClient {
  const mock: Partial<MockSupabaseClient> = {};
  mock.from = jest.fn().mockReturnValue(mock);
  mock.select = jest.fn().mockReturnValue(mock);
  mock.insert = jest.fn().mockReturnValue(mock);
  mock.update = jest.fn().mockReturnValue(mock);
  mock.delete = jest.fn().mockReturnValue(mock);
  mock.eq = jest.fn().mockReturnValue(mock);
  mock.in = jest.fn().mockReturnValue(mock);
  mock.order = jest.fn().mockReturnValue(mock);
  mock.single = jest.fn().mockResolvedValue({ data: null, error: null });
  mock.rpc = jest.fn().mockResolvedValue({ data: null, error: null });
  return mock as MockSupabaseClient;
}

describe('sourceCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createChainableMock();
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ============================================================================
  // isSourceExpired (sync, no mocks needed)
  // ============================================================================
  describe('isSourceExpired', () => {
    it('should return true when expires_at is null', () => {
      const source = { expires_at: null } as Parameters<typeof isSourceExpired>[0];
      expect(isSourceExpired(source)).toBe(true);
    });

    it('should return true when expires_at is in the past', () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const source = { expires_at: pastDate } as Parameters<typeof isSourceExpired>[0];
      expect(isSourceExpired(source)).toBe(true);
    });

    it('should return false when expires_at is in the future', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const source = { expires_at: futureDate } as Parameters<typeof isSourceExpired>[0];
      expect(isSourceExpired(source)).toBe(false);
    });
  });

  // ============================================================================
  // insertSourceCache
  // ============================================================================
  describe('insertSourceCache', () => {
    it('should return existing source if URL already exists', async () => {
      const existing = { id: 1, url: 'https://example.com', domain: 'example.com' };
      mockSupabase.single.mockResolvedValueOnce({ data: existing, error: null });

      const result = await insertSourceCache({
        url: 'https://example.com',
        title: 'Test',
        favicon_url: null,
        domain: 'example.com',
        extracted_text: 'content',
        is_summarized: false,
        original_length: 10,
        fetch_status: FetchStatus.Success,
        error_message: null,
        expires_at: null,
      });

      expect(result).toEqual(existing);
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it('should insert new source when URL does not exist', async () => {
      // First query returns not found
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });
      // Insert returns new record
      const newRecord = { id: 2, url: 'https://new.com', domain: 'new.com' };
      mockSupabase.single.mockResolvedValueOnce({ data: newRecord, error: null });

      const result = await insertSourceCache({
        url: 'https://new.com',
        title: 'New',
        favicon_url: null,
        domain: 'new.com',
        extracted_text: 'content',
        is_summarized: false,
        original_length: 10,
        fetch_status: FetchStatus.Success,
        error_message: null,
        expires_at: null,
      });

      expect(result).toEqual(newRecord);
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should throw on invalid input', async () => {
      await expect(
        insertSourceCache({ url: 'not-a-url' } as Parameters<typeof insertSourceCache>[0])
      ).rejects.toThrow('Invalid source cache data');
    });
  });

  // ============================================================================
  // Source management operations (RPC calls)
  // ============================================================================
  describe('updateSourcesForExplanation', () => {
    it('should call replace_explanation_sources RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      await updateSourcesForExplanation(1, [10, 20, 30]);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('replace_explanation_sources', {
        p_explanation_id: 1,
        p_source_ids: [10, 20, 30],
      });
    });

    it('should throw on RPC error', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(updateSourcesForExplanation(1, [10])).rejects.toEqual({ message: 'RPC failed' });
    });
  });

  describe('removeSourceFromExplanation', () => {
    it('should call remove_and_renumber_source RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      await removeSourceFromExplanation(1, 42);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('remove_and_renumber_source', {
        p_explanation_id: 1,
        p_source_cache_id: 42,
      });
    });
  });

  describe('reorderSources', () => {
    it('should call reorder_explanation_sources RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      await reorderSources(1, [30, 10, 20]);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('reorder_explanation_sources', {
        p_explanation_id: 1,
        p_source_ids: [30, 10, 20],
      });
    });
  });

  describe('linkSourcesToExplanation', () => {
    it('should do nothing for empty source array', async () => {
      await linkSourcesToExplanation(1, []);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should reject more than 5 sources', async () => {
      await expect(linkSourcesToExplanation(1, [1, 2, 3, 4, 5, 6])).rejects.toThrow(
        'Maximum 5 sources allowed'
      );
    });

    it('should insert junction records with correct positions', async () => {
      mockSupabase.insert.mockReturnValue({ error: null });

      await linkSourcesToExplanation(1, [10, 20, 30]);

      expect(mockSupabase.from).toHaveBeenCalledWith('article_sources');
      expect(mockSupabase.insert).toHaveBeenCalledWith([
        { explanation_id: 1, source_cache_id: 10, position: 1 },
        { explanation_id: 1, source_cache_id: 20, position: 2 },
        { explanation_id: 1, source_cache_id: 30, position: 3 },
      ]);
    });
  });

  describe('getSourcesByExplanationId', () => {
    it('should return empty array when no sources linked', async () => {
      // First query (article_sources) returns empty
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      const result = await getSourcesByExplanationId(999);
      expect(result).toEqual([]);
    });

    it('should return sources in position order', async () => {
      const links = [
        { source_cache_id: 10, position: 1 },
        { source_cache_id: 20, position: 2 },
      ];
      const sources = [
        { id: 20, url: 'https://b.com', domain: 'b.com' },
        { id: 10, url: 'https://a.com', domain: 'a.com' },
      ];

      // Step 1: Get links ordered by position
      mockSupabase.order.mockResolvedValueOnce({ data: links, error: null });
      // Step 2: Get full source records (returned in any order)
      mockSupabase.in.mockResolvedValueOnce({ data: sources, error: null });

      const result = await getSourcesByExplanationId(1);
      // Should be ordered by position: source 10 first, then source 20
      expect(result[0]!.id).toBe(10);
      expect(result[1]!.id).toBe(20);
    });
  });
});
