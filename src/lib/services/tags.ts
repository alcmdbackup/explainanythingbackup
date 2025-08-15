'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { type TagFullDbType, type TagInsertType, tagInsertSchema } from '@/lib/schemas/schemas';

/**
 * Service for interacting with the tags table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Create a single tag
 * const [newTag] = await createTags([{ 
 *   tag_name: "beginner",
 *   tag_description: "Suitable for beginners with no prior knowledge",
 *   presetTagId: null
 * }]);
 * 
 * // Create multiple tags
 * const newTags = await createTags([
 *   { tag_name: "advanced", tag_description: "For advanced users", presetTagId: null },
 *   { tag_name: "tutorial", tag_description: "Step-by-step guide", presetTagId: 1 }
 * ]);
 * 
 * // Get tags by IDs
 * const tags = await getTagsById([1, 2, 3]);
 * ```
 */

/**
 * Create tags in bulk, skipping duplicates
 * • Validates all input data against tagInsertSchema before processing
 * • Processes array of tag data to create multiple tags efficiently
 * • Checks for existing tags and only creates new ones
 * • Returns array of all tag records (existing + newly created)
 * • Used by bulk tag import and initialization operations
 * • Calls supabase tags table for select and bulk insert operations
 */
export async function createTags(tags: TagInsertType[]): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  if (tags.length === 0) return [];
  
  // Validate all input data against schema
  const validatedTags: TagInsertType[] = [];
  for (const tag of tags) {
    const validationResult = tagInsertSchema.safeParse(tag);
    if (!validationResult.success) {
      console.error('Invalid tag data:', validationResult.error);
      throw new Error(`Invalid tag data: ${validationResult.error.message}`);
    }
    validatedTags.push(validationResult.data);
  }
  
  // Get all existing tags with matching names
  const tagNames = validatedTags.map(tag => tag.tag_name);
  const { data: existingTags, error: selectError } = await supabase
    .from('tags')
    .select()
    .in('tag_name', tagNames);

  if (selectError) throw selectError;

  // Find which tags don't exist yet
  const existingTagNames = new Set(existingTags?.map(tag => tag.tag_name) || []);
  const newTags = validatedTags.filter(tag => !existingTagNames.has(tag.tag_name));

  let createdTags: TagFullDbType[] = [];

  // Create new tags if any
  if (newTags.length > 0) {
    const { data, error } = await supabase
      .from('tags')
      .insert(newTags)
      .select();

    if (error) throw error;
    createdTags = data || [];
  }

  // Return combination of existing and newly created tags
  return [...(existingTags || []), ...createdTags];
}

/**
 * Get tag records by IDs
 * • Retrieves multiple tags by their primary key IDs
 * • Returns array of tag data, filtering out any not found
 * • Used by bulk tag lookup operations and validation
 * • Calls supabase tags table select operation with IN clause
 */
export async function getTagsById(ids: number[]): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()

  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('tags')
    .select()
    .in('id', ids);

  if (error) throw error;
  return data || [];
}

/**
 * Update an existing tag record
 * • Validates partial input data against tagInsertSchema before processing
 * • Updates tag record with provided partial data
 * • Returns updated tag record with all fields
 * • Used by tag editing and management operations
 * • Calls supabase tags table update operation
 */
export async function updateTag(
  id: number,
  updates: Partial<TagInsertType>
): Promise<TagFullDbType> {
  const supabase = await createSupabaseServerClient()
  
  // Validate partial updates - only validate provided fields
  const validationResult = tagInsertSchema.partial().safeParse(updates);
  if (!validationResult.success) {
    console.error('Invalid tag update data:', validationResult.error);
    throw new Error(`Invalid tag update data: ${validationResult.error.message}`);
  }
  
  const validatedUpdates = validationResult.data;
  
  const { data, error } = await supabase
    .from('tags')
    .update(validatedUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a tag record
 * • Removes tag record from database by ID
 * • Cascade deletion will also remove explanation_tags relationships
 * • Used by tag management and cleanup operations
 * • Calls supabase tags table delete operation
 */
export async function deleteTag(id: number): Promise<void> {
  const supabase = await createSupabaseServerClient()
  
  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Search tags by name
 * • Performs case-insensitive partial matching on tag names
 * • Returns array of matching tag records with limit
 * • Used by tag autocomplete and search functionality
 * • Calls supabase tags table with ilike pattern matching
 */
export async function searchTagsByName(
  searchTerm: string,
  limit: number = 10
): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('tags')
    .select()
    .ilike('tag_name', `%${searchTerm}%`)
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get all tags
 * • Retrieves all tag records from the database
 * • Returns array of all available tags ordered by name
 * • Used by tag selection interfaces and admin operations
 * • Calls supabase tags table select all operation
 */
export async function getAllTags(): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('tags')
    .select()
    .order('tag_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get all tags with the specified presetTagIds
 * • Retrieves all tags that share any of the provided preset tag IDs
 * • Returns array of tags ordered by name for consistent results
 * • Used by preset tag grouping and related tag operations
 * • Calls supabase tags table select with presetTagId filter using 'in' operator
 */
export async function getTagsByPresetId(presetTagIds: number[]): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  if (presetTagIds.length === 0) return [];
  
  const { data, error } = await supabase
    .from('tags')
    .select()
    .in('presetTagId', presetTagIds)
    .order('tag_name', { ascending: true });

  if (error) throw error;
  return data || [];
} 

/**
 * Get temporary tags for "rewrite with tags" functionality
 * • Retrieves two specific preset tags: "medium" (ID 2) and "moderate" (ID 5)
 * • Returns tags with both tag_active_current and tag_active_initial set to true
 * • Used by "rewrite with tags" functionality to start with minimal preset tags
 * • Calls supabase tags table select operation for specific tag IDs
 */
export async function getTempTagsForRewriteWithTags(): Promise<TagFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('tags')
    .select()
    .in('id', [2, 5])
    .order('tag_name', { ascending: true });

  if (error) throw error;
  return data || [];
} 