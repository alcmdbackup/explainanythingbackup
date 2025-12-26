/* eslint-disable @typescript-eslint/no-unused-vars */
'use server'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import {
  userExplanationEventsSchema,
  type UserExplanationEventsType,
  explanationMetricsSchema,
  explanationMetricsTableSchema,
  type ExplanationMetricsType,
  type ExplanationMetricsTableType,
  type ExplanationMetricsInsertType
} from '@/lib/schemas/schemas';

/**
 * Service for tracking user events related to explanations in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Track an explanation view event
 * const event = await createUserExplanationEvent({ 
 *   event_name: "explanation_viewed",
 *   userid: "user123",
 *   explanationid: 456,
 *   value: 1,
 *   metadata: "{\"duration_seconds\": 30, \"source\": \"search\"}"
 * });
 * ```
 */

/**
 * Creates a new user explanation event record in the database
 * • Validates input data against userExplanationEventsSchema before insertion
 * • Inserts validated event data into userExplanationEvents table
 * • Updates aggregate metrics if the event is an explanation view
 * • Returns the created record with database-generated fields
 * • Provides detailed error logging for debugging failed insertions
 * • Used by analytics and tracking functions to record user interactions
 */
export async function createUserExplanationEvent(eventData: UserExplanationEventsType): Promise<UserExplanationEventsType> {
  // Use service client to bypass RLS for metrics tracking
  const supabase = await createSupabaseServiceClient();
  
  // Validate input data against schema
  const validationResult = userExplanationEventsSchema.safeParse(eventData);
  if (!validationResult.success) {
    logger.error('Invalid event data', { error: validationResult.error.message });
    throw new Error(`Invalid event data: ${validationResult.error.message}`);
  }
  

  
  const { data, error } = await supabase
    .from('userExplanationEvents')
    .insert(validationResult.data)
    .select()
    .single();

  if (error) {
    logger.error('Error creating user explanation event', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw error;
  }

  // Update aggregate metrics if this is a view event (run in background, don't wait)
  if (validationResult.data.event_name === 'explanation_viewed') {
    incrementExplanationViews(validationResult.data.explanationid).catch(metricsError => {
      logger.error('Failed to update explanation metrics after view event', {
        explanationid: validationResult.data.explanationid,
        event_name: validationResult.data.event_name,
        error: metricsError instanceof Error ? metricsError.message : String(metricsError)
      });
    });
  }

  return data;
}

/**
 * === AGGREGATE METRICS FUNCTIONS ===
 * Functions for managing the explanationMetrics aggregate table
 */

/**
 * Refreshes aggregate metrics using stored procedures
 * • Calculates total saves from userLibrary table
 * • Calculates total views from userExplanationEvents table (event_name = 'explanation_viewed')
 * • Calculates save rate as saves/views ratio (handles division by zero)
 * • Uses database stored procedure for efficient batch calculation
 * • Updates or inserts records in explanationMetrics table
 * 
 * @param options - Refresh options
 * @param options.explanationIds - Single explanation ID or array of explanation IDs to refresh (ignored if refreshAll is true)
 * @param options.refreshAll - If true, refreshes all explanations in the database
 * @returns Object with results array and count of processed explanations
 */
export async function refreshExplanationMetrics(options: {
  explanationIds?: number | number[];
  refreshAll?: boolean;
} = {}): Promise<{
  results: ExplanationMetricsType[];
  count: number;
}> {
  const supabase = await createSupabaseServerClient();
  
  if (options.refreshAll) {
    // Refresh all explanations
    const { data: count, error } = await supabase
      .rpc('refresh_all_explanation_metrics');

    if (error) {
      logger.error('Error refreshing all explanation metrics', { error: error.message });
      throw error;
    }

    return {
      results: [], // All refresh doesn't return individual results
      count: count || 0
    };
  } else {
    // Refresh specific explanations
    if (!options.explanationIds) {
      throw new Error('Either explanationIds must be provided or refreshAll must be true');
    }

    // Normalize input to array
    const idsArray = Array.isArray(options.explanationIds) ? options.explanationIds : [options.explanationIds];
    
    // Call stored procedure to calculate and update metrics
    const { data, error } = await supabase
      .rpc('refresh_explanation_metrics', { explanation_ids: idsArray });

    if (error) {
      logger.error('Error refreshing explanation metrics', { error: error.message });
      throw error;
    }

    // Validate the returned data array
    if (!Array.isArray(data)) {
      throw new Error('Expected array of metrics data from stored procedure');
    }

    const results: ExplanationMetricsType[] = [];
    for (const item of data) {
      const validationResult = explanationMetricsSchema.safeParse(item);
      if (!validationResult.success) {
        logger.error('Invalid metrics data returned from stored procedure', { error: validationResult.error.message });
        throw new Error(`Invalid metrics data: ${validationResult.error.message}`);
      }
      results.push(validationResult.data);
    }

    return {
      results,
      count: results.length
    };
  }
}


/**
 * Gets aggregate metrics for multiple explanations
 * • Efficiently fetches metrics for multiple explanations
 * • Returns metrics in same order as input IDs
 * • Missing explanations return null in the corresponding position
 * 
 * @param explanationIds - Array of explanation IDs to get metrics for
 * @returns Array of metrics records (null for missing explanations)
 */
export async function getMultipleExplanationMetrics(explanationIds: number[]): Promise<(ExplanationMetricsTableType | null)[]> {
  if (explanationIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('explanationMetrics')
    .select('*')
    .in('explanationid', explanationIds);

  if (error) {
    logger.error('Error fetching multiple explanation metrics', { error: error.message });
    throw error;
  }

  // Create a map for quick lookup (uses table schema with explanationid)
  const metricsMap = new Map<number, ExplanationMetricsTableType>();
  data?.forEach(metric => {
    metricsMap.set(metric.explanationid, metric as ExplanationMetricsTableType);
  });

  // Return results in the same order as input, with null for missing
  return explanationIds.map(id => metricsMap.get(id) || null);
}

/**
 * Increments view count for an explanation using stored procedure
 * • Simply increments existing view count by 1 (no recalculation from source tables)
 * • Recalculates save rate based on new view count
 * • Used when tracking explanation views
 * 
 * @param explanationId - The explanation ID to increment views for
 * @returns Updated metrics record
 */
export async function incrementExplanationViews(explanationId: number): Promise<ExplanationMetricsType> {
  // Use service client to bypass RLS for background metrics tracking
  const supabase = await createSupabaseServiceClient();
  
  // Call stored procedure to increment views and recalculate metrics
  const { data, error } = await supabase
    .rpc('increment_explanation_views', { p_explanation_id: explanationId });

  if (error) {
    logger.error('Error incrementing explanation views', { error: error.message });
    throw error;
  }

  // The function returns an array, so get the first (and only) result
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Expected single metrics record from increment procedure');
  }

  // Debug: log the actual data format
  logger.debug('Raw data from stored procedure', { data: data[0] });

  // Validate the returned data
  const validationResult = explanationMetricsSchema.safeParse(data[0]);
  if (!validationResult.success) {
    logger.error('Invalid metrics data returned from increment procedure', {
      error: validationResult.error.message,
      rawData: data[0]
    });
    throw new Error(`Invalid metrics data: ${validationResult.error.message}`);
  }

  return validationResult.data;
}

/**
 * Increments save count for an explanation using stored procedure
 * • Simply increments existing save count by 1 (no recalculation from source tables)
 * • Recalculates save rate based on new save count
 * • Used when users save explanations to their library
 * 
 * @param explanationId - The explanation ID to increment saves for
 * @returns Updated metrics record
 */
export async function incrementExplanationSaves(explanationId: number): Promise<ExplanationMetricsType> {
  // Use service client to bypass RLS for background metrics tracking
  const supabase = await createSupabaseServiceClient();
  
  // Call stored procedure to increment saves and recalculate metrics
  const { data, error } = await supabase
    .rpc('increment_explanation_saves', { p_explanation_id: explanationId });

  if (error) {
    logger.error('Error incrementing explanation saves', { error: error.message });
    throw error;
  }

  // The function now returns an array, so get the first (and only) result
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Expected single metrics record from increment procedure');
  }

  // Validate the returned data
  const validationResult = explanationMetricsSchema.safeParse(data[0]);
  if (!validationResult.success) {
    logger.error('Invalid metrics data returned from increment procedure', { error: validationResult.error.message });
    throw new Error(`Invalid metrics data: ${validationResult.error.message}`);
  }

  return validationResult.data;
} 