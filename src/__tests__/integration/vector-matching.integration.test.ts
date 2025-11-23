/**
 * Integration Test: Vector Similarity Match Flow
 *
 * Tests vector search and matching with real database and mocked Pinecone/OpenAI
 * This validates:
 * - Vector embedding creation and query
 * - Pinecone similarity search with metadata filters
 * - Anchor set filtering logic
 * - Score calculation and threshold logic
 * - Match vs. no-match decision flow
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { createTestVectorData, createTestVectorBatch } from '@/testing/fixtures/database-records';
import { SupabaseClient } from '@supabase/supabase-js';

// Access global mocks from jest.integration-setup.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PineconeMock = require('@pinecone-database/pinecone');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenAIMock = require('openai').default;

// Get mock functions from global mocks
const mockPineconeQuery = PineconeMock.__mockQuery;
const mockPineconeUpsert = PineconeMock.__mockUpsert;
const mockPineconeFetch = PineconeMock.__mockFetch;
const mockOpenAIEmbeddingsCreate = OpenAIMock.__mockEmbeddingsCreate;
const mockOpenAIChatCreate = OpenAIMock.__mockChatCreate;

// Import vectorsim functions (uses global mocks)
import {
  findMatchesInVectorDb,
  calculateAllowedScores,
  searchForSimilarVectors,
} from '@/lib/services/vectorsim';
import { AnchorSet } from '@/lib/schemas/schemas';

describe('Vector Matching Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Set up test database connection
    supabase = await setupTestDatabase();
    console.log('Vector matching integration tests: Database setup complete');
  });

  afterAll(async () => {
    // Clean up all test data
    await teardownTestDatabase(supabase);
    console.log('Vector matching integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    // Create test context for each test
    const context = await createTestContext();
    testId = context.testId;
    cleanup = context.cleanup;

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test data after each test
    await cleanup();
  });

  describe('High Similarity Match Found', () => {
    it('should return high-scoring match when vector similarity exceeds threshold', async () => {
      // Arrange - create realistic mock embedding and high-similarity match
      const mockEmbedding = Array(3072).fill(0).map(() => Math.random());
      const explanationId = `${testId}-explanation-1`;

      // Mock OpenAI embedding creation
      mockOpenAIEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Pinecone high-similarity match
      const highSimilarityMatch = createTestVectorData(explanationId, 3072, {
        topic: 'Quantum Physics',
        title: 'What is Quantum Entanglement?',
        content_preview: 'Quantum entanglement is a physical phenomenon...',
      });

      mockPineconeQuery.mockResolvedValueOnce({
        matches: [
          {
            id: highSimilarityMatch.id,
            score: 0.92, // High similarity score
            metadata: highSimilarityMatch.metadata,
            values: highSimilarityMatch.values,
          },
        ],
      });

      // Act - call the actual function
      const query = 'What is quantum entanglement?';
      const results = await findMatchesInVectorDb(query, false, null, 5, 'test');

      // Assert
      expect(mockOpenAIEmbeddingsCreate).toHaveBeenCalledTimes(1);
      expect(mockOpenAIEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: query,
      });

      expect(mockPineconeQuery).toHaveBeenCalledTimes(1);
      expect(mockPineconeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          vector: mockEmbedding,
          topK: 5,
          includeMetadata: true,
          includeValues: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.92);
      expect(results[0].metadata.title).toBe('What is Quantum Entanglement?');
    });
  });

  describe('Low Similarity - Below Threshold', () => {
    it('should return low scores when vector similarity is below threshold', async () => {
      // Arrange - create mock embedding and low-similarity match
      const mockEmbedding = Array(3072).fill(0).map(() => Math.random());
      const explanationId = `${testId}-explanation-2`;

      mockOpenAIEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Pinecone low-similarity match
      const lowSimilarityMatch = createTestVectorData(explanationId, 3072, {
        topic: 'Cooking',
        title: 'How to bake a cake',
        content_preview: 'Baking a cake requires flour, eggs, and sugar...',
      });

      mockPineconeQuery.mockResolvedValueOnce({
        matches: [
          {
            id: lowSimilarityMatch.id,
            score: 0.32, // Low similarity score
            metadata: lowSimilarityMatch.metadata,
            values: lowSimilarityMatch.values,
          },
        ],
      });

      // Act
      const query = 'What is quantum entanglement?';
      const results = await findMatchesInVectorDb(query, false, null, 5, 'test');

      // Assert - verify low similarity match is returned
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.32);
      expect(results[0].metadata.topic).toBe('Cooking');
      expect(results[0].metadata.title).toBe('How to bake a cake');
    });
  });

  describe('Multiple Matches with Diversity Selection', () => {
    it('should return multiple matches ranked by similarity', async () => {
      // Arrange - create multiple matches with varying similarity scores
      const mockEmbedding = Array(3072).fill(0).map(() => Math.random());
      const testVectors = createTestVectorBatch(4, 3072);

      mockOpenAIEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Pinecone returning multiple matches with diversity
      mockPineconeQuery.mockResolvedValueOnce({
        matches: [
          {
            id: testVectors[0].id,
            score: 0.88,
            metadata: { ...testVectors[0].metadata, topic: 'Physics' },
            values: testVectors[0].values,
          },
          {
            id: testVectors[1].id,
            score: 0.85,
            metadata: { ...testVectors[1].metadata, topic: 'Physics' },
            values: testVectors[1].values,
          },
          {
            id: testVectors[2].id,
            score: 0.82,
            metadata: { ...testVectors[2].metadata, topic: 'Chemistry' },
            values: testVectors[2].values,
          },
          {
            id: testVectors[3].id,
            score: 0.78,
            metadata: { ...testVectors[3].metadata, topic: 'Mathematics' },
            values: testVectors[3].values,
          },
        ],
      });

      // Act
      const query = 'What is quantum physics?';
      const results = await findMatchesInVectorDb(query, false, null, 5, 'test');

      // Assert - verify multiple matches are returned in order
      expect(results).toHaveLength(4);
      expect(results[0].score).toBe(0.88);
      expect(results[0].metadata.topic).toBe('Physics');
      expect(results[1].score).toBe(0.85);
      expect(results[2].score).toBe(0.82);
      expect(results[2].metadata.topic).toBe('Chemistry');
      expect(results[3].score).toBe(0.78);
      expect(results[3].metadata.topic).toBe('Mathematics');

      // Verify scores are in descending order
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });

  describe('Empty Pinecone Results', () => {
    it('should handle case when Pinecone returns no matches', async () => {
      // Arrange - create mock embedding but no matches found
      const mockEmbedding = Array(3072).fill(0).map(() => Math.random());

      mockOpenAIEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Pinecone returning empty results
      mockPineconeQuery.mockResolvedValueOnce({
        matches: [],
      });

      // Act
      const query = 'A completely unique query about xenomorphic crystallography';
      const results = await findMatchesInVectorDb(query, false, null, 5, 'test');

      // Assert - verify empty results are handled correctly
      expect(results).toEqual([]);
      expect(results).toHaveLength(0);
      expect(mockOpenAIEmbeddingsCreate).toHaveBeenCalledTimes(1);
      expect(mockPineconeQuery).toHaveBeenCalledTimes(1);
      // In real flow, this should trigger new explanation generation in returnExplanation
    });
  });

  describe('Anchor Set Filtering', () => {
    it('should filter vectors by anchor set when searching anchor vectors', async () => {
      // Arrange - create mock embedding and anchor vectors
      const mockEmbedding = Array(3072).fill(0).map(() => Math.random());
      const anchorId = `${testId}-anchor-1`;
      const anchorSetValue = 'physics-fundamentals' as AnchorSet;

      mockOpenAIEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Pinecone returning anchor vectors with metadata filter
      const anchorVector = createTestVectorData(anchorId, 3072, {
        topic: 'Test Anchor Topic',
        title: 'Anchor Explanation',
        isAnchor: true,
        anchorSet: anchorSetValue,
        presetTagId: 123,
      });

      mockPineconeQuery.mockResolvedValueOnce({
        matches: [
          {
            id: anchorVector.id,
            score: 0.75,
            metadata: anchorVector.metadata,
            values: anchorVector.values,
          },
        ],
      });

      // Act - call with anchor filtering enabled
      const query = 'physics fundamentals';
      const results = await findMatchesInVectorDb(query, true, anchorSetValue, 5, 'test');

      // Assert - verify query was called with metadata filter
      expect(mockPineconeQuery).toHaveBeenCalledTimes(1);
      expect(mockPineconeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          vector: mockEmbedding,
          topK: 5,
          includeMetadata: true,
          includeValues: true,
          filter: {
            isAnchor: { '$eq': true },
            anchorSet: { '$eq': anchorSetValue },
          },
        })
      );

      // Verify results
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.75);
      expect(results[0].metadata.isAnchor).toBe(true);
      expect(results[0].metadata.anchorSet).toBe(anchorSetValue);
    });
  });

  describe('Calculate Allowed Scores', () => {
    it('should calculate scores correctly from anchor and explanation matches', async () => {
      // Arrange - create mock match data
      const anchorMatches = [
        { id: '1', score: 0.8, metadata: {} },
      ];

      const explanationMatches = [
        { id: '2', score: 0.7, metadata: {} },
        { id: '3', score: 0.6, metadata: {} },
        { id: '4', score: 0.5, metadata: {} },
      ];

      // Act
      const result = await calculateAllowedScores(anchorMatches, explanationMatches);

      // Assert
      // anchorScore = sum of anchor similarities / maxNumberAnchors = 0.8 / 1 = 0.8
      // explanationScore = average of top 3 = (0.7 + 0.6 + 0.5) / 3 = 0.6
      // allowedTitle = anchorScore >= 0 (temporarily set to always true)
      expect(result.anchorScore).toBe(0.8);
      expect(result.explanationScore).toBeCloseTo(0.6, 2);
      expect(result.allowedTitle).toBe(true);
    });

    it('should handle less than 3 explanation matches by padding with zeros', async () => {
      // Arrange
      const anchorMatches = [{ id: '1', score: 0.9, metadata: {} }];
      const explanationMatches = [{ id: '2', score: 0.8, metadata: {} }];

      // Act
      const result = await calculateAllowedScores(anchorMatches, explanationMatches);

      // Assert
      // explanationScore = (0.8 + 0 + 0) / 3 = 0.2667
      expect(result.anchorScore).toBe(0.9);
      expect(result.explanationScore).toBeCloseTo(0.267, 2);
      expect(result.allowedTitle).toBe(true);
    });
  });
});
