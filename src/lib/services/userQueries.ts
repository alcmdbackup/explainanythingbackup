import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { type UserQueryInsertType } from '@/lib/schemas/schemas';
import { assertUserId } from '@/lib/utils/validation';

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
export async function createUserQuery(query: UserQueryInsertType) {
  assertUserId(query.userid, 'createUserQuery');
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('userQueries')
    .insert(query)
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
  const supabase = await createSupabaseServerClient()

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

/**
 * Get a user query record by ID
 * @param id User query record ID
 * @returns User query record if found
 */
export async function getUserQueryById(id: number) {
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('userQueries')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) {
    throw new Error(`User query not found for ID: ${id}`);
  }
  return data;
} 