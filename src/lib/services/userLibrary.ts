/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * User library service for managing saved explanations.
 * Handles saving, retrieving, and checking user's saved explanations.
 */
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { userLibraryType } from '@/lib/schemas/schemas';
import { incrementExplanationSaves } from '@/lib/services/metrics';
import { assertUserId } from '@/lib/utils/validation';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { ServiceError } from '@/lib/errors/serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';

//const supabase = await createClient()

/**
 * Save an explanation to the current user's library
 *
 * - Inserts a new record into the userLibrary table with the given explanationid and userid
 * - Updates aggregate metrics for the explanation using stored procedure
 * - Returns the created userLibrary record
 * - Throws an error if the insert fails
 *
 * This function is used by features that allow users to save explanations to their personal library.
 * It calls Supabase directly and incrementExplanationSaves for metrics updates.
 */
async function saveExplanationToLibraryImpl(
  explanationid: number,
  userid: string
): Promise<userLibraryType> {
  assertUserId(userid, 'saveExplanationToLibrary');
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('userLibrary')
    .insert({ explanationid, userid })
    .select('id, explanationid, userid, created')
    .single();

  if (error) {
    logger.error('Error saving explanation to user library', { error: error.message });
    throw error;
  }

  // Update aggregate metrics
  try {
    await incrementExplanationSaves(explanationid);
  } catch (metricsError) {
    throw new ServiceError(
      ERROR_CODES.DATABASE_ERROR,
      'Failed to update explanation metrics after save',
      'saveExplanationToLibrary',
      {
        details: { explanationid },
        cause: metricsError instanceof Error ? metricsError : undefined
      }
    );
  }

  return data;
}

/**
 * Get all explanation IDs (and optionally created dates) in the userLibrary table for a given user
 *
 * - Queries the userLibrary table for all records matching the given userid
 * - If getCreateDate is true, returns an array of { explanationid, created } objects
 *   Otherwise, returns an array of explanationid numbers
 * - Throws an error if the query fails
 *
 * This function is used by features that need to retrieve all explanations saved by a user.
 * It calls Supabase directly and does not call any other functions.
 *
 * Used by: getUserLibraryExplanations (with getCreateDate=true)
 */
async function getExplanationIdsForUserImpl(
  userid: string,
  getCreateDate: boolean = false
): Promise<number[] | { explanationid: number; created: string }[]> {
  assertUserId(userid, 'getExplanationIdsForUser');
  const supabase = await createSupabaseServerClient()

  // E2E DEBUG: Log server auth state to diagnose RLS issues
  if (process.env.E2E_TEST_MODE === 'true') {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    logger.info('[E2E DEBUG] getExplanationIdsForUser', {
      serverAuthUid: authData?.user?.id ?? 'NULL',
      authError: authError?.message ?? null,
      queryUserid: userid,
      idsMatch: authData?.user?.id === userid
    });
  }

  const selectFields = getCreateDate ? 'explanationid, created' : 'explanationid';
  const { data, error } = await supabase
    .from('userLibrary')
    .select(selectFields)
    .eq('userid', userid);

  if (error) {
    logger.error('Error fetching explanation IDs for user', { error: error.message, userid });
    throw error;
  }

  // E2E DEBUG: Log query results
  if (process.env.E2E_TEST_MODE === 'true') {
    logger.info('[E2E DEBUG] getExplanationIdsForUser query results', {
      rowCount: data?.length ?? 0,
      firstRow: data?.[0] ?? null
    });
  }

  if (getCreateDate) {
    const typedData = (data as unknown as { explanationid: number; created: string }[]) || [];
    return typedData.map(row => ({
      explanationid: row.explanationid,
      created: row.created,
    }));
  }
  // Return just the explanationid values as an array of numbers
  const typedData = (data as unknown as { explanationid: number }[]) || [];
  return typedData.map(row => row.explanationid);
}

/**
 * Get all explanations saved in a user's library, paired with their explanationid and created date
 *
 * Uses PostgREST JOIN to fetch user library entries with their associated explanations
 * in a single query (previously required 2 sequential queries).
 *
 * This function is used by features that need to display all explanations a user has saved in their library.
 */
async function getUserLibraryExplanationsImpl(userid: string) {
  assertUserId(userid, 'getUserLibraryExplanations');
  const supabase = await createSupabaseServerClient();

  // Use PostgREST JOIN via FK relationship: userLibrary_explanationid_fkey
  // This replaces 2 sequential queries with 1 query that JOINs the tables
  const { data, error } = await supabase
    .from('userLibrary')
    .select(`
      explanationid,
      created,
      explanations!userLibrary_explanationid_fkey (
        id,
        explanation_title,
        content,
        primary_topic_id,
        timestamp,
        secondary_topic_id,
        status
      )
    `)
    .eq('userid', userid);

  if (error) {
    logger.error('Error fetching user library explanations', { error: error.message, userid });
    throw error;
  }

  if (!data || data.length === 0) return [];

  // Transform the joined data to the expected format
  return data.map((row: any) => {
    const explanation = row.explanations || {};
    return {
      id: explanation.id,
      explanation_title: explanation.explanation_title,
      content: explanation.content,
      primary_topic_id: explanation.primary_topic_id,
      timestamp: explanation.timestamp,
      saved_timestamp: row.created,
      secondary_topic_id: explanation.secondary_topic_id,
      status: explanation.status,
    };
  });
}

/**
 * Check if a specific explanation is saved in the user's library
 *
 * - Queries the userLibrary table for a record matching userid and explanationid
 * - Returns true if found, false otherwise
 * - Throws an error if the query fails
 *
 * Used by: UI components to determine if the Save button should be enabled/disabled
 */
async function isExplanationSavedByUserImpl(
  explanationid: number,
  userid: string
): Promise<boolean> {
  assertUserId(userid, 'isExplanationSavedByUser');
  const supabase = await createSupabaseServerClient()
  
  const { data, error } = await supabase
    .from('userLibrary')
    .select('id')
    .eq('userid', userid)
    .eq('explanationid', explanationid)
    .maybeSingle();

  if (error) {
    logger.error('Error checking if explanation is saved', { error: error.message, userid, explanationid });
    throw error;
  }

  return !!data;
}

// Wrap all functions with automatic logging for entry/exit/timing
export const saveExplanationToLibrary = withLogging(
  saveExplanationToLibraryImpl,
  'saveExplanationToLibrary',
  { logErrors: true }
);

export const getExplanationIdsForUser = withLogging(
  getExplanationIdsForUserImpl,
  'getExplanationIdsForUser',
  { logErrors: true }
);

export const getUserLibraryExplanations = withLogging(
  getUserLibraryExplanationsImpl,
  'getUserLibraryExplanations',
  { logErrors: true }
);

export const isExplanationSavedByUser = withLogging(
  isExplanationSavedByUserImpl,
  'isExplanationSavedByUser',
  { logErrors: true }
);