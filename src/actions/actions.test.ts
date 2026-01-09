// Mock vectorsim to avoid langchain dependencies
jest.mock('@/lib/services/vectorsim', () => ({}));

// Mock headers for server actions
jest.mock('next/headers', () => ({
  headers: jest.fn(() => ({
    get: jest.fn(() => 'test-request-id')
  }))
}));

// Mock the tag service functions
jest.mock('@/lib/services/tags', () => ({
  createTags: jest.fn(),
  getTagsById: jest.fn(),
  updateTag: jest.fn(),
  deleteTag: jest.fn(),
  getTagsByPresetId: jest.fn(),
  getAllTags: jest.fn(),
  getTempTagsForRewriteWithTags: jest.fn()
}));

// Mock the source cache service functions
jest.mock('@/lib/services/sourceCache', () => ({
  getSourcesByExplanationId: jest.fn()
}));

import {
  createTagsAction,
  getTagByIdAction,
  updateTagAction,
  deleteTagAction,
  getTagsByPresetIdAction,
  getAllTagsAction,
  getTempTagsForRewriteWithTagsAction,
  getSourcesForExplanationAction
} from './actions';
import {
  createTags,
  getTagsById,
  updateTag,
  deleteTag,
  getTagsByPresetId,
  getAllTags,
  getTempTagsForRewriteWithTags
} from '@/lib/services/tags';
import { TagFullDbType, TagInsertType, SourceCacheFullType } from '@/lib/schemas/schemas';
import { getSourcesByExplanationId } from '@/lib/services/sourceCache';

describe('Tag Server Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTagsAction', () => {
    it('should return success response when tags are created', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null
        }
      ];

      const createdTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      (createTags as jest.Mock).mockResolvedValue(createdTags);

      // Act
      const result = await createTagsAction(newTags);

      // Assert
      expect(result).toEqual({
        success: true,
        data: createdTags,
        error: null
      });
      expect(createTags).toHaveBeenCalledWith(newTags);
    });

    it('should return error response when creation fails', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'test',
          tag_description: 'Test tag',
          presetTagId: null
        }
      ];

      const mockError = new Error('Database error');
      (createTags as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await createTagsAction(newTags);

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBeDefined();
    });
  });

  describe('getTagByIdAction', () => {
    it('should return success response when tag is found', async () => {
      // Arrange
      const tagId = 1;
      const mockTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      (getTagsById as jest.Mock).mockResolvedValue(mockTags);

      // Act
      const result = await getTagByIdAction(tagId);

      // Assert
      expect(result).toEqual({
        success: true,
        data: mockTags[0],
        error: null
      });
      expect(getTagsById).toHaveBeenCalledWith([tagId]);
    });

    it('should return success with null data when tag is not found', async () => {
      // Arrange
      const tagId = 999;
      (getTagsById as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await getTagByIdAction(tagId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
    });

    it('should return error response when query fails', async () => {
      // Arrange
      const tagId = 1;
      const mockError = new Error('Database error');
      (getTagsById as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await getTagByIdAction(tagId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe('updateTagAction', () => {
    it('should return success response when tag is updated', async () => {
      // Arrange
      const tagId = 1;
      const updates: Partial<TagInsertType> = {
        tag_name: 'Updated Name'
      };

      const updatedTag: TagFullDbType = {
        id: 1,
        tag_name: 'Updated Name',
        tag_description: 'For beginners',
        presetTagId: null,
        created_at: '2024-01-01T00:00:00Z'
      };

      (updateTag as jest.Mock).mockResolvedValue(updatedTag);

      // Act
      const result = await updateTagAction(tagId, updates);

      // Assert
      expect(result).toEqual({
        success: true,
        data: updatedTag,
        error: null
      });
      expect(updateTag).toHaveBeenCalledWith(tagId, updates);
    });

    it('should return error response when update fails', async () => {
      // Arrange
      const tagId = 1;
      const updates: Partial<TagInsertType> = {
        tag_name: 'Updated Name'
      };

      const mockError = new Error('Update failed');
      (updateTag as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await updateTagAction(tagId, updates);

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe('deleteTagAction', () => {
    it('should return success response when tag is deleted', async () => {
      // Arrange
      const tagId = 1;
      (deleteTag as jest.Mock).mockResolvedValue(undefined);

      // Act
      const result = await deleteTagAction(tagId);

      // Assert
      expect(result).toEqual({
        success: true,
        error: null
      });
      expect(deleteTag).toHaveBeenCalledWith(tagId);
    });

    it('should return error response when deletion fails', async () => {
      // Arrange
      const tagId = 1;
      const mockError = new Error('Deletion failed');
      (deleteTag as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await deleteTagAction(tagId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getTagsByPresetIdAction', () => {
    it('should return success response when tags are found', async () => {
      // Arrange
      const presetTagIds = [1, 2];
      const mockTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'Easy',
          tag_description: 'Easy difficulty',
          presetTagId: 1,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];

      (getTagsByPresetId as jest.Mock).mockResolvedValue(mockTags);

      // Act
      const result = await getTagsByPresetIdAction(presetTagIds);

      // Assert
      expect(result).toEqual({
        success: true,
        data: mockTags,
        error: null
      });
      expect(getTagsByPresetId).toHaveBeenCalledWith(presetTagIds);
    });

    it('should return error response when query fails', async () => {
      // Arrange
      const presetTagIds = [1, 2];
      const mockError = new Error('Query failed');
      (getTagsByPresetId as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await getTagsByPresetIdAction(presetTagIds);

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe('getAllTagsAction', () => {
    it('should return success response when tags are retrieved', async () => {
      // Arrange
      const mockTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          tag_name: 'advanced',
          tag_description: 'For advanced users',
          presetTagId: null,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];

      (getAllTags as jest.Mock).mockResolvedValue(mockTags);

      // Act
      const result = await getAllTagsAction();

      // Assert
      expect(result).toEqual({
        success: true,
        data: mockTags,
        error: null
      });
      expect(getAllTags).toHaveBeenCalled();
    });

    it('should return error response when query fails', async () => {
      // Arrange
      const mockError = new Error('Query failed');
      (getAllTags as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await getAllTagsAction();

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe('getTempTagsForRewriteWithTagsAction', () => {
    it('should return success response when temp tags are retrieved', async () => {
      // Arrange
      const mockTags: any[] = [
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-02T00:00:00Z',
          tag_active_current: true,
          tag_active_initial: true
        },
        {
          id: 5,
          tag_name: 'Medium',
          tag_description: 'Medium length',
          presetTagId: 2,
          created_at: '2024-01-05T00:00:00Z',
          tag_active_current: true,
          tag_active_initial: true
        }
      ];

      (getTempTagsForRewriteWithTags as jest.Mock).mockResolvedValue(mockTags);

      // Act
      const result = await getTempTagsForRewriteWithTagsAction();

      // Assert
      expect(result).toEqual({
        success: true,
        data: mockTags,
        error: null
      });
      expect(getTempTagsForRewriteWithTags).toHaveBeenCalled();
    });

    it('should return error response when query fails', async () => {
      // Arrange
      const mockError = new Error('Query failed');
      (getTempTagsForRewriteWithTags as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await getTempTagsForRewriteWithTagsAction();

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });
  });
});

describe('Source Server Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSourcesForExplanationAction', () => {
    it('should return success response with mapped source chips', async () => {
      // Arrange
      const explanationId = 123;
      const mockSources: SourceCacheFullType[] = [
        {
          id: 1,
          url: 'https://example.com/article1',
          domain: 'example.com',
          title: 'Example Article 1',
          favicon_url: 'https://example.com/favicon.ico',
          fetch_status: 'success',
          extracted_text: 'Some content here',
          is_summarized: false,
          error_message: null,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          url: 'https://test.org/article2',
          domain: 'test.org',
          title: 'Test Article 2',
          favicon_url: 'https://test.org/favicon.ico',
          fetch_status: 'pending',
          extracted_text: null,
          is_summarized: false,
          error_message: null,
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 3,
          url: 'https://failed.com/article3',
          domain: 'failed.com',
          title: 'Failed Article',
          favicon_url: null,
          fetch_status: 'failed',
          extracted_text: null,
          is_summarized: false,
          error_message: 'Connection timeout',
          created_at: '2024-01-03T00:00:00Z'
        }
      ];

      (getSourcesByExplanationId as jest.Mock).mockResolvedValue(mockSources);

      // Act
      const result = await getSourcesForExplanationAction({ explanationId });

      // Assert
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(3);

      // Verify status mapping: success → success, pending → loading, failed → failed
      expect(result.data?.[0]).toEqual({
        url: 'https://example.com/article1',
        title: 'Example Article 1',
        favicon_url: 'https://example.com/favicon.ico',
        domain: 'example.com',
        status: 'success',
        error_message: null
      });
      expect(result.data?.[1]?.status).toBe('loading');
      expect(result.data?.[2]?.status).toBe('failed');
      expect(result.data?.[2]?.error_message).toBe('Connection timeout');

      expect(getSourcesByExplanationId).toHaveBeenCalledWith(explanationId);
    });

    it('should return empty array when no sources exist', async () => {
      // Arrange
      const explanationId = 456;
      (getSourcesByExplanationId as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await getSourcesForExplanationAction({ explanationId });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('should return empty array for E2E test mode mock IDs', async () => {
      // Arrange
      const originalEnv = process.env.E2E_TEST_MODE;
      process.env.E2E_TEST_MODE = 'true';
      const mockExplanationId = 90001; // >= 90000 triggers E2E mode

      // Act
      const result = await getSourcesForExplanationAction({ explanationId: mockExplanationId });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
      // getSourcesByExplanationId should NOT be called in E2E mode
      expect(getSourcesByExplanationId).not.toHaveBeenCalled();

      // Cleanup
      process.env.E2E_TEST_MODE = originalEnv;
    });

    it('should return error response when query fails', async () => {
      // Arrange
      const explanationId = 789;
      const mockError = new Error('Database connection failed');
      (getSourcesByExplanationId as jest.Mock).mockRejectedValue(mockError);

      // Act
      const result = await getSourcesForExplanationAction({ explanationId });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBeDefined();
    });
  });
});
