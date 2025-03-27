import { supabase } from '@/lib/supabase';
import { type TopicFullDbType, type TopicInsertType } from '@/lib/schemas/schemas';

/**
 * Service for interacting with the topics table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Create a topic
 * const newTopic = await createTopic({ 
 *   topic_title: "Physics",
 *   topic_description: "Fundamental science of matter and energy"
 * });
 * 
 * // Get recent topics
 * const topics = await getRecentTopics(5);
 * 
 * // Get topic by ID
 * const topic = await getTopicById(1);
 * ```
 */

/**
 * Create a new topic record
 * @param topic Topic data to insert
 * @returns Created topic record
 */
export async function createTopic(topic: TopicInsertType): Promise<TopicFullDbType> {
  const { data, error } = await supabase
    .from('topics')
    .insert(topic)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get a topic record by ID
 * @param id Topic record ID
 * @returns Topic record if found
 */
export async function getTopicById(id: number): Promise<TopicFullDbType | null> {
  const { data, error } = await supabase
    .from('topics')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get recent topics with pagination
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @param orderBy Order by column
 * @param order Order direction
 * @returns Array of topic records
 */
export async function getRecentTopics(
  limit: number = 10,
  offset: number = 0,
  orderBy: string = 'created_at',
  order: 'asc' | 'desc' = 'desc'
): Promise<TopicFullDbType[]> {
  // Validate parameters
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;
  
  let query = supabase
    .from('topics')
    .select()
    .order(orderBy, { ascending: order === 'asc' })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Update an existing topic record
 * @param id Topic record ID
 * @param updates Partial topic data to update
 * @returns Updated topic record
 */
export async function updateTopic(
  id: number,
  updates: Partial<TopicInsertType>
): Promise<TopicFullDbType> {
  const { data, error } = await supabase
    .from('topics')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a topic record
 * @param id Topic record ID
 * @returns void
 */
export async function deleteTopic(id: number): Promise<void> {
  const { error } = await supabase
    .from('topics')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Search topics by title
 * @param searchTerm Search term to match against topic titles
 * @param limit Maximum number of results to return
 * @returns Array of matching topic records
 */
export async function searchTopicsByTitle(
  searchTerm: string,
  limit: number = 10
): Promise<TopicFullDbType[]> {
  const { data, error } = await supabase
    .from('topics')
    .select()
    .ilike('topic_title', `%${searchTerm}%`)
    .limit(limit);

  if (error) throw error;
  return data || [];
} 