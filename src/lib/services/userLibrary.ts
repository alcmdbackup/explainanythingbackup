/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { userLibraryType } from '@/lib/schemas/schemas';
import { getExplanationsByIds } from '@/lib/services/explanations';
import { incrementExplanationSaves } from '@/lib/services/metrics';
import { assertUserId } from '@/lib/utils/validation';

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
export async function saveExplanationToLibrary(
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

  // Update aggregate metrics (run in background, don't wait)
  incrementExplanationSaves(explanationid).catch(metricsError => {
    logger.error('Failed to update explanation metrics after save', {
      explanationid,
      error: metricsError instanceof Error ? metricsError.message : String(metricsError)
    });
  });

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
export async function getExplanationIdsForUser(
  userid: string,
  getCreateDate: boolean = false
): Promise<number[] | { explanationid: number; created: string }[]> {
  assertUserId(userid, 'getExplanationIdsForUser');
  const supabase = await createSupabaseServerClient()
  
  const selectFields = getCreateDate ? 'explanationid, created' : 'explanationid';
  const { data, error } = await supabase
    .from('userLibrary')
    .select(selectFields)
    .eq('userid', userid);

  if (error) {
    logger.error('Error fetching explanation IDs for user', { error: error.message, userid });
    throw error;
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
 * - Calls getExplanationIdsForUser(userid, true) to get all explanation IDs and created dates saved by the user
 * - Calls getExplanationsByIds(ids) to fetch the full explanation records
 * - Returns an array of { explanationid, created, explanation } objects
 * - Throws an error if any step fails
 *
 * This function is used by features that need to display all explanations a user has saved in their library.
 * It calls getExplanationIdsForUser and getExplanationsByIds.
 */
export async function getUserLibraryExplanations(userid: string) {
  assertUserId(userid, 'getUserLibraryExplanations');
  const idCreatedArr = await getExplanationIdsForUser(userid, true) as { explanationid: number; created: string }[];
  if (!idCreatedArr.length) return [];
  const explanations = await getExplanationsByIds(idCreatedArr.map(x => x.explanationid));
  // Map explanationid to explanation for fast lookup
  const explanationMap = new Map<number, any>(explanations.map(e => [e.id, e]));
  return idCreatedArr.map(({ explanationid, created }) => {
    const explanation = explanationMap.get(explanationid) || {};
    return {
      id: explanation.id,
      explanation_title: explanation.explanation_title,
      content: explanation.content,
      primary_topic_id: explanation.primary_topic_id,
      timestamp: explanation.timestamp,
      saved_timestamp: created,
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
export async function isExplanationSavedByUser(
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