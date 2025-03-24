import { supabase } from '@/lib/supabase';
import { type ExplanationFullDbType, type ExplanationInsertType } from '@/lib/schemas/schemas';

/**
 * Service for interacting with the explanations table in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Create an explanation
 * const newExplanation = await createExplanation({ 
 *   user_query: "What is React?", 
 *   title: "Introduction to React",
 *   content: "React is a JavaScript library..." 
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
  const { data, error } = await supabase
    .from('explanations')
    .insert(explanation)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get an explanation record by ID
 * @param id Explanation record ID
 * @returns Explanation record if found
 */
export async function getExplanationById(id: number): Promise<ExplanationFullDbType | null> {
  const { data, error } = await supabase
    .from('explanations')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
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
  // Validate parameters
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;
  
  let query = supabase
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
  const { error } = await supabase
    .from('explanations')
    .delete()
    .eq('id', id);

  if (error) throw error;
} 