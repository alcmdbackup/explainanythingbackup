'use server';

import { callOpenAIModel } from '@/lib/services/llms';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { createAISuggestionPrompt, createApplyEditsPrompt, aiSuggestionSchema } from '../../editorFiles/aiSuggestion';
import { checkAndSaveTestingPipelineRecord, updateTestingPipelineRecordSetName } from '../../lib/services/testingPipeline';
import { supabase } from '../../lib/supabase';

const FILE_DEBUG = true;

/**
 * Generates AI suggestions for text improvement (server action)
 *
 * • Creates a prompt using the provided text and improvement type
 * • Calls OpenAI model to generate editing suggestions
 * • Returns the AI response for text improvement
 * • Calls: createAISuggestionPrompt, callOpenAIModel
 * • Used by: Editor test pages for AI-powered text suggestions
 */
export const generateAISuggestionsAction = withLogging(
    async function generateAISuggestionsAction(
        currentText: string,
        userid: string
    ): Promise<{
        success: boolean;
        data: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const prompt = createAISuggestionPrompt(currentText);

            logger.debug('AI Suggestion Request', {
                textLength: currentText.length,
                promptLength: prompt.length,
                userid
            }, FILE_DEBUG);

            // Call OpenAI with structured output validation using the schema
            const response = await callOpenAIModel(
                prompt,
                'editor_ai_suggestions',
                userid,
                'gpt-4o-mini',
                false,
                null,
                aiSuggestionSchema,
                'aiSuggestion'
            );

            logger.debug('AI Suggestion Response', {
                responseLength: response.length,
                response: response
            }, FILE_DEBUG);

            return {
                success: true,
                data: response,
                error: null
            };
        } catch (error) {
            logger.error('AI Suggestion Error', {
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'generateAISuggestionsAction', { textLength: currentText.length })
            };
        }
    },
    'generateAISuggestionsAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Applies AI suggestions to the original content (server action)
 *
 * • Creates a prompt using createApplyEditsPrompt to apply AI suggestions
 * • Calls OpenAI model to generate the final edited text
 * • Returns the complete text with all edits applied
 * • Calls: createApplyEditsPrompt, callOpenAIModel
 * • Used by: Editor test pages to apply AI suggestions to content
 */
export const applyAISuggestionsAction = withLogging(
    async function applyAISuggestionsAction(
        aiSuggestions: string,
        originalContent: string,
        userid: string
    ): Promise<{
        success: boolean;
        data: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const prompt = createApplyEditsPrompt(aiSuggestions, originalContent);

            logger.debug('Apply AI Suggestions Request', {
                suggestionsLength: aiSuggestions.length,
                originalContentLength: originalContent.length,
                promptLength: prompt.length,
                userid
            }, FILE_DEBUG);

            const response = await callOpenAIModel(
                prompt,
                'editor_apply_suggestions',
                userid,
                'gpt-4o-mini',
                false,
                null
            );

            logger.debug('Apply AI Suggestions Response', {
                responseLength: response.length,
                response: response
            }, FILE_DEBUG);

            return {
                success: true,
                data: response,
                error: null
            };
        } catch (error) {
            logger.error('Apply AI Suggestions Error', {
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'applyAISuggestionsAction', {
                    suggestionsLength: aiSuggestions.length,
                    originalContentLength: originalContent.length
                })
            };
        }
    },
    'applyAISuggestionsAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Saves content to testing pipeline if it doesn't already exist (server action)
 *
 * • Checks if exact match exists in TESTING_edits_pipeline table
 * • Saves record only if no exact match found
 * • Returns boolean indicating if save was performed
 * • Calls: checkAndSaveTestingPipelineRecord from testingPipeline service
 * • Used by: Editor test pages to track pipeline results at each step
 */
export const saveTestingPipelineStepAction = withLogging(
    async function saveTestingPipelineStepAction(
        setName: string,
        step: string,
        content: string
    ): Promise<{
        success: boolean;
        data: { saved: boolean; recordId?: number } | null;
        error: ErrorResponse | null;
    }> {
        try {
            const result = await checkAndSaveTestingPipelineRecord(setName, step, content);

            return {
                success: true,
                data: {
                    saved: result.saved,
                    recordId: result.record?.id
                },
                error: null
            };
        } catch (error) {
            logger.error('Save Testing Pipeline Step Error', {
                error: error instanceof Error ? error.message : String(error),
                setName,
                step,
                contentLength: content.length
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'saveTestingPipelineStepAction', {
                    setName,
                    step,
                    contentLength: content.length
                })
            };
        }
    },
    'saveTestingPipelineStepAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Gets testing pipeline records by step (server action)
 *
 * • Retrieves all records from testing_edits_pipeline table for a specific step
 * • Orders by created_at to show most recent first
 * • Returns set_name, content, and metadata for dropdown selection
 * • Calls: getTestingPipelineRecords from testingPipeline service
 * • Used by: Editor test pages to populate dropdowns for loading previous results
 */
export const getTestingPipelineRecordsByStepAction = withLogging(
    async function getTestingPipelineRecordsByStepAction(
        step: string
    ): Promise<{
        success: boolean;
        data: Array<{ id: number; name: string; content: string; created_at: string }> | null;
        error: ErrorResponse | null;
    }> {
        try {
            // Get all records for this step from the database
            const { data, error } = await supabase
                .from('testing_edits_pipeline')
                .select('id, name, content, created_at')
                .eq('step', step)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Supabase error fetching testing pipeline records by step:', {
                    error: error.message,
                    errorCode: error.code,
                    step
                });
                throw error;
            }

            return {
                success: true,
                data: data || [],
                error: null
            };
        } catch (error) {
            logger.error('Get Testing Pipeline Records By Step Error', {
                error: error instanceof Error ? error.message : String(error),
                step
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'getTestingPipelineRecordsByStepAction', { step })
            };
        }
    },
    'getTestingPipelineRecordsByStepAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Updates the name for a testing pipeline record (server action)
 *
 * • Updates a single record's name field in testing_edits_pipeline table
 * • Returns success status and updated record data
 * • Calls: updateTestingPipelineRecordSetName from testingPipeline service
 * • Used by: Editor test pages to rename test sets from dropdown UI
 */
export const updateTestingPipelineRecordSetNameAction = withLogging(
    async function updateTestingPipelineRecordSetNameAction(
        recordId: number,
        newSetName: string
    ): Promise<{
        success: boolean;
        data: { id: number; name: string; step: string; content: string; created_at: string; updated_at: string } | null;
        error: ErrorResponse | null;
    }> {
        try {
            const updatedRecord = await updateTestingPipelineRecordSetName(recordId, newSetName);

            return {
                success: true,
                data: updatedRecord,
                error: null
            };
        } catch (error) {
            logger.error('Update Testing Pipeline Record Set Name Error', {
                error: error instanceof Error ? error.message : String(error),
                recordId,
                newSetName
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'updateTestingPipelineRecordSetNameAction', {
                    recordId,
                    newSetName
                })
            };
        }
    },
    'updateTestingPipelineRecordSetNameAction',
    {
        enabled: FILE_DEBUG
    }
);