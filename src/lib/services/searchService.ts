import { supabase } from '@/lib/supabase';
import { Search, SearchInsert } from '@/types/database';

/**
 * Service for interacting with the searches table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Create a search
 * const newSearch = await createSearch({ user_query: "What is React?", response: "React is..." });
 * 
 * // Get recent searches
 * const searches = await getRecentSearches(5);
 * 
 * // Get search by ID
 * const search = await getSearchById(1);
 * ```
 */

/**
 * Create a new search record
 * @param search Search data to insert
 * @returns Created search record
 */
export async function createSearch(search: SearchInsert): Promise<Search> {
  const { data, error } = await supabase
    .from('searches')
    .insert(search)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get a search record by ID
 * @param id Search record ID
 * @returns Search record if found
 */
export async function getSearchById(id: number): Promise<Search | null> {
  const { data, error } = await supabase
    .from('searches')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get recent searches with pagination
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @param userId Optional user ID to filter by
 * @returns Array of search records
 */
export async function getRecentSearches(
  limit: number = 10,
  offset: number = 0,
  userId?: string
): Promise<Search[]> {
  // Validate parameters
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;
  
  let query = supabase
    .from('searches')
    .select()
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Update an existing search record
 * @param id Search record ID
 * @param updates Partial search data to update
 * @returns Updated search record
 */
export async function updateSearch(
  id: number,
  updates: Partial<SearchInsert>
): Promise<Search> {
  const { data, error } = await supabase
    .from('searches')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a search record
 * @param id Search record ID
 * @returns void
 */
export async function deleteSearch(id: number): Promise<void> {
  const { error } = await supabase
    .from('searches')
    .delete()
    .eq('id', id);

  if (error) throw error;
} 