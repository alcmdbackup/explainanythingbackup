import { supabase } from '@/lib/supabase';
import { type UserQueryInsertType } from '@/lib/schemas/schemas';

/**
 * Service for interacting with the user_queries table in Supabase
 * Tracks all user queries and their generated responses
 * 
 * Example usage:
 * ```typescript
 * // Create a user query record
 * const newQuery = await createUserQuery({ 
 *   user_query: "What is React?", 
 *   explanation_title: "Introduction to React",
 *   content: "React is a JavaScript library...",
 *   matches: [...]
 * });
 * ```
 */

/**
 * Create a new user query record
 * @param query Query data to insert
 * @param explanationId (optional) Explanation ID to associate
 * @returns Created user query record
 */
export async function createUserQuery(query: UserQueryInsertType, explanationId?: number) {
  const insertObj = explanationId != null ? { ...query, explanation_id: explanationId } : query;
  const { data, error } = await supabase
    .from('userQueries')
    .insert(insertObj)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get recent user queries with pagination
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @returns Array of user query records
 */
export async function getRecentUserQueries(
  limit: number = 10,
  offset: number = 0
) {
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;
  
  const { data, error } = await supabase
    .from('userQueries')
    .select()
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
} 