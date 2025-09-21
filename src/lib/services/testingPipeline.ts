import { supabase } from '../supabase';
import { logger } from '../client_utilities';

export interface TestingPipelineRecord {
  id?: number;
  set_name: string;
  step: string;
  content: string;
  created_at?: string;
  updated_at?: string;
}

export interface TestingPipelineInsert {
  set_name: string;
  step: string;
  content: string;
}

/**
 * Checks if an exact match exists in the testing pipeline table
 *
 * • Searches for records with matching set_name, step, and content
 * • Returns true if an exact match is found, false otherwise
 * • Used to avoid duplicate entries in the testing pipeline
 */
export async function checkTestingPipelineExists(
  setName: string,
  step: string,
  content: string
): Promise<boolean> {
  try {
    logger.debug('Checking if testing pipeline record exists:', {
      setName,
      step,
      contentLength: content.length
    });

    const { data, error } = await supabase
      .from('testing_edits_pipeline')
      .select('id')
      .eq('set_name', setName)
      .eq('step', step)
      .eq('content', content)
      .limit(1);

    if (error) {
      logger.error('Supabase error checking testing pipeline existence:', {
        error: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
        setName,
        step,
        contentLength: content.length
      });
      throw error;
    }

    return data && data.length > 0;
  } catch (error) {
    logger.error('Unexpected error in checkTestingPipelineExists:', {
      error: error instanceof Error ? error.message : String(error),
      setName,
      step,
      contentLength: content.length
    });
    throw error;
  }
}

/**
 * Saves a record to the testing pipeline table
 *
 * • Inserts a new record with set_name, step, and content
 * • Returns the created record with database-generated fields
 * • Used to track pipeline results at each step
 */
export async function saveTestingPipelineRecord(
  record: TestingPipelineInsert
): Promise<TestingPipelineRecord> {
  try {
    logger.debug('Attempting to save testing pipeline record:', {
      setName: record.set_name,
      step: record.step,
      contentLength: record.content.length
    });

    const { data, error } = await supabase
      .from('testing_edits_pipeline')
      .insert({
        set_name: record.set_name,
        step: record.step,
        content: record.content
      })
      .select()
      .single();

    if (error) {
      logger.error('Supabase error saving testing pipeline record:', {
        error: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
        setName: record.set_name,
        step: record.step,
        contentLength: record.content.length
      });
      throw error;
    }

    logger.debug('Testing pipeline record saved successfully:', {
      id: data.id,
      setName: data.set_name,
      step: data.step,
      contentLength: data.content.length
    });

    return data;
  } catch (error) {
    logger.error('Unexpected error in saveTestingPipelineRecord:', {
      error: error instanceof Error ? error.message : String(error),
      setName: record.set_name,
      step: record.step,
      contentLength: record.content.length
    });
    throw error;
  }
}

/**
 * Checks and saves a testing pipeline record if it doesn't already exist
 *
 * • First checks if an exact match exists using checkTestingPipelineExists
 * • Only saves if no exact match is found
 * • Returns boolean indicating if a save was performed
 * • Used by the main pipeline function to avoid duplicates
 */
export async function checkAndSaveTestingPipelineRecord(
  setName: string,
  step: string,
  content: string
): Promise<{ saved: boolean; record?: TestingPipelineRecord }> {
  console.log('🔧 SERVICE: checkAndSaveTestingPipelineRecord called with:', {
    setName,
    step,
    contentLength: content.length
  });

  try {
    console.log('🔧 SERVICE: About to check if record exists');
    // Check if exact match already exists
    const exists = await checkTestingPipelineExists(setName, step, content);
    console.log('🔧 SERVICE: Record exists check result:', exists);

    if (exists) {
      console.log('🔧 SERVICE: Record already exists, skipping save');
      logger.debug('Testing pipeline record already exists, skipping save:', {
        setName,
        step,
        contentLength: content.length
      });
      return { saved: false };
    }

    console.log('🔧 SERVICE: Record does not exist, about to save new record');
    // Save new record
    const record = await saveTestingPipelineRecord({
      set_name: setName,
      step: step,
      content: content
    });
    console.log('🔧 SERVICE: Save completed, record:', record);

    logger.debug('New testing pipeline record saved:', {
      id: record.id,
      setName: record.set_name,
      step: record.step,
      contentLength: record.content.length
    });

    console.log('🔧 SERVICE: Returning success result');
    return { saved: true, record };
  } catch (error) {
    console.log('🔧 SERVICE: Exception caught in checkAndSaveTestingPipelineRecord:', error);
    logger.error('Error in checkAndSaveTestingPipelineRecord:', {
      error: error instanceof Error ? error.message : String(error),
      setName,
      step,
      contentLength: content.length
    });
    throw error;
  }
}

/**
 * Gets all records for a specific test set, ordered by creation time
 *
 * • Retrieves all pipeline records for a given set_name
 * • Orders by created_at to show progression through pipeline steps
 * • Used for debugging and analyzing pipeline results
 */
export async function getTestingPipelineRecords(
  setName: string
): Promise<TestingPipelineRecord[]> {
  try {
    const { data, error } = await supabase
      .from('testing_edits_pipeline')
      .select('*')
      .eq('set_name', setName)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('Error fetching testing pipeline records:', {
        error: error.message,
        setName
      });
      throw error;
    }

    return data || [];
  } catch (error) {
    logger.error('Unexpected error in getTestingPipelineRecords:', {
      error: error instanceof Error ? error.message : String(error),
      setName
    });
    throw error;
  }
}