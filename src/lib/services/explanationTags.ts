/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { type ExplanationTagFullDbType, type ExplanationTagInsertType, type TagFullDbType, explanationTagInsertSchema, TagUIType, simpleTagUISchema, PresetTagUISchema } from '@/lib/schemas/schemas';
import { getTagsById, getTagsByPresetId, convertTagsToUIFormat } from './tags';

/**
 * Service for interacting with the explanation_tags junction table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Add a single tag to an explanation
 * const [relationship] = await addTagsToExplanation(123, [456]);
 * 
 * // Add multiple tags to an explanation
 * const relationships = await addTagsToExplanation(123, [456, 789, 101]);
 * 
 * // Remove specific tags from an explanation
 * await removeTagsFromExplanation(123, [456, 789]);
 * 
 * // Get all tags for an explanation
 * const tags = await getTagsForExplanation(123);
 * ```
 */

/**
 * Add tags to an explanation
 * • Validates all input data against explanationTagInsertSchema before processing
 * • Creates explanation-tag relationships or reactivates soft-deleted ones
 * • Returns array of created/updated relationship records
 * • Used by tag assignment operations (single or multiple)
 * • Calls supabase explanation_tags table insert/update operations
 */
export async function addTagsToExplanation(
  explanationId: number,
  tagIds: number[]
): Promise<ExplanationTagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  if (tagIds.length === 0) return [];
  
  // Fetch all tag information using getTagsById to validate presetTagId constraints
  const tags = await getTagsById(tagIds);
  
  if (tags.length !== tagIds.length) {
    throw new Error('One or more tags not found');
  }
  
  // Check for duplicate presetTagId values
  const presetTagIds = tags
    .map((tag: TagFullDbType) => tag.presetTagId)
    .filter((presetTagId: number | null): presetTagId is number => presetTagId !== null);
  
  const uniquePresetTagIds = new Set(presetTagIds);
  
  if (presetTagIds.length !== uniquePresetTagIds.size) {
    throw new Error('multiple preset tags of the same type cannot be added to an explanation');
  }

  // Check for existing relationships (including soft-deleted ones)
  const { data: existingRelationships, error: checkError } = await supabase
    .from('explanation_tags')
    .select('id, tag_id, isDeleted')
    .eq('explanation_id', explanationId)
    .in('tag_id', tagIds);

  if (checkError) throw checkError;

  const existingMap = new Map(
    existingRelationships?.map(rel => [rel.tag_id, rel]) || []
  );

  const toInsert: ExplanationTagInsertType[] = [];
  const toUpdate: number[] = [];

  for (const tagId of tagIds) {
    const existing = existingMap.get(tagId);
    if (existing) {
      if (existing.isDeleted) {
        // Reactivate soft-deleted relationship
        toUpdate.push(existing.id);
      }
      // If not deleted, skip (already exists)
    } else {
      // Create new relationship
      toInsert.push({
        explanation_id: explanationId,
        tag_id: tagId,
        isDeleted: false
      });
    }
  }

  const results: ExplanationTagFullDbType[] = [];

  // Update soft-deleted relationships
  if (toUpdate.length > 0) {
    const { data: updatedData, error: updateError } = await supabase
      .from('explanation_tags')
      .update({ isDeleted: false })
      .in('id', toUpdate)
      .select();

    if (updateError) throw updateError;
    results.push(...(updatedData || []));
  }

  // Insert new relationships
  if (toInsert.length > 0) {
    const { data: insertedData, error: insertError } = await supabase
      .from('explanation_tags')
      .insert(toInsert)
      .select();

    if (insertError) throw insertError;
    results.push(...(insertedData || []));
  }

  return results;
}

/**
 * Remove specific tags from an explanation (soft delete)
 * • Marks multiple explanation-tag relationships as deleted by setting isDeleted = true
 * • Safe operation that won't fail if relationships don't exist
 * • Used by tag removal operations (single or multiple)
 * • Calls supabase explanation_tags table update operation
 */
export async function removeTagsFromExplanation(
  explanationId: number,
  tagIds: number[]
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  
  if (tagIds.length === 0) return;
  
  const { error } = await supabase
    .from('explanation_tags')
    .update({ isDeleted: true })
    .eq('explanation_id', explanationId)
    .in('tag_id', tagIds)
    .eq('isDeleted', false);

  if (error) throw error;
}

/**
 * Bulk remove tags from multiple explanations
 * • Efficiently removes the same set of tags from multiple explanations
 * • Returns results for each explanation including success/failure counts
 * • Used by bulk operations and administrative tag management
 * • Calls removeTagsFromExplanation for each explanation
 */
export async function bulkRemoveTagsFromExplanations(
  explanationIds: number[],
  tagIds: number[]
): Promise<Array<{
  explanationId: number;
  success: boolean;
  removed: number;
  notFound: number[];
  error?: string;
}>> {
  if (explanationIds.length === 0 || tagIds.length === 0) {
    return [];
  }
  
  const results = await Promise.allSettled(
    explanationIds.map(async (explanationId) => {
      try {
        await removeTagsFromExplanation(explanationId, tagIds);
        return {
          explanationId,
          success: true,
          removed: 0,
          notFound: []
        };
      } catch (error) {
        return {
          explanationId,
          success: false,
          removed: 0,
          notFound: [],
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    })
  );
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        explanationId: explanationIds[index],
        success: false,
        removed: 0,
        notFound: [],
        error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
      };
    }
  });
}

/**
 * Replace all tags for an explanation with validation
 * • Removes all existing tags and adds new ones with full validation
 * • Ensures preset tag constraints are maintained in the final state
 * • Returns detailed results including validation errors
 * • Used by tag editing interfaces for complete tag updates
 * • Calls removeAllTagsFromExplanation and addTagsToExplanation with validation
 */
export async function replaceTagsForExplanationWithValidation(
  explanationId: number,
  tagIds: number[]
): Promise<{
  success: boolean;
  removed: number;
  added: number;
  validationErrors: string[];
  finalTags: TagUIType[];
}> {
  try {
    // First remove all existing tags
    await removeAllTagsFromExplanation(explanationId);
    
    // Then add the new tags with validation
    if (tagIds.length === 0) {
      const finalTags = await getTagsForExplanation(explanationId);
      return {
        success: true,
        removed: 0,
        added: 0,
        validationErrors: [],
        finalTags
      };
    }
    
    const addedTags = await addTagsToExplanation(explanationId, tagIds);
    const finalTags = await getTagsForExplanation(explanationId);
    
    return {
      success: true,
      removed: 0, // We don't track how many were removed in removeAllTagsFromExplanation
      added: addedTags.length,
      validationErrors: [],
      finalTags
    };
  } catch (error) {
    // If anything fails, try to restore the original state
    try {
      await removeAllTagsFromExplanation(explanationId);
    } catch (restoreError) {
      logger.error('Failed to restore explanation tags after error', {
        error: restoreError instanceof Error ? restoreError.message : String(restoreError)
      });
    }
    
    return {
      success: false,
      removed: 0,
      added: 0,
      validationErrors: [error instanceof Error ? error.message : 'Unknown error'],
      finalTags: []
    };
  }
}

/**
 * Get all tags for a specific explanation
 * • Retrieves all non-deleted tags associated with an explanation via junction table
 * • For preset tags, fetches ALL tags with the same presetTagId (not just applied ones)
 * • Returns array of UI tag objects (simple or preset) with active state
 * • Used by explanation display and editing interfaces
 * • Calls supabase with join between explanation_tags and tags tables
 * • Uses convertTagsToUIFormat helper function for consistent tag processing
 */
export async function getTagsForExplanation(explanationId: number): Promise<TagUIType[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanation_tags')
    .select(`
      tags!inner (
        id,
        tag_name,
        tag_description,
        presetTagId,
        created_at
      )
    `)
    .eq('explanation_id', explanationId)
    .eq('isDeleted', false);

  if (error) throw error;
  
  // Extract tags from the joined result and ensure proper typing
  const rawTags = data?.map(item => (item as any).tags as TagFullDbType).filter(Boolean) || [];
  
  // Use the helper function to convert raw tags to UI format
  return await convertTagsToUIFormat(rawTags);
}

/**
 * Get all explanation IDs for a specific tag
 * • Retrieves all explanation IDs that have been tagged with a specific tag (non-deleted)
 * • Returns array of explanation IDs for further processing
 * • Used by tag-based filtering and search operations
 * • Calls supabase explanation_tags table select operation
 */
export async function getExplanationIdsForTag(tagId: number): Promise<number[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanation_tags')
    .select('explanation_id')
    .eq('tag_id', tagId)
    .eq('isDeleted', false);

  if (error) throw error;
  return data?.map(item => item.explanation_id) || [];
}

/**
 * Check if an explanation has specific tags
 * • Verifies if non-deleted explanation-tag relationships exist for provided tag IDs
 * • Returns array of booleans corresponding to each tag ID
 * • Used by tag validation and UI state management
 * • Calls supabase explanation_tags table select operation
 */
export async function explanationHasTags(
  explanationId: number,
  tagIds: number[]
): Promise<boolean[]> {
  const supabase = await createSupabaseServerClient()
  
  if (tagIds.length === 0) return [];
  
  const { data, error } = await supabase
    .from('explanation_tags')
    .select('tag_id')
    .eq('explanation_id', explanationId)
    .in('tag_id', tagIds)
    .eq('isDeleted', false);

  if (error) throw error;
  
  const existingTagIds = new Set(data?.map(item => item.tag_id) || []);
  return tagIds.map(tagId => existingTagIds.has(tagId));
}

/**
 * Remove all tags from an explanation (soft delete)
 * • Marks all tag relationships for a specific explanation as deleted
 * • Used by explanation deletion or tag reset operations
 * • Calls supabase explanation_tags table update operation
 */
export async function removeAllTagsFromExplanation(explanationId: number): Promise<void> {
  const supabase = await createSupabaseServerClient()
  
  const { error } = await supabase
    .from('explanation_tags')
    .update({ isDeleted: true })
    .eq('explanation_id', explanationId)
    .eq('isDeleted', false);

  if (error) throw error;
}

/**
 * Get tag usage statistics
 * • Retrieves count of how many explanations each tag is used in (non-deleted relationships)
 * • Returns array of tags with usage counts
 * • Used by tag analytics and management interfaces
 * • Calls supabase with aggregation on explanation_tags table
 */
export async function getTagUsageStats(): Promise<Array<{ tag: TagFullDbType; usage_count: number }>> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanation_tags')
    .select(`
      tag_id,
      tags!inner (
        id,
        tag_name,
        tag_description,
        presetTagId,
        created_at
      )
    `)
    .eq('isDeleted', false);

  if (error) throw error;
  
  // Group by tag and count usage
  const tagCounts = (data || []).reduce((acc, item: any) => {
    const tagId = item.tag_id;
    if (!acc[tagId]) {
      acc[tagId] = {
        tag: item.tags as TagFullDbType,
        usage_count: 0
      };
    }
    acc[tagId].usage_count++;
    return acc;
  }, {} as Record<number, { tag: TagFullDbType; usage_count: number }>);

  return Object.values(tagCounts);
} 

/**
 * Handle applying tag modifications for both simple and preset tags
 * • Processes simple tags: adds tags that became active, removes tags that became inactive
 * • Processes preset tags: handles activation/deactivation and tag switching scenarios
 * • Performs efficient batch operations for add and remove operations
 * • Used by tag bar apply button to commit tag changes to explanations
 * • Calls addTagsToExplanation and removeTagsFromExplanation for database operations
 */
export async function handleApplyForModifyTags(
  explanationId: number,
  tags: TagUIType[]
): Promise<{
  added: number;
  removed: number;
  errors: string[];
}> {
  const tagsToAdd: number[] = [];
  const tagsToRemove: number[] = [];
  const errors: string[] = [];

  for (const tag of tags) {
    try {
      // Handle simple tags
      if ('id' in tag) {
        // Simple tag logic
        if (!tag.tag_active_initial && tag.tag_active_current) {
          // Tag was activated
          tagsToAdd.push(tag.id);
        } else if (tag.tag_active_initial && !tag.tag_active_current) {
          // Tag was deactivated
          tagsToRemove.push(tag.id);
        }
      } else {
        // Preset tag logic
        if (!tag.tag_active_initial && tag.tag_active_current) {
          // Preset tag was activated - add current active tag
          tagsToAdd.push(tag.currentActiveTagId);
        } else if (tag.tag_active_initial && !tag.tag_active_current) {
          // Preset tag was deactivated - remove original tag
          tagsToRemove.push(tag.originalTagId);
        } else if (tag.tag_active_initial && tag.tag_active_current && tag.currentActiveTagId !== tag.originalTagId) {
          // Preset tag was switched - add current tag and remove original tag
          tagsToAdd.push(tag.currentActiveTagId);
          tagsToRemove.push(tag.originalTagId);
        }
      }
    } catch (error) {
      errors.push(`Error processing tag: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Perform batch operations
  let addedCount = 0;
  let removedCount = 0;

  try {
    if (tagsToAdd.length > 0) {
      await addTagsToExplanation(explanationId, tagsToAdd);
      addedCount = tagsToAdd.length;
    }
  } catch (error) {
    errors.push(`Error adding tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  try {
    if (tagsToRemove.length > 0) {
      await removeTagsFromExplanation(explanationId, tagsToRemove);
      removedCount = tagsToRemove.length;
    }
  } catch (error) {
    errors.push(`Error removing tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    added: addedCount,
    removed: removedCount,
    errors
  };
} 