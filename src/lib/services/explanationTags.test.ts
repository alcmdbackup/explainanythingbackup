import {
  addTagsToExplanation,
  removeTagsFromExplanation,
  bulkRemoveTagsFromExplanations,
  replaceTagsForExplanationWithValidation,
  getTagsForExplanation,
  getExplanationIdsForTag,
  explanationHasTags,
  removeAllTagsFromExplanation,
  getTagUsageStats,
  handleApplyForModifyTags
} from './explanationTags';
import { type TagUIType, type ExplanationTagFullDbType, type TagFullDbType } from '@/lib/schemas/schemas';

// Mock Supabase client
jest.mock('@/lib/utils/supabase/server');

// Mock tags service
jest.mock('./tags');

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { getTagsById, getTagsByPresetId, convertTagsToUIFormat } from './tags';

describe('explanationTags', () => {
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a simpler mock structure
    mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })  // Fixed: in() now returns object with eq()
            }),
            eq: jest.fn().mockResolvedValue({ data: [], error: null })
          }),
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null })
          }),
          mockResolvedValue: jest.fn().mockResolvedValue({ data: [], error: null })
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null })
            }),
            eq: jest.fn().mockResolvedValue({ error: null })
          }),
          in: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue({ data: [], error: null })
          }),
          select: jest.fn().mockResolvedValue({ data: [], error: null })
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: [], error: null })
        })
      })
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('addTagsToExplanation', () => {
    it('should add new tags successfully', async () => {
      const explanationId = 123;
      const tagIds = [456, 789];
      const mockTags: TagFullDbType[] = [
        { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: null, created_at: new Date().toISOString() },
        { id: 789, tag_name: 'tag2', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
      ];

      (getTagsById as jest.Mock).mockResolvedValue(mockTags);

      const insertedData: ExplanationTagFullDbType[] = [
        { id: 1, explanation_id: explanationId, tag_id: 456, isDeleted: false, created_at: new Date().toISOString() },
        { id: 2, explanation_id: explanationId, tag_id: 789, isDeleted: false, created_at: new Date().toISOString() }
      ];

      mockSupabase.from().insert().select.mockResolvedValueOnce({ data: insertedData, error: null });

      const result = await addTagsToExplanation(explanationId, tagIds);

      expect(getTagsById).toHaveBeenCalledWith(tagIds);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanation_tags');
      expect(result).toEqual(insertedData);
    });

    it('should reactivate soft-deleted relationships', async () => {
      const explanationId = 123;
      const tagIds = [456];
      const mockTags: TagFullDbType[] = [
        { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
      ];

      (getTagsById as jest.Mock).mockResolvedValue(mockTags);

      // Mock existing soft-deleted relationship
      mockSupabase.from().select().eq().in.mockResolvedValueOnce({
        data: [{ id: 1, tag_id: 456, isDeleted: true }],
        error: null
      });

      // Mock update response
      const updatedData: ExplanationTagFullDbType[] = [
        { id: 1, explanation_id: explanationId, tag_id: 456, isDeleted: false, created_at: new Date().toISOString() }
      ];
      mockSupabase.from().update().in().select.mockResolvedValueOnce({ data: updatedData, error: null });

      const result = await addTagsToExplanation(explanationId, tagIds);

      expect(result).toEqual(updatedData);
    });

    it('should throw error for duplicate preset tags', async () => {
      const explanationId = 123;
      const tagIds = [456, 789];
      const mockTags: TagFullDbType[] = [
        { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: 1, created_at: new Date().toISOString() },
        { id: 789, tag_name: 'tag2', tag_description: '', presetTagId: 1, created_at: new Date().toISOString() }
      ];

      (getTagsById as jest.Mock).mockResolvedValue(mockTags);

      await expect(addTagsToExplanation(explanationId, tagIds))
        .rejects.toThrow('multiple preset tags of the same type cannot be added to an explanation');
    });

    it('should throw error when tags not found', async () => {
      const explanationId = 123;
      const tagIds = [456, 789];

      (getTagsById as jest.Mock).mockResolvedValue([{ id: 456, tag_name: 'tag1' }]); // Only one tag found

      await expect(addTagsToExplanation(explanationId, tagIds))
        .rejects.toThrow('One or more tags not found');
    });

    it('should return empty array for empty tag list', async () => {
      const result = await addTagsToExplanation(123, []);
      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('removeTagsFromExplanation', () => {
    it('should remove tags successfully', async () => {
      const explanationId = 123;
      const tagIds = [456, 789];

      await removeTagsFromExplanation(explanationId, tagIds);

      expect(mockSupabase.from).toHaveBeenCalledWith('explanation_tags');
    });

    it('should handle empty tag list', async () => {
      await removeTagsFromExplanation(123, []);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should throw error on database error', async () => {
      mockSupabase.from().update().eq().in().eq.mockResolvedValueOnce({
        error: new Error('Database error')
      });

      await expect(removeTagsFromExplanation(123, [456]))
        .rejects.toThrow('Database error');
    });
  });

  describe('getTagsForExplanation', () => {
    it('should get tags for an explanation', async () => {
      const explanationId = 123;
      const mockDbTags = [
        {
          tags: {
            id: 456,
            tag_name: 'tag1',
            tag_description: 'desc1',
            presetTagId: null,
            created_at: new Date().toISOString()
          }
        }
      ];
      const mockUITags: TagUIType[] = [
        {
          id: 456,
          tag_name: 'tag1',
          tag_description: 'desc1',
          tag_active_initial: true,
          tag_active_current: true
        }
      ];

      mockSupabase.from().select().eq().eq.mockResolvedValueOnce({
        data: mockDbTags,
        error: null
      });
      (convertTagsToUIFormat as jest.Mock).mockResolvedValue(mockUITags);

      const result = await getTagsForExplanation(explanationId);

      expect(mockSupabase.from).toHaveBeenCalledWith('explanation_tags');
      expect(convertTagsToUIFormat).toHaveBeenCalled();
      expect(result).toEqual(mockUITags);
    });

    it('should handle empty results', async () => {
      mockSupabase.from().select().eq().eq.mockResolvedValueOnce({
        data: [],
        error: null
      });
      (convertTagsToUIFormat as jest.Mock).mockResolvedValue([]);

      const result = await getTagsForExplanation(123);

      expect(result).toEqual([]);
    });
  });

  describe('getExplanationIdsForTag', () => {
    it('should get explanation IDs for a tag', async () => {
      const tagId = 456;
      const mockData = [
        { explanation_id: 123 },
        { explanation_id: 789 }
      ];

      mockSupabase.from().select().eq().eq.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      const result = await getExplanationIdsForTag(tagId);

      expect(mockSupabase.from).toHaveBeenCalledWith('explanation_tags');
      expect(result).toEqual([123, 789]);
    });

    it('should return empty array when no explanations found', async () => {
      mockSupabase.from().select().eq().eq.mockResolvedValueOnce({
        data: [],
        error: null
      });

      const result = await getExplanationIdsForTag(456);

      expect(result).toEqual([]);
    });
  });

  describe('explanationHasTags', () => {
    it('should check if explanation has specific tags', async () => {
      const explanationId = 123;
      const tagIds = [456, 789, 101];
      const mockData = [
        { tag_id: 456 },
        { tag_id: 101 }
      ];

      mockSupabase.from().select().eq().in().eq.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      const result = await explanationHasTags(explanationId, tagIds);

      expect(result).toEqual([true, false, true]); // 456 and 101 exist, 789 doesn't
    });

    it('should return empty array for empty tag list', async () => {
      const result = await explanationHasTags(123, []);
      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('removeAllTagsFromExplanation', () => {
    it('should remove all tags from an explanation', async () => {
      const explanationId = 123;

      await removeAllTagsFromExplanation(explanationId);

      expect(mockSupabase.from).toHaveBeenCalledWith('explanation_tags');
    });

    it('should throw error on database error', async () => {
      mockSupabase.from().update().eq().eq.mockResolvedValueOnce({
        error: new Error('Database error')
      });

      await expect(removeAllTagsFromExplanation(123))
        .rejects.toThrow('Database error');
    });
  });

  describe('getTagUsageStats', () => {
    it('should get tag usage statistics', async () => {
      const mockData = [
        {
          tag_id: 456,
          tags: { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
        },
        {
          tag_id: 456,
          tags: { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
        },
        {
          tag_id: 789,
          tags: { id: 789, tag_name: 'tag2', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
        }
      ];

      mockSupabase.from().select().eq.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      const result = await getTagUsageStats();

      expect(result).toHaveLength(2);
      expect(result[0].usage_count).toBe(2);
      expect(result[1].usage_count).toBe(1);
    });

    it('should handle empty results', async () => {
      mockSupabase.from().select().eq.mockResolvedValueOnce({
        data: [],
        error: null
      });

      const result = await getTagUsageStats();

      expect(result).toEqual([]);
    });
  });

  describe('handleApplyForModifyTags', () => {
    it('should handle simple tag activation and deactivation', async () => {
      const explanationId = 123;
      const tags: TagUIType[] = [
        { id: 456, tag_name: 'tag1', tag_description: '', tag_active_initial: false, tag_active_current: true }, // Activate
        { id: 789, tag_name: 'tag2', tag_description: '', tag_active_initial: true, tag_active_current: false }  // Deactivate
      ];

      // Mock addTagsToExplanation
      (getTagsById as jest.Mock).mockResolvedValue([
        { id: 456, tag_name: 'tag1', tag_description: '', presetTagId: null, created_at: new Date().toISOString() }
      ]);
      mockSupabase.from().select().eq().in.mockResolvedValueOnce({ data: [], error: null });
      mockSupabase.from().insert().select.mockResolvedValueOnce({ data: [{}], error: null });

      const result = await handleApplyForModifyTags(explanationId, tags);

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('should handle no changes', async () => {
      const explanationId = 123;
      const tags: TagUIType[] = [
        { id: 456, tag_name: 'tag1', tag_description: '', tag_active_initial: true, tag_active_current: true } // No change
      ];

      const result = await handleApplyForModifyTags(explanationId, tags);

      expect(result).toEqual({
        added: 0,
        removed: 0,
        errors: []
      });
    });
  });
});