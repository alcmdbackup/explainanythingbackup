// Define mock instances before imports to handle hoisting
const mockOpenAIInstance = {
  embeddings: {
    create: jest.fn()
  }
};

const mockPineconeInstance = {
  index: jest.fn(),
  Index: jest.fn()
};

// Mock external dependencies before imports
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => mockOpenAIInstance);
});

jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn().mockImplementation(() => mockPineconeInstance)
}));

import {
  findMatchesInVectorDb,
  processContentToStoreEmbedding,
  calculateAllowedScores,
  loadFromPineconeUsingExplanationId,
  searchForSimilarVectors,
  deleteVectorsByExplanationId
} from './vectorsim';
import { AnchorSet, type VectorSearchResult } from '@/lib/schemas/schemas';

// Helper to create mock VectorSearchResult with minimal required fields
const createMockVectorResult = (overrides: Partial<VectorSearchResult> = {}): VectorSearchResult => ({
  id: 'mock-id',
  score: 0,
  metadata: {
    text: 'mock text',
    explanation_id: 1,
    topic_id: 1,
    startIdx: 0,
    length: 100,
    isAnchor: false,
  },
  ...overrides,
});
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  getRequiredEnvVar: jest.fn((key: string) => {
    const mockEnvVars: Record<string, string> = {
      'OPENAI_API_KEY': 'test-openai-key',
      'PINECONE_API_KEY': 'test-pinecone-key',
      'PINECONE_INDEX_NAME_ALL': 'test-index'
    };
    return mockEnvVars[key] || '';
  })
}));

// Mock instrumentation
jest.mock('../../../instrumentation', () => ({
  createLLMSpan: jest.fn(() => ({
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn()
  })),
  createVectorSpan: jest.fn(() => ({
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn()
  }))
}));

// Mock langchain
jest.mock('langchain/text_splitter', () => ({
  RecursiveCharacterTextSplitter: jest.fn().mockImplementation(() => ({
    splitText: jest.fn().mockResolvedValue(['chunk1', 'chunk2', 'chunk3'])
  }))
}));

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

describe('vectorsim', () => {
  let mockNamespace: any;
  let mockIndex: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup OpenAI embeddings response
    mockOpenAIInstance.embeddings.create.mockResolvedValue({
      data: [{
        embedding: new Array(3072).fill(0.1) // Mock 3072-dimensional embedding
      }],
      usage: {
        prompt_tokens: 10,
        total_tokens: 10
      }
    });

    // Setup Pinecone operations
    mockNamespace = {
      upsert: jest.fn().mockResolvedValue({}),
      query: jest.fn().mockResolvedValue({
        matches: [
          {
            id: 'match1',
            score: 0.9,
            metadata: {
              text: 'matched text',
              explanation_id: 123,
              topic_id: 456
            },
            values: new Array(3072).fill(0.1)
          }
        ]
      })
    };

    mockIndex = {
      namespace: jest.fn(() => mockNamespace)
    };

    // Setup both index and Index methods (the code uses both)
    mockPineconeInstance.index.mockReturnValue(mockIndex);
    mockPineconeInstance.Index.mockReturnValue(mockIndex);
  });

  describe('calculateAllowedScores', () => {
    it('should calculate scores correctly with valid matches', async () => {
      const anchorMatches = [
        createMockVectorResult({ score: 0.8 }),
        createMockVectorResult({ score: 0.7 })
      ];
      const explanationMatches = [
        createMockVectorResult({ score: 0.9 }),
        createMockVectorResult({ score: 0.8 }),
        createMockVectorResult({ score: 0.7 }),
        createMockVectorResult({ score: 0.6 }) // Should only use top 3
      ];

      const result = await calculateAllowedScores(anchorMatches, explanationMatches);

      expect(result.anchorScore).toBeCloseTo(1.5); // (0.8 + 0.7) / 1
      expect(result.explanationScore).toBeCloseTo(0.8); // (0.9 + 0.8 + 0.7) / 3
      expect(result.allowedTitle).toBe(true); // anchorScore > 0.25
    });

    it('should pad with zeros when less than 3 explanation matches', async () => {
      const anchorMatches = [createMockVectorResult({ score: 0.3 })];
      const explanationMatches = [createMockVectorResult({ score: 0.5 })];

      const result = await calculateAllowedScores(anchorMatches, explanationMatches);

      expect(result.anchorScore).toBeCloseTo(0.3); // 0.3 / 1
      expect(result.explanationScore).toBeCloseTo(0.5 / 3); // (0.5 + 0 + 0) / 3
      expect(result.allowedTitle).toBe(true); // anchorScore > 0.25
    });

    it('should handle empty matches arrays', async () => {
      const result = await calculateAllowedScores([], []);

      expect(result.anchorScore).toBe(0);
      expect(result.explanationScore).toBe(0);
      // Implementation allows first anchor by setting allowedTitle = anchorScore >= 0
      expect(result.allowedTitle).toBe(true);
    });

    it('should handle matches without scores', async () => {
      const anchorMatches = [createMockVectorResult({ score: undefined })];
      const explanationMatches = [
        createMockVectorResult({ score: undefined }),
        createMockVectorResult({ score: undefined }),
        createMockVectorResult({ score: undefined })
      ];

      const result = await calculateAllowedScores(anchorMatches, explanationMatches);

      expect(result.anchorScore).toBe(0);
      expect(result.explanationScore).toBe(0);
      // Implementation allows first anchor by setting allowedTitle = anchorScore >= 0
      expect(result.allowedTitle).toBe(true);
    });
  });

  describe('findMatchesInVectorDb', () => {
    it('should perform a complete query operation successfully', async () => {
      const query = 'test query';
      const matches = await findMatchesInVectorDb(query, false, null, 5, 'default');

       expect(mockOpenAIInstance.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: query
      });
      expect(mockNamespace.query).toHaveBeenCalled();
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match1');
    });

    it('should filter by anchor when specified', async () => {
      const query = 'test query';
      await findMatchesInVectorDb(query, true, AnchorSet.Main, 5, 'default');

      const queryCall = mockNamespace.query.mock.calls[0][0];
      expect(queryCall.filter).toEqual({
        isAnchor: { "$eq": true },
        anchorSet: { "$eq": AnchorSet.Main }
      });
    });

    it('should throw error when anchor is true but anchorSet is null', async () => {
      await expect(
        findMatchesInVectorDb('test', true, null)
      ).rejects.toThrow('anchorSet cannot be null when isAnchor is true');
    });

    it('should handle empty query string', async () => {
      mockOpenAIInstance.embeddings.create.mockRejectedValue(new Error('Query must be a non-empty string'));

      await expect(
        findMatchesInVectorDb('', false, null)
      ).rejects.toThrow('Query must be a non-empty string');
    });
  });

  describe('searchForSimilarVectors', () => {
    it('should search with valid embedding', async () => {
      const embedding = new Array(3072).fill(0.1);
      const matches = await searchForSimilarVectors(embedding, false, null, 5, 'default');

      expect(mockNamespace.query).toHaveBeenCalledWith(
        expect.objectContaining({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
          includeValues: true
        })
      );
      expect(matches).toHaveLength(1);
    });

    it('should throw error for invalid embedding type', async () => {
      await expect(
        searchForSimilarVectors('not an array' as any, false, null)
      ).rejects.toThrow('queryEmbedding must be an array');
    });

    it('should throw error for non-numeric embedding values', async () => {
      const invalidEmbedding = ['not', 'numbers'];
      await expect(
        searchForSimilarVectors(invalidEmbedding as any, false, null)
      ).rejects.toThrow('queryEmbedding must contain only numbers');
    });

    it('should apply metadata filter for anchor search', async () => {
      const embedding = new Array(3072).fill(0.1);
      await searchForSimilarVectors(embedding, true, AnchorSet.Main, 5, 'default');

      const queryCall = mockNamespace.query.mock.calls[0][0];
      expect(queryCall.filter).toEqual({
        isAnchor: { "$eq": true },
        anchorSet: { "$eq": AnchorSet.Main }
      });
    });

    it('should handle Pinecone query errors', async () => {
      mockNamespace.query.mockRejectedValueOnce(new Error('Pinecone error'));

      await expect(
        searchForSimilarVectors(new Array(3072).fill(0.1), false, null)
      ).rejects.toThrow('Pinecone error');
    });
  });

  describe('processContentToStoreEmbedding', () => {
    it('should process and store embeddings successfully', async () => {
      const markdown = 'Test markdown content';
      const result = await processContentToStoreEmbedding(
        markdown,
        123,
        456,
        false,
        'test-namespace'
      );

      expect(result).toEqual({
        success: true,
        chunkCount: 3, // Based on mock splitter returning 3 chunks
        namespace: 'test-namespace'
      });
      expect(mockNamespace.upsert).toHaveBeenCalled();
    });

    it('should throw error for missing markdown', async () => {
      await expect(
        processContentToStoreEmbedding('', 123, 456)
      ).rejects.toThrow('Markdown text is required');
    });

    it('should throw error for invalid explanation_id', async () => {
      await expect(
        processContentToStoreEmbedding('text', 'not a number' as any, 456)
      ).rejects.toThrow('explanation_id must be a number');
    });

    it('should throw error for invalid topic_id', async () => {
      await expect(
        processContentToStoreEmbedding('text', 123, 'not a number' as any)
      ).rejects.toThrow('topic_id must be a number');
    });

    it('should use default namespace when not specified', async () => {
      await processContentToStoreEmbedding('text', 123, 456);

      expect(mockIndex.namespace).toHaveBeenCalledWith('default');
    });

    it('should handle embedding creation errors', async () => {
      mockOpenAIInstance.embeddings.create.mockRejectedValueOnce(new Error('OpenAI error'));

      await expect(
        processContentToStoreEmbedding('text', 123, 456)
      ).rejects.toThrow('OpenAI error');
    });

    it('should handle upsert errors', async () => {
      mockNamespace.upsert.mockRejectedValueOnce(new Error('Upsert failed'));

      await expect(
        processContentToStoreEmbedding('text', 123, 456)
      ).rejects.toThrow('Upsert failed');
    });
  });

  describe('loadFromPineconeUsingExplanationId', () => {
    it('should load vector by explanation ID successfully', async () => {
      const result = await loadFromPineconeUsingExplanationId(123, 'default');

      expect(mockNamespace.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            explanation_id: { "$eq": 123 }
          },
          topK: 1,
          includeMetadata: true,
          includeValues: true
        })
      );
      expect(result).toEqual(expect.objectContaining({
        id: 'match1',
        score: 0.9
      }));
    });

    it('should return null when no matches found', async () => {
      mockNamespace.query.mockResolvedValueOnce({ matches: [] });

      const result = await loadFromPineconeUsingExplanationId(999);

      expect(result).toBeNull();
    });

    it('should throw error for invalid explanation ID', async () => {
      await expect(
        loadFromPineconeUsingExplanationId('not a number' as any)
      ).rejects.toThrow('explanationId must be a number');
    });

    it('should handle vectors with alternative property names', async () => {
      mockNamespace.query.mockResolvedValueOnce({
        matches: [{
          id: 'match1',
          score: 0.9,
          vector: new Array(3072).fill(0.1), // Uses 'vector' instead of 'values'
          metadata: {}
        }]
      });

      const result = await loadFromPineconeUsingExplanationId(123);

      expect(result.values).toBeDefined();
      expect(result.values).toHaveLength(3072);
    });

    it('should handle Pinecone query errors', async () => {
      mockNamespace.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(
        loadFromPineconeUsingExplanationId(123)
      ).rejects.toThrow('Query failed');
    });

    it('should use the correct namespace', async () => {
      await loadFromPineconeUsingExplanationId(123, 'custom-namespace');

      expect(mockIndex.namespace).toHaveBeenCalledWith('custom-namespace');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle OpenAI API rate limiting', async () => {
      mockOpenAIInstance.embeddings.create.mockRejectedValueOnce(
        new Error('Rate limit exceeded')
      );

      await expect(
        findMatchesInVectorDb('test', false, null)
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle Pinecone connection errors', async () => {
      mockIndex.namespace.mockImplementationOnce(() => {
        throw new Error('Connection timeout');
      });

      await expect(
        searchForSimilarVectors(new Array(3072).fill(0.1), false, null)
      ).rejects.toThrow('Connection timeout');
    });

    it('should handle large text chunks', async () => {
      const largeText = 'x'.repeat(100000);

      // Mock splitter to handle large text
      (RecursiveCharacterTextSplitter as unknown as jest.Mock).mockImplementationOnce(() => ({
        splitText: jest.fn().mockResolvedValue(
          Array(10).fill('chunk').map((c, i) => `${c}${i}`)
        )
      }));

      const result = await processContentToStoreEmbedding(largeText, 123, 456);

      expect(result.chunkCount).toBe(10);
      expect(mockNamespace.upsert).toHaveBeenCalled();
    });

    it('should handle concurrent batch processing in upsert', async () => {
      // Create more chunks than batch size to test batching
      const manyChunks = Array(250).fill('chunk').map((c, i) => `${c}${i}`);
      (RecursiveCharacterTextSplitter as unknown as jest.Mock).mockImplementationOnce(() => ({
        splitText: jest.fn().mockResolvedValue(manyChunks)
      }));

      const result = await processContentToStoreEmbedding('text', 123, 456);

      expect(result.chunkCount).toBe(250);
      // Should be called multiple times due to batching
      expect(mockNamespace.upsert.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('deleteVectorsByExplanationId', () => {
    it('should delete vectors by explanation ID', async () => {
      // Mock query response with matching vectors
      const mockVectorIds = ['vec-0', 'vec-1', 'vec-2'];
      mockNamespace.query.mockResolvedValueOnce({
        matches: mockVectorIds.map(id => ({ id }))
      });
      mockNamespace.deleteMany = jest.fn().mockResolvedValue({});

      const count = await deleteVectorsByExplanationId(123);

      // Verify query was called with correct filter
      expect(mockNamespace.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            explanation_id: { "$eq": 123 }
          },
          topK: 10000,
          includeMetadata: false
        })
      );
      expect(mockNamespace.deleteMany).toHaveBeenCalledWith(mockVectorIds);
      expect(count).toBe(3);
    });

    it('should return 0 when no vectors found', async () => {
      mockNamespace.query.mockResolvedValueOnce({ matches: [] });
      mockNamespace.deleteMany = jest.fn();

      const count = await deleteVectorsByExplanationId(999);

      expect(count).toBe(0);
      expect(mockNamespace.deleteMany).not.toHaveBeenCalled();
    });

    it('should handle null matches response', async () => {
      mockNamespace.query.mockResolvedValueOnce({ matches: null });
      mockNamespace.deleteMany = jest.fn();

      const count = await deleteVectorsByExplanationId(999);

      expect(count).toBe(0);
      expect(mockNamespace.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete in batches when many vectors exist', async () => {
      // Create 1500 mock vector IDs (more than batch size of 1000)
      const mockVectorIds = Array.from({ length: 1500 }, (_, i) => `vec-${i}`);
      mockNamespace.query.mockResolvedValueOnce({
        matches: mockVectorIds.map(id => ({ id }))
      });
      mockNamespace.deleteMany = jest.fn().mockResolvedValue({});

      const count = await deleteVectorsByExplanationId(123);

      expect(count).toBe(1500);
      // Should be called twice: first batch of 1000, second batch of 500
      expect(mockNamespace.deleteMany).toHaveBeenCalledTimes(2);
      expect(mockNamespace.deleteMany).toHaveBeenNthCalledWith(1, mockVectorIds.slice(0, 1000));
      expect(mockNamespace.deleteMany).toHaveBeenNthCalledWith(2, mockVectorIds.slice(1000));
    });

    it('should throw error for invalid explanation ID type', async () => {
      await expect(
        deleteVectorsByExplanationId('not-a-number' as unknown as number)
      ).rejects.toThrow('explanationId must be a number');
    });

    it('should handle Pinecone query errors', async () => {
      mockNamespace.query.mockRejectedValueOnce(new Error('Pinecone connection failed'));

      await expect(deleteVectorsByExplanationId(123)).rejects.toThrow('Pinecone connection failed');
    });

    it('should handle Pinecone delete errors', async () => {
      mockNamespace.query.mockResolvedValueOnce({
        matches: [{ id: 'vec-0' }]
      });
      mockNamespace.deleteMany = jest.fn().mockRejectedValue(new Error('Delete failed'));

      await expect(deleteVectorsByExplanationId(123)).rejects.toThrow('Delete failed');
    });

    it('should use custom namespace when provided', async () => {
      mockNamespace.query.mockResolvedValueOnce({ matches: [] });

      await deleteVectorsByExplanationId(123, 'custom-namespace');

      expect(mockIndex.namespace).toHaveBeenCalledWith('custom-namespace');
    });
  });
});