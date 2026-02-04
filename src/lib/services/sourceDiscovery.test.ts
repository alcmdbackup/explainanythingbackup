/**
 * Unit tests for sourceDiscovery.ts
 * Tests source leaderboard queries, domain grouping, and source discovery functions.
 * @jest-environment node
 */

import { getTopSources, getSourcesByDomain, getPopularSourcesByTopic, getSimilarArticleSources } from './sourceDiscovery';

// Mock Supabase
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
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

// Mock vectorsim
jest.mock('./vectorsim', () => ({
  loadFromPineconeUsingExplanationId: jest.fn(),
  searchForSimilarVectors: jest.fn(),
}));

// Mock sourceCache
jest.mock('./sourceCache', () => ({
  getSourcesByExplanationId: jest.fn(),
}));

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { loadFromPineconeUsingExplanationId, searchForSimilarVectors } from './vectorsim';
import { getSourcesByExplanationId } from './sourceCache';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockOr = jest.fn();
const mockIn = jest.fn();
const mockLimit = jest.fn();

const mockSupabase = {
  rpc: mockRpc,
  from: mockFrom,
};

describe('sourceDiscovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ============================================================================
  // getTopSources
  // ============================================================================
  describe('getTopSources', () => {
    const mockData = [
      { source_cache_id: 1, total_citations: 47, unique_explanations: 31, domain: 'en.wikipedia.org', title: 'Quantum Computing', favicon_url: null },
      { source_cache_id: 2, total_citations: 23, unique_explanations: 15, domain: 'arxiv.org', title: 'Neural Networks', favicon_url: null },
      { source_cache_id: 3, total_citations: 12, unique_explanations: 8, domain: 'docs.python.org', title: 'Python Docs', favicon_url: null },
    ];

    it('should call get_source_citation_counts RPC with correct params', async () => {
      mockRpc.mockResolvedValue({ data: mockData, error: null });

      await getTopSources({ sort: 'citations', period: 'all' });

      expect(mockRpc).toHaveBeenCalledWith('get_source_citation_counts', {
        p_period: 'all',
        p_limit: 50,
      });
    });

    it('should use custom limit when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getTopSources({ sort: 'citations', period: 'week', limit: 10 });

      expect(mockRpc).toHaveBeenCalledWith('get_source_citation_counts', {
        p_period: 'week',
        p_limit: 10,
      });
    });

    it('should return data sorted by citations (default RPC order)', async () => {
      mockRpc.mockResolvedValue({ data: mockData, error: null });

      const result = await getTopSources({ sort: 'citations', period: 'all' });

      expect(result).toHaveLength(3);
      expect(result[0].source_cache_id).toBe(1);
      expect(result[0].total_citations).toBe(47);
    });

    it('should sort by domain when sort=domain', async () => {
      mockRpc.mockResolvedValue({ data: [...mockData], error: null });

      const result = await getTopSources({ sort: 'domain', period: 'all' });

      expect(result[0].domain).toBe('arxiv.org');
      expect(result[1].domain).toBe('docs.python.org');
      expect(result[2].domain).toBe('en.wikipedia.org');
    });

    it('should return empty array when no data', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await getTopSources({ sort: 'citations', period: 'all' });

      expect(result).toEqual([]);
    });

    it('should throw on RPC error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(
        getTopSources({ sort: 'citations', period: 'all' })
      ).rejects.toEqual({ message: 'RPC failed' });
    });
  });

  // ============================================================================
  // getSourcesByDomain
  // ============================================================================
  describe('getSourcesByDomain', () => {
    const mockData = [
      { source_cache_id: 1, total_citations: 47, unique_explanations: 31, domain: 'en.wikipedia.org', title: 'Quantum Computing', favicon_url: null },
      { source_cache_id: 4, total_citations: 10, unique_explanations: 5, domain: 'en.wikipedia.org', title: 'Machine Learning', favicon_url: null },
      { source_cache_id: 2, total_citations: 23, unique_explanations: 15, domain: 'arxiv.org', title: 'Neural Networks', favicon_url: null },
    ];

    it('should filter results by domain', async () => {
      mockRpc.mockResolvedValue({ data: mockData, error: null });

      const result = await getSourcesByDomain('en.wikipedia.org');

      expect(result).toHaveLength(2);
      expect(result.every(r => r.domain === 'en.wikipedia.org')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      mockRpc.mockResolvedValue({ data: mockData, error: null });

      const result = await getSourcesByDomain('en.wikipedia.org', 1);

      expect(result).toHaveLength(1);
    });

    it('should return empty array for unknown domain', async () => {
      mockRpc.mockResolvedValue({ data: mockData, error: null });

      const result = await getSourcesByDomain('unknown.com');

      expect(result).toEqual([]);
    });

    it('should throw on RPC error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(getSourcesByDomain('any.com')).rejects.toEqual({ message: 'RPC failed' });
    });
  });

  // ============================================================================
  // getPopularSourcesByTopic
  // ============================================================================
  describe('getPopularSourcesByTopic', () => {
    beforeEach(() => {
      // Chain: from().select().or().limit()
      mockFrom.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ or: mockOr, in: mockIn });
      mockOr.mockReturnValue({ limit: mockLimit });
    });

    it('should return sources ranked by frequency', async () => {
      // Explanations query
      mockLimit.mockResolvedValueOnce({
        data: [{ id: 100 }, { id: 200 }],
        error: null,
      });
      // article_sources query
      mockIn.mockResolvedValueOnce({
        data: [
          { source_cache_id: 10 },
          { source_cache_id: 10 },
          { source_cache_id: 20 },
        ],
        error: null,
      });
      // source_cache query
      mockIn.mockResolvedValueOnce({
        data: [
          { id: 10, url: 'https://a.com', domain: 'a.com', title: 'Source A', favicon_url: null },
          { id: 20, url: 'https://b.com', domain: 'b.com', title: 'Source B', favicon_url: null },
        ],
        error: null,
      });

      const result = await getPopularSourcesByTopic(1, 10);

      expect(result).toHaveLength(2);
      expect(result[0].source_cache_id).toBe(10);
      expect(result[0].frequency).toBe(2);
      expect(result[1].source_cache_id).toBe(20);
      expect(result[1].frequency).toBe(1);
    });

    it('should return empty when no explanations in topic', async () => {
      mockLimit.mockResolvedValueOnce({ data: [], error: null });

      const result = await getPopularSourcesByTopic(999, 10);
      expect(result).toEqual([]);
    });

    it('should return empty when explanations have no sources', async () => {
      mockLimit.mockResolvedValueOnce({
        data: [{ id: 100 }],
        error: null,
      });
      mockIn.mockResolvedValueOnce({ data: [], error: null });

      const result = await getPopularSourcesByTopic(1, 10);
      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // getSimilarArticleSources
  // ============================================================================
  describe('getSimilarArticleSources', () => {
    it('should return empty when no vector found', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue(null);

      const result = await getSimilarArticleSources(42);
      expect(result).toEqual([]);
    });

    it('should return empty when vector has no values', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue({ values: null });

      const result = await getSimilarArticleSources(42);
      expect(result).toEqual([]);
    });

    it('should return empty when no similar matches found', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue({
        values: [0.1, 0.2, 0.3],
      });
      (searchForSimilarVectors as jest.Mock).mockResolvedValue([]);

      const result = await getSimilarArticleSources(42);
      expect(result).toEqual([]);
    });

    it('should deduplicate and rank sources by frequency', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue({
        values: [0.1, 0.2, 0.3],
      });
      (searchForSimilarVectors as jest.Mock).mockResolvedValue([
        { metadata: { explanation_id: 100 }, score: 0.9 },
        { metadata: { explanation_id: 200 }, score: 0.8 },
      ]);

      const sharedSource = { id: 10, url: 'https://shared.com', domain: 'shared.com', title: 'Shared', favicon_url: null };
      const uniqueSource = { id: 20, url: 'https://unique.com', domain: 'unique.com', title: 'Unique', favicon_url: null };

      (getSourcesByExplanationId as jest.Mock)
        .mockResolvedValueOnce([sharedSource, uniqueSource]) // explanation 100
        .mockResolvedValueOnce([sharedSource]); // explanation 200

      const result = await getSimilarArticleSources(42);

      expect(result).toHaveLength(2);
      expect(result[0].source_cache_id).toBe(10);
      expect(result[0].frequency).toBe(2);
      expect(result[1].source_cache_id).toBe(20);
      expect(result[1].frequency).toBe(1);
    });

    it('should exclude the current explanation from similar matches', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue({
        values: [0.1, 0.2],
      });
      // Only match is self
      (searchForSimilarVectors as jest.Mock).mockResolvedValue([
        { metadata: { explanation_id: 42 }, score: 1.0 },
      ]);

      const result = await getSimilarArticleSources(42);
      expect(result).toEqual([]);
    });

    it('should handle getSourcesByExplanationId failure gracefully', async () => {
      (loadFromPineconeUsingExplanationId as jest.Mock).mockResolvedValue({
        values: [0.1, 0.2],
      });
      (searchForSimilarVectors as jest.Mock).mockResolvedValue([
        { metadata: { explanation_id: 100 }, score: 0.9 },
      ]);
      (getSourcesByExplanationId as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await getSimilarArticleSources(42);
      expect(result).toEqual([]);
    });
  });
});
