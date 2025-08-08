'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { type ExplanationTagFullDbType, type ExplanationTagInsertType, type TagFullDbType, explanationTagInsertSchema, TagUIType, simpleTagUISchema, PresetTagUISchema } from '@/lib/schemas/schemas';
import { getTagsById, getTagsByPresetId } from './tags';

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
 * • Creates explanation-tag relationships in a single transaction
 * • Returns array of created relationship records
 * • Used by tag assignment operations (single or multiple)
 * • Calls supabase explanation_tags table insert operation
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
  
  const relationshipData = tagIds.map(tagId => ({
    explanation_id: explanationId,
    tag_id: tagId
  }));

  // Validate all relationship data
  const validatedData: ExplanationTagInsertType[] = [];
  for (const relationship of relationshipData) {
    const validationResult = explanationTagInsertSchema.safeParse(relationship);
    if (!validationResult.success) {
      console.error('Invalid explanation-tag relationship data:', validationResult.error);
      throw new Error(`Invalid explanation-tag relationship data: ${validationResult.error.message}`);
    }
    validatedData.push(validationResult.data);
  }

  const { data, error } = await supabase
    .from('explanation_tags')
    .insert(validatedData)
    .select();

  if (error) throw error;
  return data || [];
}

/**
 * Remove specific tags from an explanation
 * • Removes multiple explanation-tag relationships by tag IDs
 * • Safe operation that won't fail if relationships don't exist
 * • Used by tag removal operations (single or multiple)
 * • Calls supabase explanation_tags table delete operation
 */
export async function removeTagsFromExplanation(
  explanationId: number,
  tagIds: number[]
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  
  if (tagIds.length === 0) return;
  
  const { error } = await supabase
    .from('explanation_tags')
    .delete()
    .eq('explanation_id', explanationId)
    .in('tag_id', tagIds);

  if (error) throw error;
}

/**
 * Get all tags for a specific explanation
 * • Retrieves all tags associated with an explanation via junction table
 * • For preset tags, fetches ALL tags with the same presetTagId (not just applied ones)
 * • Returns array of UI tag objects (simple or preset) with active state
 * • Used by explanation display and editing interfaces
 * • Calls supabase with join between explanation_tags and tags tables
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
    .eq('explanation_id', explanationId);

  if (error) throw error;
  
  // Extract tags from the joined result and ensure proper typing
  const rawTags = data?.map(item => (item as any).tags as TagFullDbType).filter(Boolean) || [];
  
  // Group applied tags by presetTagId for processing
  const appliedTagsByPresetId = new Map<number | null, TagFullDbType[]>();
  
  for (const tag of rawTags) {
    const presetId = tag.presetTagId;
    if (!appliedTagsByPresetId.has(presetId)) {
      appliedTagsByPresetId.set(presetId, []);
    }
    appliedTagsByPresetId.get(presetId)!.push(tag);
  }
  
  // Collect all unique presetTagIds for a single batch query
  const uniquePresetTagIds = [...new Set(
    rawTags
      .filter(tag => tag.presetTagId !== null)
      .map(tag => tag.presetTagId!)
  )];
  
  // Fetch all tags with presetTagIds in a single call
  const allPresetTags = uniquePresetTagIds.length > 0 
    ? await getTagsByPresetId(uniquePresetTagIds)
    : [];
  
  // Group all preset tags by presetTagId for quick lookup
  const allPresetTagsByPresetId = new Map<number, TagFullDbType[]>();
  for (const tag of allPresetTags) {
    if (tag.presetTagId) {
      if (!allPresetTagsByPresetId.has(tag.presetTagId)) {
        allPresetTagsByPresetId.set(tag.presetTagId, []);
      }
      allPresetTagsByPresetId.get(tag.presetTagId)!.push(tag);
    }
  }
  
  const result: TagUIType[] = [];
  
  // Process each group
  for (const [presetId, appliedTags] of appliedTagsByPresetId) {
    if (presetId === null) {
      // Simple tags - create individual simpleTagUI objects
      for (const tag of appliedTags) {
        const simpleTagUI = {
          ...tag,
          tag_active: true
        };
        
        // Validate with zod schema
        const validation = simpleTagUISchema.safeParse(simpleTagUI);
        if (validation.success) {
          result.push(validation.data);
        } else {
          console.error('Invalid simple tag UI data:', validation.error);
        }
      }
    } else {
      // Preset tags - use the pre-fetched all tags with this presetTagId
      const allTagsWithPresetId = allPresetTagsByPresetId.get(presetId) || [];
      
      // Find the originally applied tag (the one that was actually linked to this explanation)
      const originallyAppliedTag = appliedTags[0]; // We know at least one tag was applied
      
      const presetTagUI = {
        tags: allTagsWithPresetId, // All available tags with this presetTagId
        tag_active: true,
        currentActiveTagId: originallyAppliedTag.id, // The tag that was originally applied
        originalTagId: originallyAppliedTag.id // The tag that was originally applied
      };
      
      // Validate with zod schema
      const validation = PresetTagUISchema.safeParse(presetTagUI);
      if (validation.success) {
        result.push(validation.data);
      } else {
        console.error('Invalid preset tag UI data:', validation.error);
      }
    }
  }
  
  return result;
}

/**
 * Get all explanation IDs for a specific tag
 * • Retrieves all explanation IDs that have been tagged with a specific tag
 * • Returns array of explanation IDs for further processing
 * • Used by tag-based filtering and search operations
 * • Calls supabase explanation_tags table select operation
 */
export async function getExplanationIdsForTag(tagId: number): Promise<number[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanation_tags')
    .select('explanation_id')
    .eq('tag_id', tagId);

  if (error) throw error;
  return data?.map(item => item.explanation_id) || [];
}

/**
 * Check if an explanation has specific tags
 * • Verifies if explanation-tag relationships exist for provided tag IDs
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
    .in('tag_id', tagIds);

  if (error) throw error;
  
  const existingTagIds = new Set(data?.map(item => item.tag_id) || []);
  return tagIds.map(tagId => existingTagIds.has(tagId));
}

/**
 * Remove all tags from an explanation
 * • Removes all tag relationships for a specific explanation
 * • Used by explanation deletion or tag reset operations
 * • Calls supabase explanation_tags table delete operation
 */
export async function removeAllTagsFromExplanation(explanationId: number): Promise<void> {
  const supabase = await createSupabaseServerClient()
  
  const { error } = await supabase
    .from('explanation_tags')
    .delete()
    .eq('explanation_id', explanationId);

  if (error) throw error;
}

/**
 * Replace all tags for an explanation
 * • Removes all existing tags and adds new ones in a transaction-like operation
 * • Efficient way to update an explanation's complete tag set
 * • Returns array of new relationship records
 * • Used by tag editing interfaces for complete tag updates
 * • Calls supabase explanation_tags table delete and insert operations
 */
export async function replaceTagsForExplanation(
  explanationId: number,
  tagIds: number[]
): Promise<ExplanationTagFullDbType[]> {
  // First remove all existing tags
  await removeAllTagsFromExplanation(explanationId);
  
  // Then add the new tags
  if (tagIds.length === 0) return [];
  return await addTagsToExplanation(explanationId, tagIds);
}

/**
 * Get tag usage statistics
 * • Retrieves count of how many explanations each tag is used in
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
    `);

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