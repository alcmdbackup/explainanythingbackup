import { supabase } from '@/lib/supabase';
import { userLibraryType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/server_utilities';
import { getExplanationsByIds } from '@/lib/services/explanations';

/**
 * Save an explanation to the current user's library
 *
 * - Inserts a new record into the userLibrary table with the given explanationid and userid
 * - Returns the created userLibrary record
 * - Throws an error if the insert fails
 *
 * This function is used by features that allow users to save explanations to their personal library.
 * It calls Supabase directly and does not call any other functions.
 */
export async function saveExplanationToLibrary(
  explanationid: number,
  userid: string
): Promise<userLibraryType> {
  const { data, error } = await supabase
    .from('userLibrary')
    .insert({ explanationid, userid })
    .select('id, explanationid, userid, created')
    .single();

  if (error) {
    console.error('Error saving explanation to user library:', error);
    throw error;
  }

  return data;
}

/**
 * Get all explanation IDs in the userLibrary table for a given user
 *
 * - Queries the userLibrary table for all records matching the given userid
 * - Returns an array of explanationid numbers
 * - Throws an error if the query fails
 *
 * This function is used by features that need to retrieve all explanations saved by a user.
 * It calls Supabase directly and does not call any other functions.
 */
export async function getExplanationIdsForUser(userid: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('userLibrary')
    .select('explanationid')
    .eq('userid', userid);

  if (error) {
    console.error('Error fetching explanation IDs for user:', error);
    throw error;
  }

  // Return just the explanationid values as an array of numbers
  return (data || []).map((row: { explanationid: number }) => row.explanationid);
}

/**
 * Get all explanations saved in a user's library
 *
 * - Calls getExplanationIdsForUser(userid) to get all explanation IDs saved by the user
 * - Calls getExplanationsByIds(ids) to fetch the full explanation records
 * - Returns an array of explanation records (same type as getRecentExplanations)
 * - Throws an error if any step fails
 *
 * This function is used by features that need to display all explanations a user has saved in their library.
 * It calls getExplanationIdsForUser and getExplanationsByIds.
 */
export async function getUserLibraryExplanations(userid: string) {
  const ids = await getExplanationIdsForUser(userid);
  if (!ids.length) return [];
  return await getExplanationsByIds(ids);
} 