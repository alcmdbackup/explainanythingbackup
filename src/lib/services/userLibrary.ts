import { supabase } from '@/lib/supabase';
import { userLibraryType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/server_utilities';

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