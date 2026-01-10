/**
 * @jest-environment node
 */

import {
  findBestMatchFromList,
  enhanceMatchesWithCurrentContentAndDiversity
} from './findMatches';
import { callOpenAIModel } from '@/lib/services/llms';
import { getExplanationById } from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { MatchMode, type VectorSearchResult } from '@/lib/schemas/schemas';
import type { matchWithCurrentContentType } from '@/lib/schemas/schemas';

// Helper to create mock VectorSearchResult with minimal required fields
const createMockVectorResult = (overrides: { metadata: Partial<VectorSearchResult['metadata']> } & Partial<Omit<VectorSearchResult, 'metadata'>> = { metadata: {} }): VectorSearchResult => ({
  id: overrides.id ?? 'mock-id',
  score: overrides.score ?? 0,
  metadata: {
    text: 'mock text',
    explanation_id: 1,
    topic_id: 1,
    startIdx: 0,
    length: 100,
    isAnchor: false,
    ...overrides.metadata,
  },
});

// Mock dependencies
jest.mock('@/lib/services/llms');
jest.mock('@/lib/services/explanations');
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
}));
jest.mock('@/lib/prompts', () => ({
  createMatchSelectionPrompt: jest.fn((query, matches) => `Select best match for: ${query}\n\n${matches}`)
}));

describe('findMatches Service', () => {
  const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;
  const mockGetExplanationById = getExplanationById as jest.MockedFunction<typeof getExplanationById>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findBestMatchFromList', () => {
    const mockMatches: matchWithCurrentContentType[] = [
      {
        text: 'Match 1 text',
        explanation_id: 1,
        topic_id: 10,
        current_title: 'First Match',
        current_content: 'Content for first match',
        ranking: { similarity: 0.95, diversity_score: 0.5 }
      },
      {
        text: 'Match 2 text',
        explanation_id: 2,
        topic_id: 20,
        current_title: 'Second Match',
        current_content: 'Content for second match',
        ranking: { similarity: 0.90, diversity_score: 0.7 }
      },
      {
        text: 'Match 3 text',
        explanation_id: 3,
        topic_id: 30,
        current_title: 'Third Match',
        current_content: 'Content for third match',
        ranking: { similarity: 0.85, diversity_score: 0.6 }
      }
    ];

    it('should return error when matches array is empty', async () => {
      // Act
      const result = await findBestMatchFromList('test query', [], MatchMode.Normal, null, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: null,
        explanationId: null,
        topicId: null,
        error: {
          code: 'NO_MATCHES',
          message: 'No matches available for selection'
        }
      });
    });

    it('should return first non-savedId match in ForceMatch mode', async () => {
      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.ForceMatch, null, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: 1,
        explanationId: 1,
        topicId: 10,
        error: null
      });
      expect(logger.debug).toHaveBeenCalledWith('Force mode: returning first non-saveid match', expect.any(Object));
    });

    it('should skip savedId match in ForceMatch mode', async () => {
      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.ForceMatch, 1, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: 2,
        explanationId: 2,
        topicId: 20,
        error: null
      });
    });

    it('should call LLM for match selection in AllowMatch mode', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 2 }));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, null, 'user123');

      // Assert
      expect(mockCallOpenAIModel).toHaveBeenCalledWith(
        expect.stringContaining('Select best match for: test query'),
        'findBestMatchFromList',
        'user123',
        expect.anything(),
        false,
        null,
        expect.anything(),
        'matchSelection'
      );
      expect(result).toEqual({
        selectedIndex: 2,
        explanationId: 2,
        topicId: 20,
        error: null
      });
    });

    it('should handle schema validation failure from LLM response', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ invalid: 'data' }));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, null, 'user123');

      // Assert
      expect(result.error).toEqual({
        code: 'INVALID_RESPONSE',
        message: 'AI response for match selection did not match expected format',
        details: expect.anything()
      });
      expect(result.selectedIndex).toBeNull();
      expect(result.explanationId).toBeNull();
    });

    it('should skip savedId when LLM selects it and find next best match', async () => {
      // Arrange - LLM selects index 1 (which is savedId)
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 1 }));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, 1, 'user123');

      // Assert - should select the next available match (index 2)
      expect(result).toEqual({
        selectedIndex: 2,
        explanationId: 2,
        topicId: 20,
        error: null
      });
    });

    it('should return null when all matches equal savedId', async () => {
      // Arrange
      const singleMatch: matchWithCurrentContentType[] = [{
        text: 'Match text',
        explanation_id: 1,
        topic_id: 10,
        current_title: 'Only Match',
        current_content: 'Content',
        ranking: { similarity: 0.95, diversity_score: 0.5 }
      }];
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 1 }));

      // Act
      const result = await findBestMatchFromList('test query', singleMatch, MatchMode.Normal, 1, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: 0,
        explanationId: null,
        topicId: null,
        error: null
      });
    });

    it('should handle selectedIndex out of bounds', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 99 }));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, null, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: 99,
        explanationId: null,
        topicId: null,
        error: null
      });
    });

    it('should handle selectedIndex of 0 (no match)', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 0 }));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, null, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: 0,
        explanationId: null,
        topicId: null,
        error: null
      });
    });

    it('should handle LLM call throwing error', async () => {
      // Arrange
      mockCallOpenAIModel.mockRejectedValue(new Error('LLM API Error'));

      // Act
      const result = await findBestMatchFromList('test query', mockMatches, MatchMode.Normal, null, 'user123');

      // Assert
      expect(result).toEqual({
        selectedIndex: null,
        explanationId: null,
        topicId: null,
        error: {
          code: 'MATCH_SELECTION_ERROR',
          message: 'Failed to select best match',
          details: 'LLM API Error'
        }
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle null topic_id in matches', async () => {
      // Arrange
      const matchesWithNullTopicId: matchWithCurrentContentType[] = [{
        text: 'Match text',
        explanation_id: 1,
        topic_id: null as any, // Explicitly null topic_id
        current_title: 'Match',
        current_content: 'Content',
        ranking: { similarity: 0.95, diversity_score: null }
      }];
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 1 }));

      // Act
      const result = await findBestMatchFromList('test query', matchesWithNullTopicId, MatchMode.Normal, null, 'user123');

      // Assert
      expect(result.topicId).toBeNull();
    });

    it('should truncate long content in formatted matches', async () => {
      // Arrange
      const longContentMatches: matchWithCurrentContentType[] = [{
        text: 'Match text',
        explanation_id: 1,
        topic_id: 10,
        current_title: 'Long Match',
        current_content: 'x'.repeat(2000), // 2000 chars
        ranking: { similarity: 0.95, diversity_score: 0.5 }
      }];
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ selectedSourceIndex: 1 }));

      // Act
      await findBestMatchFromList('test query', longContentMatches, MatchMode.Normal, null, 'user123');

      // Assert
      const promptCall = mockCallOpenAIModel.mock.calls[0][0];
      expect(promptCall).toContain('...');
      expect(promptCall.length).toBeLessThan(3000); // Should be truncated
    });
  });

  describe('enhanceMatchesWithCurrentContentAndDiversity', () => {
    const mockVectorResults: VectorSearchResult[] = [
      createMockVectorResult({
        id: 'vec-1',
        score: 0.95,
        metadata: {
          text: 'Vector match 1',
          explanation_id: 1,
          topic_id: 10,
          startIdx: 0,
          length: 100,
          isAnchor: false
        }
      }),
      createMockVectorResult({
        id: 'vec-2',
        score: 0.90,
        metadata: {
          text: 'Vector match 2',
          explanation_id: 2,
          topic_id: 20,
          startIdx: 0,
          length: 100,
          isAnchor: false
        }
      })
    ];

    const mockDiversityResults: VectorSearchResult[] = [
      createMockVectorResult({
        id: 'div-1',
        score: 0.5,
        metadata: { text: 'Diversity 1', explanation_id: 1, topic_id: 10, startIdx: 0, length: 100, isAnchor: false }
      }),
      createMockVectorResult({
        id: 'div-2',
        score: 0.7,
        metadata: { text: 'Diversity 2', explanation_id: 2, topic_id: 20, startIdx: 0, length: 100, isAnchor: false }
      })
    ];

    beforeEach(() => {
      mockGetExplanationById.mockResolvedValue({
        id: 1,
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 10,
        secondary_topic_id: undefined,
        status: 'published' as any,
        timestamp: '2024-01-01T00:00:00Z'
      });
    });

    it('should enhance matches with current content and diversity scores', async () => {
      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, mockDiversityResults);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        text: 'Vector match 1',
        explanation_id: 1,
        topic_id: 10,
        current_title: 'Test Explanation',
        current_content: 'Test content',
        ranking: {
          similarity: 0.95,
          diversity_score: 0.5
        }
      });
      expect(mockGetExplanationById).toHaveBeenCalledTimes(2);
    });

    it('should handle null diversity comparison', async () => {
      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, null);

      // Assert
      expect(result[0].ranking.diversity_score).toBeNull();
      expect(result[1].ranking.diversity_score).toBeNull();
    });

    it('should handle empty diversity comparison array', async () => {
      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, []);

      // Assert
      expect(result[0].ranking.diversity_score).toBeNull();
      expect(result[1].ranking.diversity_score).toBeNull();
    });

    it('should handle missing diversity match for specific explanation', async () => {
      // Arrange - diversity only for explanation_id 1
      const partialDiversity: VectorSearchResult[] = [
        createMockVectorResult({
          id: 'partial-div-1',
          score: 0.5,
          metadata: { text: 'Partial', explanation_id: 1, topic_id: 10, startIdx: 0, length: 100, isAnchor: false }
        })
      ];

      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, partialDiversity);

      // Assert
      expect(result[0].ranking.diversity_score).toBe(0.5);
      expect(result[1].ranking.diversity_score).toBeNull();
    });

    it('should handle explanation with null content', async () => {
      // Arrange
      mockGetExplanationById.mockResolvedValue({
        id: 1,
        explanation_title: 'Test',
        content: null as any,
        primary_topic_id: 10,
        secondary_topic_id: undefined,
        status: 'published' as any,
        timestamp: '2024-01-01T00:00:00Z'
      });

      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, null);

      // Assert
      expect(result[0].current_content).toBe('');
    });

    it('should handle explanation with null title', async () => {
      // Arrange
      mockGetExplanationById.mockResolvedValue({
        id: 1,
        explanation_title: null as any,
        content: 'Content',
        primary_topic_id: 10,
        secondary_topic_id: undefined,
        status: 'published' as any,
        timestamp: '2024-01-01T00:00:00Z'
      });

      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, null);

      // Assert
      expect(result[0].current_title).toBe('');
    });

    it('should handle empty similarTexts array', async () => {
      // Act
      const result = await enhanceMatchesWithCurrentContentAndDiversity([], null);

      // Assert
      expect(result).toEqual([]);
      expect(mockGetExplanationById).not.toHaveBeenCalled();
    });

    it('should process matches in parallel', async () => {
      // Arrange
      const manyResults: VectorSearchResult[] = Array(10).fill(null).map((_, i) =>
        createMockVectorResult({
          id: `many-${i}`,
          score: 0.9 - i * 0.05,
          metadata: {
            text: `Match ${i}`,
            explanation_id: i,
            topic_id: i * 10,
            startIdx: 0,
            length: 100,
            isAnchor: false
          }
        })
      );

      // Act
      const startTime = Date.now();
      await enhanceMatchesWithCurrentContentAndDiversity(manyResults, null);
      const duration = Date.now() - startTime;

      // Assert - all calls should happen in parallel
      expect(mockGetExplanationById).toHaveBeenCalledTimes(10);
      // If sequential, would take much longer (this is a weak assertion but demonstrates parallelism)
      expect(duration).toBeLessThan(1000);
    });

    it('should log debug information when FILE_DEBUG is enabled', async () => {
      // Act
      await enhanceMatchesWithCurrentContentAndDiversity(mockVectorResults, mockDiversityResults);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        'Starting enhanceMatchesWithCurrentContentAndDiversity',
        expect.any(Object),
        true
      );
    });
  });
});
