import {
  convertTagsToUIFormat,
  createTags,
  getTagsById,
  updateTag,
  deleteTag,
  searchTagsByName,
  getAllTags,
  getTagsByPresetId,
  getTempTagsForRewriteWithTags
} from './tags';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { TagFullDbType, TagInsertType, TagUIType } from '@/lib/schemas/schemas';

// Mock Supabase server client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

describe('Tags Service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock Supabase client with chainable methods
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };

    // Setup the mock to return our mockSupabase
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('convertTagsToUIFormat', () => {
    it('should convert simple tags (null presetTagId) to UI format', async () => {
      // Arrange
      const rawTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          tag_name: 'tutorial',
          tag_description: 'Tutorial content',
          presetTagId: null,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];

      // Act
      const result = await convertTagsToUIFormat(rawTags);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        tag_name: 'beginner',
        tag_active_current: true,
        tag_active_initial: true
      });
      expect(result[1]).toMatchObject({
        id: 2,
        tag_name: 'tutorial',
        tag_active_current: true,
        tag_active_initial: true
      });
    });

    it('should convert preset tags to UI format with all related tags', async () => {
      // Arrange
      const rawTags: TagFullDbType[] = [
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      const allPresetTags: TagFullDbType[] = [
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
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 3,
          tag_name: 'Hard',
          tag_description: 'Hard difficulty',
          presetTagId: 1,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      // Mock the getTagsByPresetId call within convertTagsToUIFormat
      mockSupabase.order.mockResolvedValue({
        data: allPresetTags,
        error: null
      });

      // Act
      const result = await convertTagsToUIFormat(rawTags);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        tags: allPresetTags,
        tag_active_current: true,
        tag_active_initial: true,
        currentActiveTagId: 2,
        originalTagId: 2
      });
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.in).toHaveBeenCalledWith('presetTagId', [1]);
    });

    it('should handle mixed simple and preset tags', async () => {
      // Arrange
      const rawTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
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

      const allPresetTags: TagFullDbType[] = [
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 3,
          tag_name: 'Hard',
          tag_description: 'Hard difficulty',
          presetTagId: 1,
          created_at: '2024-01-03T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({
        data: allPresetTags,
        error: null
      });

      // Act
      const result = await convertTagsToUIFormat(rawTags);

      // Assert
      expect(result).toHaveLength(2);
      // First should be simple tag
      expect(result[0]).toMatchObject({
        id: 1,
        tag_name: 'beginner',
        tag_active_current: true,
        tag_active_initial: true
      });
      // Second should be preset tag
      expect(result[1]).toMatchObject({
        tags: allPresetTags,
        currentActiveTagId: 2,
        originalTagId: 2
      });
    });

    it('should return empty array when given empty array', async () => {
      // Act
      const result = await convertTagsToUIFormat([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle database error when fetching preset tags', async () => {
      // Arrange
      const rawTags: TagFullDbType[] = [
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      const mockError = { message: 'Database error' };
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(convertTagsToUIFormat(rawTags)).rejects.toEqual(mockError);
    });
  });

  describe('createTags', () => {
    it('should create new tags successfully', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null
        },
        {
          tag_name: 'advanced',
          tag_description: 'For advanced users',
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
        },
        {
          id: 2,
          tag_name: 'advanced',
          tag_description: 'For advanced users',
          presetTagId: null,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];

      // First query: from('tags').select().in('tag_name', tagNames)
      // .select() returns this, .in() resolves
      mockSupabase.in.mockResolvedValueOnce({
        data: [],
        error: null
      });

      // Second query: from('tags').insert(newTags).select()
      // .select() resolves (after .insert() returns this)
      mockSupabase.select.mockReturnValueOnce(mockSupabase).mockResolvedValueOnce({
        data: createdTags,
        error: null
      });

      // Act
      const result = await createTags(newTags);

      // Assert
      expect(result).toEqual(createdTags);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.in).toHaveBeenCalledWith('tag_name', ['beginner', 'advanced']);
      expect(mockSupabase.insert).toHaveBeenCalledWith(newTags);
    });

    it('should skip duplicate tags and return existing ones', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null
        },
        {
          tag_name: 'advanced',
          tag_description: 'For advanced users',
          presetTagId: null
        }
      ];

      const existingTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      const createdTag: TagFullDbType = {
        id: 2,
        tag_name: 'advanced',
        tag_description: 'For advanced users',
        presetTagId: null,
        created_at: '2024-01-02T00:00:00Z'
      };

      // First query: from('tags').select().in('tag_name', tagNames)
      // .select() returns this, .in() resolves with existing tags
      mockSupabase.in.mockResolvedValueOnce({
        data: existingTags,
        error: null
      });

      // Second query: from('tags').insert(newTags).select()
      // .select() resolves (after .insert() returns this)
      mockSupabase.select.mockReturnValueOnce(mockSupabase).mockResolvedValueOnce({
        data: [createdTag],
        error: null
      });

      // Act
      const result = await createTags(newTags);

      // Assert
      expect(result).toHaveLength(2);
      expect(result).toEqual([...existingTags, createdTag]);
      expect(mockSupabase.insert).toHaveBeenCalledWith([newTags[1]]); // Only advanced tag
    });

    it('should return empty array when given empty array', async () => {
      // Act
      const result = await createTags([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error for invalid tag data', async () => {
      // Arrange
      const invalidTags: any[] = [
        {
          tag_name: 123, // Invalid: should be string
          tag_description: 'Test',
          presetTagId: null
        }
      ];

      // Act & Assert
      await expect(createTags(invalidTags)).rejects.toThrow('Invalid tag data');
    });

    it('should throw error when select query fails', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'test',
          tag_description: 'Test tag',
          presetTagId: null
        }
      ];

      const mockError = { message: 'Select failed' };
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(createTags(newTags)).rejects.toEqual(mockError);
    });

    it('should throw error when insert query fails', async () => {
      // Arrange
      const newTags: TagInsertType[] = [
        {
          tag_name: 'test',
          tag_description: 'Test tag',
          presetTagId: null
        }
      ];

      const mockError = { message: 'Insert failed' };

      // First query: from('tags').select().in('tag_name', tagNames)
      // .select() returns this, .in() resolves with no existing tags
      mockSupabase.in.mockResolvedValueOnce({
        data: [],
        error: null
      });

      // Second query: from('tags').insert(newTags).select()
      // .select() returns this first, then resolves with error
      mockSupabase.select.mockReturnValueOnce(mockSupabase).mockResolvedValueOnce({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(createTags(newTags)).rejects.toEqual(mockError);
    });
  });

  describe('getTagsById', () => {
    it('should return tags for given IDs', async () => {
      // Arrange
      const ids = [1, 2, 3];
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

      mockSupabase.in.mockResolvedValue({
        data: mockTags,
        error: null
      });

      // Act
      const result = await getTagsById(ids);

      // Assert
      expect(result).toEqual(mockTags);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.in).toHaveBeenCalledWith('id', ids);
    });

    it('should return empty array when no tags found', async () => {
      // Arrange
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getTagsById([999]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when given empty array', async () => {
      // Act
      const result = await getTagsById([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTagsById([1])).rejects.toEqual(mockError);
    });
  });

  describe('updateTag', () => {
    it('should update tag successfully', async () => {
      // Arrange
      const updates: Partial<TagInsertType> = {
        tag_name: 'Updated Name',
        tag_description: 'Updated description'
      };

      const updatedTag: TagFullDbType = {
        id: 1,
        tag_name: 'Updated Name',
        tag_description: 'Updated description',
        presetTagId: null,
        created_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: updatedTag,
        error: null
      });

      // Act
      const result = await updateTag(1, updates);

      // Assert
      expect(result).toEqual(updatedTag);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.update).toHaveBeenCalledWith(updates);
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should update only specific fields', async () => {
      // Arrange
      const updates: Partial<TagInsertType> = {
        tag_description: 'New description only'
      };

      const updatedTag: TagFullDbType = {
        id: 1,
        tag_name: 'Unchanged Name',
        tag_description: 'New description only',
        presetTagId: null,
        created_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: updatedTag,
        error: null
      });

      // Act
      const result = await updateTag(1, updates);

      // Assert
      expect(result).toEqual(updatedTag);
      expect(mockSupabase.update).toHaveBeenCalledWith(updates);
    });

    it('should throw error for invalid update data', async () => {
      // Arrange
      const invalidUpdates: any = {
        tag_name: 123 // Invalid: should be string
      };

      // Act & Assert
      await expect(updateTag(1, invalidUpdates)).rejects.toThrow('Invalid tag update data');
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const mockError = { message: 'Update failed' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(updateTag(1, { tag_name: 'Test' })).rejects.toEqual(mockError);
    });
  });

  describe('deleteTag', () => {
    it('should delete tag successfully', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      await deleteTag(1);

      // Assert
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw error when deletion fails', async () => {
      // Arrange
      const mockError = { message: 'Deletion failed' };
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(deleteTag(1)).rejects.toEqual(mockError);
    });
  });

  describe('searchTagsByName', () => {
    it('should search tags with default limit', async () => {
      // Arrange
      const searchTerm = 'begin';
      const mockTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockTags,
        error: null
      });

      // Act
      const result = await searchTagsByName(searchTerm);

      // Assert
      expect(result).toEqual(mockTags);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.ilike).toHaveBeenCalledWith('tag_name', '%begin%');
      expect(mockSupabase.limit).toHaveBeenCalledWith(10);
    });

    it('should search tags with custom limit', async () => {
      // Arrange
      const searchTerm = 'test';
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await searchTagsByName(searchTerm, 5);

      // Assert
      expect(mockSupabase.limit).toHaveBeenCalledWith(5);
    });

    it('should perform case-insensitive search', async () => {
      // Arrange
      const searchTerm = 'BEGINNER';
      const mockTags: TagFullDbType[] = [
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockTags,
        error: null
      });

      // Act
      const result = await searchTagsByName(searchTerm);

      // Assert
      expect(result).toEqual(mockTags);
      expect(mockSupabase.ilike).toHaveBeenCalledWith('tag_name', '%BEGINNER%');
    });

    it('should return empty array when no matches found', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await searchTagsByName('nonexistent');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when search fails', async () => {
      // Arrange
      const mockError = { message: 'Search failed' };
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(searchTagsByName('test')).rejects.toEqual(mockError);
    });
  });

  describe('getAllTags', () => {
    it('should return all tags ordered by name', async () => {
      // Arrange
      const mockTags: TagFullDbType[] = [
        {
          id: 2,
          tag_name: 'advanced',
          tag_description: 'For advanced users',
          presetTagId: null,
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 1,
          tag_name: 'beginner',
          tag_description: 'For beginners',
          presetTagId: null,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockTags,
        error: null
      });

      // Act
      const result = await getAllTags();

      // Assert
      expect(result).toEqual(mockTags);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.order).toHaveBeenCalledWith('tag_name', { ascending: true });
    });

    it('should return empty array when no tags exist', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getAllTags();

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getAllTags()).rejects.toEqual(mockError);
    });
  });

  describe('getTagsByPresetId', () => {
    it('should return tags with matching presetTagIds', async () => {
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
        },
        {
          id: 5,
          tag_name: 'Medium',
          tag_description: 'Medium length',
          presetTagId: 2,
          created_at: '2024-01-05T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockTags,
        error: null
      });

      // Act
      const result = await getTagsByPresetId(presetTagIds);

      // Assert
      expect(result).toEqual(mockTags);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.in).toHaveBeenCalledWith('presetTagId', presetTagIds);
      expect(mockSupabase.order).toHaveBeenCalledWith('tag_name', { ascending: true });
    });

    it('should return empty array when given empty array', async () => {
      // Act
      const result = await getTagsByPresetId([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when no matching tags found', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getTagsByPresetId([999]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTagsByPresetId([1])).rejects.toEqual(mockError);
    });
  });

  describe('getTempTagsForRewriteWithTags', () => {
    it('should return tags with IDs 2 and 5 in UI format', async () => {
      // Arrange
      const mockRawTags: TagFullDbType[] = [
        {
          id: 2,
          tag_name: 'Normal',
          tag_description: 'Normal difficulty',
          presetTagId: 1,
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 5,
          tag_name: 'Medium',
          tag_description: 'Medium length',
          presetTagId: 2,
          created_at: '2024-01-05T00:00:00Z'
        }
      ];

      const allPresetTags1: TagFullDbType[] = [
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

      const allPresetTags2: TagFullDbType[] = [
        {
          id: 5,
          tag_name: 'Medium',
          tag_description: 'Medium length',
          presetTagId: 2,
          created_at: '2024-01-05T00:00:00Z'
        },
        {
          id: 6,
          tag_name: 'Long',
          tag_description: 'Long length',
          presetTagId: 2,
          created_at: '2024-01-06T00:00:00Z'
        }
      ];

      // First call to get tags with IDs 2 and 5
      mockSupabase.order.mockResolvedValueOnce({
        data: mockRawTags,
        error: null
      });

      // Second call to get all preset tags (called by convertTagsToUIFormat)
      mockSupabase.order.mockResolvedValueOnce({
        data: [...allPresetTags1, ...allPresetTags2],
        error: null
      });

      // Act
      const result = await getTempTagsForRewriteWithTags();

      // Assert
      expect(result).toHaveLength(2);
      expect(mockSupabase.from).toHaveBeenCalledWith('tags');
      expect(mockSupabase.in).toHaveBeenCalledWith('id', [2, 5]);

      // Verify both preset tags are included with proper structure
      expect(result[0]).toMatchObject({
        tag_active_current: true,
        tag_active_initial: true,
        currentActiveTagId: expect.any(Number),
        originalTagId: expect.any(Number)
      });
      expect(result[1]).toMatchObject({
        tag_active_current: true,
        tag_active_initial: true,
        currentActiveTagId: expect.any(Number),
        originalTagId: expect.any(Number)
      });
    });

    it('should throw error when initial query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTempTagsForRewriteWithTags()).rejects.toEqual(mockError);
    });

    it('should handle empty result from database', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await getTempTagsForRewriteWithTags();

      // Assert
      expect(result).toEqual([]);
    });
  });
});
