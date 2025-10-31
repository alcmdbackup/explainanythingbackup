'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
//import {supabase} from '@/lib/supabase'
import { type ExplanationFullDbType, type ExplanationInsertType } from '@/lib/schemas/schemas';

/**
 * Service for interacting with the explanations table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Create an explanation
 * const newExplanation = await createExplanation({ 
 *   explanation_title: "Introduction to React",
 *   content: "React is a JavaScript library...",
 *   primary_topic_id: 1,
 *   secondary_topic_id: 2
 * });
 * 
 * // Get recent explanations
 * const explanations = await getRecentExplanations(5);
 * 
 * // Get explanation by ID
 * const explanation = await getExplanationById(1);
 * ```
 */

/**
 * Create a new explanation record
 * @param explanation Explanation data to insert
 * @returns Created explanation record
 */
export async function createExplanation(explanation: ExplanationInsertType): Promise<ExplanationFullDbType> {
  const supabase = await createSupabaseServerClient()
  

  
  const { data, error } = await supabase
    .from('explanations')
    .insert(explanation)
    .select('id, explanation_title, content, timestamp, primary_topic_id, secondary_topic_id, status')
    .single();

  if (error) {
    console.error('Error creating explanation:', error);
    console.error('Error details:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw error;
  }
  

  return data;
}

/**
 * Get an explanation record by ID
 * @param id Explanation record ID
 * @returns Explanation record if found
 */
export async function getExplanationById(id: number): Promise<ExplanationFullDbType> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanations')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) {
    throw new Error(`Explanation not found for ID: ${id}`);
  }
  return data;
}

/**
 * Get recent explanations with pagination
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @param orderBy Order by column
 * @param order Order direction
 * @returns Array of explanation records
 */
export async function getRecentExplanations(
  limit: number = 10,
  offset: number = 0,
  orderBy: string = 'timestamp',
  order: 'asc' | 'desc' = 'desc'
): Promise<ExplanationFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  // Validate parameters
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;
  
  const query = supabase
    .from('explanations')
    .select()
    .order(orderBy, { ascending: order === 'asc' })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Update an existing explanation record
 * @param id Explanation record ID
 * @param updates Partial explanation data to update
 * @returns Updated explanation record
 */
export async function updateExplanation(
  id: number,
  updates: Partial<ExplanationInsertType>
): Promise<ExplanationFullDbType> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('explanations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete an explanation record
 * @param id Explanation record ID
 * @returns void
 */
export async function deleteExplanation(id: number): Promise<void> {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('explanations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Get explanation records by IDs
 * @param ids Array of explanation record IDs
 * @returns Array of explanation records that were found
 * 
 * Example usage:
 * ```typescript
 * const explanations = await getExplanationsByIds([1, 2, 3]);
 * // Returns: ExplanationFullDbType[] - array of found explanations
 * // Note: May return fewer items than requested if some IDs don't exist
 * ```
 */
export async function getExplanationsByIds(ids: number[]): Promise<ExplanationFullDbType[]> {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('explanations')
    .select()
    .in('id', ids);

  if (error) throw error;
  return data || [];
}

/**
 * Get explanations by topic ID
 * @param topicId Topic ID to search for in both primary and secondary topic fields
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @returns Array of explanation records related to the topic
 * 
 * Example usage:
 * ```typescript
 * const explanations = await getExplanationsByTopicId(1);
 * // Returns: ExplanationFullDbType[] - array of explanations with matching topic ID
 * ```
 */
export async function getExplanationsByTopicId(
  topicId: number,
  limit: number = 10,
  offset: number = 0
): Promise<ExplanationFullDbType[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('explanations')
    .select()
    .or(`primary_topic_id.eq.${topicId},secondary_topic_id.eq.${topicId}`)
    .range(offset, offset + limit - 1)
    .order('timestamp', { ascending: false });

  if (error) throw error;
  return data || [];
} 