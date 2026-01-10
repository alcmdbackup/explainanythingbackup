/**
 * @jest-environment node
 */

import {
  createMappingsHeadingsToLinks,
  enhanceContentWithInlineLinks,
  cleanupAfterEnhancements,
  createLinksInContentPrompt
} from './links';
import { callOpenAIModel } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { ServiceError } from '@/lib/errors/serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';

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
  createStandaloneTitlePrompt: jest.fn((articleTitle, headings) =>
    `Create standalone titles for headings in "${articleTitle}": ${headings.join(', ')}`
  )
}));

describe('Links Service', () => {
  const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createMappingsHeadingsToLinks', () => {
    it('should return empty object when no headings found', async () => {
      // Arrange
      const content = 'This is just plain text without any headings.';

      // Act
      const result = await createMappingsHeadingsToLinks(content, 'Test Article', 'user123');

      // Assert
      expect(result).toEqual({});
      expect(mockCallOpenAIModel).not.toHaveBeenCalled();
    });

    it('should create mappings for h2 and h3 headings', async () => {
      // Arrange
      const content = `## Introduction
Some text here.
### Background
More text.
## Conclusion`;

      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['Introduction to Testing', 'Background of Testing', 'Conclusion of Testing']
      }));

      // Act
      const result = await createMappingsHeadingsToLinks(content, 'Testing Guide', 'user123');

      // Assert
      expect(Object.keys(result)).toHaveLength(3);
      expect(result['## Introduction']).toContain('[Introduction](/standalone-title?t=');
      expect(result['### Background']).toContain('[Background](/standalone-title?t=');
      expect(result['## Conclusion']).toContain('[Conclusion](/standalone-title?t=');
    });

    it('should encode special characters in URLs', async () => {
      // Arrange
      const content = '## Test Heading';
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['Test (With Parentheses)']
      }));

      // Act
      const result = await createMappingsHeadingsToLinks(content, 'Test', 'user123');

      // Assert
      expect(result['## Test Heading']).toContain('%28');
      expect(result['## Test Heading']).toContain('%29');
    });

    it('should throw ServiceError on AI response parsing errors', async () => {
      // Arrange
      const content = '## Test';
      mockCallOpenAIModel.mockResolvedValue('invalid json');

      // Act & Assert
      try {
        await createMappingsHeadingsToLinks(content, 'Test', 'user123');
        fail('Expected ServiceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe(ERROR_CODES.LLM_API_ERROR);
        expect((error as ServiceError).context).toBe('createMappingsHeadingsToLinks');
      }
    });

    it('should throw ServiceError when articleTitle is missing', async () => {
      // Arrange
      const content = '## Test';

      // Act & Assert
      try {
        await createMappingsHeadingsToLinks(content, '', 'user123');
        fail('Expected ServiceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe(ERROR_CODES.LLM_API_ERROR);
        expect((error as ServiceError).context).toBe('createMappingsHeadingsToLinks');
      }
    });

    it('should throw ServiceError when LLM fails', async () => {
      // Arrange
      const content = '## Test';
      mockCallOpenAIModel.mockRejectedValue(new Error('LLM Error'));

      // Act & Assert
      try {
        await createMappingsHeadingsToLinks(content, 'Test', 'user123');
        fail('Expected ServiceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe(ERROR_CODES.LLM_API_ERROR);
        expect((error as ServiceError).context).toBe('createMappingsHeadingsToLinks');
      }
    });

    it('should log debug info when debug flag is true', async () => {
      // Arrange
      const content = '## Test';
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['Test Title']
      }));

      // Act
      await createMappingsHeadingsToLinks(content, 'Test', 'user123', true);

      // Assert
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle mismatched array lengths', async () => {
      // Arrange
      const content = '## First\n## Second';
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['Only One Title'] // Only 1 title for 2 headings
      }));

      // Act
      const result = await createMappingsHeadingsToLinks(content, 'Test', 'user123');

      // Assert - should only create mapping for first heading
      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  describe('enhanceContentWithInlineLinks', () => {
    it('should throw error when content is empty', async () => {
      // Act & Assert
      await expect(enhanceContentWithInlineLinks('', 'user123')).rejects.toThrow('Content is required');
    });

    it('should enhance content with inline links', async () => {
      // Arrange
      const content = 'Machine learning is powerful.';
      const enhancedContent = 'Machine [learning](/standalone-title?t=Machine%20Learning) is powerful.';
      mockCallOpenAIModel.mockResolvedValue(enhancedContent);

      // Act
      const result = await enhanceContentWithInlineLinks(content, 'user123');

      // Assert
      expect(result).toBe(enhancedContent);
      expect(mockCallOpenAIModel).toHaveBeenCalled();
    });

    it('should throw ServiceError when AI fails', async () => {
      // Arrange
      const content = 'Machine learning is powerful.';
      mockCallOpenAIModel.mockRejectedValue(new Error('AI Error'));

      // Act & Assert
      try {
        await enhanceContentWithInlineLinks(content, 'user123');
        fail('Expected ServiceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe(ERROR_CODES.LLM_API_ERROR);
        expect((error as ServiceError).context).toBe('enhanceContentWithInlineLinks');
      }
    });

    it('should log debug info when debug flag is true', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue('Enhanced content');

      // Act
      await enhanceContentWithInlineLinks('Test content', 'user123', true);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        'Enhancing content with inline links',
        expect.any(Object)
      );
    });

    it('should trim whitespace from enhanced content', async () => {
      // Arrange
      mockCallOpenAIModel.mockResolvedValue('  Enhanced content  \n');

      // Act
      const result = await enhanceContentWithInlineLinks('Test', 'user123');

      // Assert
      expect(result).toBe('Enhanced content');
    });
  });

  describe('cleanupAfterEnhancements', () => {
    it('should remove **bold** markers from text', () => {
      // Arrange
      const content = 'This has **bold text** and **more bold**.';

      // Act
      const result = cleanupAfterEnhancements(content);

      // Assert
      expect(result).toBe('This has bold text and more bold.');
    });

    it('should handle content without bold markers', () => {
      // Arrange
      const content = 'This is plain text.';

      // Act
      const result = cleanupAfterEnhancements(content);

      // Assert
      expect(result).toBe(content);
    });

    it('should handle multiple bold patterns in sequence', () => {
      // Arrange
      const content = '**first****second****third**';

      // Act
      const result = cleanupAfterEnhancements(content);

      // Assert
      expect(result).toBe('firstsecondthird');
    });

    it('should handle empty content', () => {
      // Act
      const result = cleanupAfterEnhancements('');

      // Assert
      expect(result).toBe('');
    });
  });

  describe('createLinksInContentPrompt', () => {
    it('should create a prompt with content', () => {
      // Arrange
      const content = 'Machine learning is powerful.';

      // Act
      const result = createLinksInContentPrompt(content);

      // Assert
      expect(result).toContain(content);
      expect(result).toContain('markdown');
      expect(result).toContain('standalone-title');
    });

    it('should include instructions for link format', () => {
      // Act
      const result = createLinksInContentPrompt('Test content');

      // Assert
      expect(result).toContain('[term](/standalone-title?t=');
      expect(result).toContain('encode');
    });
  });
});
