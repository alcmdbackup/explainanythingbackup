/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSupabaseServerClient } from '../utils/supabase/server';
import { logger } from '../client_utilities';

export interface TestingPipelineRecord {
  id?: number;
  set_name: string;
  step: string;
  content: string;
  session_id?: string;
  explanation_id?: number;
  explanation_title?: string;
  user_prompt?: string;
  source_content?: string;
  session_metadata?: any;
  created_at?: string;
  updated_at?: string;
}

export interface TestingPipelineInsert {
  set_name: string;
  step: string;
  content: string;
  session_id?: string;
  explanation_id?: number;
  explanation_title?: string;
  user_prompt?: string;
  source_content?: string;
  session_metadata?: any;
}

export interface SessionData {
  session_id: string;
  explanation_id: number;
  explanation_title: string;
  user_prompt: string;
  source_content: string;
  session_metadata?: any;
}

/**
 * Checks if an exact match exists in the testing pipeline table
 *
 * • Searches for records with matching name, step, and content
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

    const supabase = await createSupabaseServerClient();
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
 * • Inserts a new record with set_name, step, content, and optional session data
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
      contentLength: record.content.length,
      hasSessionData: !!record.session_id
    });

    const insertData: any = {
      set_name: record.set_name,
      step: record.step,
      content: record.content
    };

    // Add session fields if provided
    if (record.session_id) {
      insertData.session_id = record.session_id;
      insertData.explanation_id = record.explanation_id;
      insertData.explanation_title = record.explanation_title;
      insertData.user_prompt = record.user_prompt;
      insertData.source_content = record.source_content;
      insertData.session_metadata = record.session_metadata;
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('testing_edits_pipeline')
      .insert(insertData)
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
        contentLength: record.content.length,
        hasSessionData: !!record.session_id
      });
      throw error;
    }

    logger.debug('Testing pipeline record saved successfully:', {
      id: data.id,
      setName: data.set_name,
      step: data.step,
      contentLength: data.content.length,
      sessionId: data.session_id
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
 * • Supports both legacy setName usage and new session data
 * • Returns boolean indicating if a save was performed
 * • Used by the main pipeline function to avoid duplicates
 */
export async function checkAndSaveTestingPipelineRecord(
  setName: string,
  step: string,
  content: string,
  sessionData?: SessionData
): Promise<{ saved: boolean; record?: TestingPipelineRecord }> {
  logger.debug('checkAndSaveTestingPipelineRecord called', {
    setName,
    step,
    contentLength: content.length,
    hasSessionData: !!sessionData,
    sessionId: sessionData?.session_id
  });

  try {
    // Check if exact match already exists
    const exists = await checkTestingPipelineExists(setName, step, content);
    logger.debug('Record exists check result', { exists, setName, step });

    if (exists) {
      logger.debug('Testing pipeline record already exists, skipping save', {
        setName,
        step,
        contentLength: content.length,
        hasSessionData: !!sessionData
      });
      return { saved: false };
    }

    // Prepare record data
    const recordData: TestingPipelineInsert = {
      set_name: setName,
      step: step,
      content: content
    };

    // Add session data if provided
    if (sessionData) {
      recordData.session_id = sessionData.session_id;
      recordData.explanation_id = sessionData.explanation_id;
      recordData.explanation_title = sessionData.explanation_title;
      recordData.user_prompt = sessionData.user_prompt;
      recordData.source_content = sessionData.source_content;
      recordData.session_metadata = sessionData.session_metadata;
    }

    // Save new record
    const record = await saveTestingPipelineRecord(recordData);

    logger.debug('New testing pipeline record saved', {
      id: record.id,
      setName: record.set_name,
      step: record.step,
      contentLength: record.content.length,
      sessionId: record.session_id
    });

    return { saved: true, record };
  } catch (error) {
    logger.error('Error in checkAndSaveTestingPipelineRecord', {
      error: error instanceof Error ? error.message : String(error),
      setName,
      step,
      contentLength: content.length,
      hasSessionData: !!sessionData
    });
    throw error;
  }
}

/**
 * Updates the name for a specific testing pipeline record
 *
 * • Updates a single record's name field by ID
 * • Returns the updated record with new name
 * • Used for renaming test sets from the UI
 */
export async function updateTestingPipelineRecordSetName(
  recordId: number,
  newSetName: string
): Promise<TestingPipelineRecord> {
  try {
    logger.debug('Updating testing pipeline record set name:', {
      recordId,
      newSetName
    });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('testing_edits_pipeline')
      .update({ set_name: newSetName })
      .eq('id', recordId)
      .select()
      .single();

    if (error) {
      logger.error('Supabase error updating testing pipeline record set name:', {
        error: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
        recordId,
        newSetName
      });
      throw error;
    }

    logger.debug('Testing pipeline record set name updated successfully:', {
      id: data.id,
      oldSetName: data.set_name,
      newSetName: newSetName
    });

    return data;
  } catch (error) {
    logger.error('Unexpected error in updateTestingPipelineRecordSetName:', {
      error: error instanceof Error ? error.message : String(error),
      recordId,
      newSetName
    });
    throw error;
  }
}

/**
 * Gets all records for a specific test set, ordered by creation time
 *
 * • Retrieves all pipeline records for a given name
 * • Orders by created_at to show progression through pipeline steps
 * • Used for debugging and analyzing pipeline results
 */
export async function getTestingPipelineRecords(
  setName: string
): Promise<TestingPipelineRecord[]> {
  try {
    const supabase = await createSupabaseServerClient();
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