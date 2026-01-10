/**
 * @jest-environment node
 */

import { evaluateTags } from './tagEvaluation';
import { callOpenAIModel } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';

// Mock dependencies
jest.mock('@/lib/services/llms');
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
}));
jest.mock('@/lib/prompts', () => ({
  createTagEvaluationPrompt: jest.fn((title, content) =>
    `Evaluate tags for "${title}" with content length ${content.length}`
  )
}));

describe('Tag Evaluation Service', () => {
  const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('evaluateTags', () => {
    it('should evaluate tags successfully', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        difficultyLevel: 2,
        length: 5,
        simpleTags: [1, 3, 7]
      }));

      // Act
      const result = await evaluateTags('Test Title', 'Test content', 'user123');

      // Assert
      expect(result).toEqual({
        difficultyLevel: 2,
        length: 5,
        simpleTags: [1, 3, 7],
        error: null
      });
      expect(mockCallOpenAIModel).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Successfully evaluated explanation tags',
        expect.any(Object)
      );
    });

    it('should handle schema validation failure', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        invalid: 'data'
      }));

      // Act
      const result = await evaluateTags('Test Title', 'Test content', 'user123');

      // Assert
      expect(result).toEqual({
        difficultyLevel: null,
        length: null,
        simpleTags: null,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'AI response for tag evaluation did not match expected format',
          details: expect.anything()
        }
      });
      expect(logger.debug).toHaveBeenCalledWith(
        'Tag evaluation schema validation failed',
        expect.any(Object)
      );
    });

    it('should handle LLM throwing error', async () => {
      // Arrange
      mockCallOpenAIModel.mockRejectedValue(new Error('LLM Error'));

      // Act
      const result = await evaluateTags('Test Title', 'Test content', 'user123');

      // Assert
      expect(result).toEqual({
        difficultyLevel: null,
        length: null,
        simpleTags: null,
        error: {
          code: 'TAG_EVALUATION_ERROR',
          message: 'Failed to evaluate explanation tags',
          details: 'LLM Error'
        }
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle JSON parsing error', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue('invalid json');

      // Act
      const result = await evaluateTags('Test Title', 'Test content', 'user123');

      // Assert
      expect(result.error).toBeTruthy();
      expect(result.error?.code).toBe('TAG_EVALUATION_ERROR');
    });

    it('should log debug information', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        difficultyLevel: 1,
        length: 4,
        simpleTags: []
      }));

      // Act
      await evaluateTags('Title', 'Content', 'user123');

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        'Calling GPT-4 for tag evaluation',
        expect.objectContaining({
          title: 'Title'
        })
      );
    });

    it('should handle empty simple tags array', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        difficultyLevel: 1,
        length: 4,
        simpleTags: []
      }));

      // Act
      const result = await evaluateTags('Title', 'Content', 'user123');

      // Assert
      expect(result.simpleTags).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('should handle boundary difficulty levels', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        difficultyLevel: 3, // Max difficulty
        length: 6, // Max length
        simpleTags: [1]
      }));

      // Act
      const result = await evaluateTags('Title', 'Content', 'user123');

      // Assert
      expect(result.difficultyLevel).toBe(3);
      expect(result.length).toBe(6);
    });
  });
});
