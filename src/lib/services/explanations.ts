'use server'
/**
 * Service for interacting with the explanations table in Supabase.
 * Provides CRUD operations and query methods for explanations.
 */

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { type ExplanationFullDbType, type ExplanationInsertType, type ExplanationWithViewCount, type SortMode, type TimePeriod } from '@/lib/schemas/schemas';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

/**
 * Prefixes used to identify test content that should be excluded from discovery.
 * Test content is created with these prefixes to prevent it from appearing in
 * Explore page, search results, and related content recommendations.
 */
const TEST_CONTENT_PREFIX = '[TEST]';
const LEGACY_TEST_PREFIX = 'test-';

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
async function createExplanationImpl(explanation: ExplanationInsertType): Promise<ExplanationFullDbType> {
  const supabase = await createSupabaseServerClient()
  

  
  const { data, error } = await supabase
    .from('explanations')
    .insert(explanation)
    .select('id, explanation_title, content, timestamp, primary_topic_id, secondary_topic_id, status')
    .single();

  if (error) {
    logger.error('Error creating explanation', {
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
 *
 * Uses .limit(1) instead of .single() to handle edge cases gracefully
 * (e.g., replication lag, RLS timing issues) without throwing PostgREST errors
 */
async function getExplanationByIdImpl(id: number): Promise<ExplanationFullDbType> {
  const supabase = await createSupabaseServerClient()

  // Use .limit(1) instead of .single() to avoid "Cannot coerce" errors
  // when replication lag or RLS timing causes 0 rows to be returned temporarily
  const { data: results, error } = await supabase
    .from('explanations')
    .select()
    .eq('id', id)
    .limit(1);

  if (error) throw error;
  if (!results || results.length === 0) {
    throw new Error(`Explanation not found for ID: ${id}`);
  }
  return results[0];
}

/**
 * Get recent explanations with pagination and optional sorting/filtering
 * @param limit Number of records to return
 * @param offset Number of records to skip
 * @param options Optional sort mode and time period for filtering
 * @returns Array of explanation records
 *
 * @example
 * // Get newest explanations (default)
 * const newExplanations = await getRecentExplanations(10, 0, { sort: 'new' });
 *
 * // Get top explanations this week
 * const topWeek = await getRecentExplanations(10, 0, { sort: 'top', period: 'week' });
 *
 * // Get top explanations all time
 * const topAll = await getRecentExplanations(10, 0, { sort: 'top', period: 'all' });
 */
async function getRecentExplanationsImpl(
  limit: number = 10,
  offset: number = 0,
  options?: {
    sort?: SortMode;      // 'new' | 'top', default 'new'
    period?: TimePeriod;  // 'today' | 'week' | 'month' | 'all', default 'week'
  }
): Promise<ExplanationWithViewCount[]> {
  const supabase = await createSupabaseServerClient()

  // Validate parameters
  if (limit <= 0) limit = 10;
  if (offset < 0) offset = 0;

  const sort = options?.sort ?? 'new';
  const period = options?.period ?? 'week';

  logger.debug('getRecentExplanations', { sort, period });

  // For 'new' mode, use simple timestamp ordering
  if (sort === 'new') {
    const { data, error } = await supabase
      .from('explanations')
      .select()
      .eq('status', 'published')
      .not('explanation_title', 'ilike', `${TEST_CONTENT_PREFIX}%`)
      .not('explanation_title', 'ilike', `${LEGACY_TEST_PREFIX}%`)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  // For 'top' mode, count views during the period from userExplanationEvents
  // Query userExplanationEvents to get view counts grouped by explanationid
  // Filter by event_name = 'explanation_viewed' and created_at within period
  let viewCountsQuery = supabase
    .from('userExplanationEvents')
    .select('explanationid')
    .eq('event_name', 'explanation_viewed');

  // Add time filter (except for 'all')
  if (period !== 'all') {
    const cutoffDate = new Date();
    switch (period) {
      case 'hour':
        cutoffDate.setHours(cutoffDate.getHours() - 1);
        break;
      case 'today':
        cutoffDate.setDate(cutoffDate.getDate() - 1);
        break;
      case 'week':
        cutoffDate.setDate(cutoffDate.getDate() - 7);
        break;
      case 'month':
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        break;
    }
    logger.debug('getRecentExplanations cutoffDate', { cutoffDate: cutoffDate.toISOString() });
    viewCountsQuery = viewCountsQuery.gte('created_at', cutoffDate.toISOString());
  }

  const { data: viewEvents, error: viewError } = await viewCountsQuery;

  if (viewError) throw viewError;

  // Count views per explanation
  const viewCounts = new Map<number, number>();
  for (const event of viewEvents || []) {
    const count = viewCounts.get(event.explanationid) || 0;
    viewCounts.set(event.explanationid, count + 1);
  }

  logger.debug('getRecentExplanations viewCounts', { size: viewCounts.size, totalEvents: viewEvents?.length });

  // Step 2: Get all published explanations (excluding test content)
  const { data: explanations, error: expError } = await supabase
    .from('explanations')
    .select()
    .eq('status', 'published')
    .not('explanation_title', 'ilike', `${TEST_CONTENT_PREFIX}%`)
    .not('explanation_title', 'ilike', `${LEGACY_TEST_PREFIX}%`);

  if (expError) throw expError;

  // Step 3: Add view counts and sort by view count (descending), then by timestamp (descending) as tiebreaker
  const explanationsWithViews: ExplanationWithViewCount[] = (explanations || []).map(exp => ({
    ...exp,
    viewCount: viewCounts.get(exp.id) || 0
  }));

  explanationsWithViews.sort((a, b) => {
    const viewsA = a.viewCount || 0;
    const viewsB = b.viewCount || 0;
    if (viewsB !== viewsA) {
      return viewsB - viewsA; // Higher views first
    }
    // Tiebreaker: newer explanations first
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Apply pagination
  return explanationsWithViews.slice(offset, offset + limit);
}

/**
 * Update an existing explanation record
 * Uses service client to bypass RLS since this is a trusted server-side operation
 * @param id Explanation record ID
 * @param updates Partial explanation data to update
 * @returns Updated explanation record
 */
async function updateExplanationImpl(
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
async function deleteExplanationImpl(id: number): Promise<void> {
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
async function getExplanationsByIdsImpl(ids: number[]): Promise<ExplanationFullDbType[]> {
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
async function getExplanationsByTopicIdImpl(
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

// Wrap all async functions with automatic logging for entry/exit/timing
export const createExplanation = withLogging(
  createExplanationImpl,
  'createExplanation',
  { logErrors: true }
);

export const getExplanationById = withLogging(
  getExplanationByIdImpl,
  'getExplanationById',
  { logErrors: true }
);

export const getRecentExplanations = withLogging(
  getRecentExplanationsImpl,
  'getRecentExplanations',
  { logErrors: true }
);

export const updateExplanation = withLogging(
  updateExplanationImpl,
  'updateExplanation',
  { logErrors: true }
);

export const deleteExplanation = withLogging(
  deleteExplanationImpl,
  'deleteExplanation',
  { logErrors: true }
);

export const getExplanationsByIds = withLogging(
  getExplanationsByIdsImpl,
  'getExplanationsByIds',
  { logErrors: true }
);

export const getExplanationsByTopicId = withLogging(
  getExplanationsByTopicIdImpl,
  'getExplanationsByTopicId',
  { logErrors: true }
);