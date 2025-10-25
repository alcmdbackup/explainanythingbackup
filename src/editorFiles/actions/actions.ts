'use server';

import { callOpenAIModel, default_model, lighter_model } from '@/lib/services/llms';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/logging/functionLogger';
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
                default_model,
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
                lighter_model,
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

/**
 * Server action wrapper for AI suggestions pipeline (server action)
 *
 * • Wraps getAndApplyAISuggestions to make it callable from client components
 * • Runs the complete 4-step AI suggestions pipeline
 * • Handles progress tracking and session data management
 * • Returns final processed content ready for editor
 * • Used by: AISuggestionsPanel and other client components
 * • Calls: getAndApplyAISuggestions from aiSuggestion.ts
 */
export const runAISuggestionsPipelineAction = withLogging(
    async function runAISuggestionsPipelineAction(
        currentContent: string,
        userPrompt: string,
        sessionData?: {
            explanation_id: number;
            explanation_title: string;
        }
    ): Promise<{
        success: boolean;
        content?: string;
        error?: string;
        session_id?: string;
    }> {
        try {
            // Import the function here to avoid client-side import issues
            const { getAndApplyAISuggestions } = await import('../aiSuggestion');

            // Prepare session data with user prompt
            const sessionRequestData = sessionData ? {
                explanation_id: sessionData.explanation_id,
                explanation_title: sessionData.explanation_title,
                user_prompt: userPrompt.trim()
            } : undefined;

            logger.debug('🎭 runAISuggestionsPipelineAction: Starting pipeline', {
                hasSessionData: !!sessionRequestData,
                contentLength: currentContent.length,
                userPrompt: userPrompt.trim()
            }, FILE_DEBUG);

            // Run the pipeline (progress callback not supported in server actions)
            const result = await getAndApplyAISuggestions(
                currentContent,
                null, // editorRef not needed for server action
                undefined, // onProgress callback not supported
                sessionRequestData
            );

            logger.debug('🎭 runAISuggestionsPipelineAction: Pipeline result', {
                success: result.success,
                hasContent: !!result.content,
                session_id: result.session_id
            }, FILE_DEBUG);

            return result;
        } catch (error) {
            logger.error('runAISuggestionsPipelineAction Error', {
                error: error instanceof Error ? error.message : String(error),
                contentLength: currentContent.length,
                userPrompt: userPrompt?.substring(0, 100)
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : 'AI suggestions pipeline failed',
                content: currentContent // Return original content on failure
            };
        }
    },
    'runAISuggestionsPipelineAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Server action wrapper for merging AI suggestion output (server action)
 *
 * • Wraps mergeAISuggestionOutput to make it callable from client components
 * • Combines alternating content and markers into readable format
 * • Used by: Client components that need to merge AI suggestion arrays
 * • Calls: mergeAISuggestionOutput from aiSuggestion.ts
 */
export const mergeAISuggestionOutputAction = withLogging(
    async function mergeAISuggestionOutputAction(
        edits: string[]
    ): Promise<{
        success: boolean;
        data: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            // Import the function here to avoid client-side import issues
            const { mergeAISuggestionOutput } = await import('../aiSuggestion');

            const output = { edits };
            const result = mergeAISuggestionOutput(output);

            return {
                success: true,
                data: result,
                error: null
            };
        } catch (error) {
            logger.error('mergeAISuggestionOutputAction Error', {
                error: error instanceof Error ? error.message : String(error),
                editsCount: edits?.length || 0
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'mergeAISuggestionOutputAction', { editsCount: edits?.length || 0 })
            };
        }
    },
    'mergeAISuggestionOutputAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Server action wrapper for validating AI suggestion output (server action)
 *
 * • Wraps validateAISuggestionOutput to make it callable from client components
 * • Validates AI suggestion output against schema
 * • Returns typed result or validation errors
 * • Used by: Client components that need to validate AI suggestion format
 * • Calls: validateAISuggestionOutput from aiSuggestion.ts
 */
export const validateAISuggestionOutputAction = withLogging(
    async function validateAISuggestionOutputAction(
        rawOutput: string
    ): Promise<{
        success: boolean;
        data: { success: boolean; data?: any; error?: any } | null;
        error: ErrorResponse | null;
    }> {
        try {
            // Import the function here to avoid client-side import issues
            const { validateAISuggestionOutput } = await import('../aiSuggestion');

            const result = validateAISuggestionOutput(rawOutput);

            return {
                success: true,
                data: result,
                error: null
            };
        } catch (error) {
            logger.error('validateAISuggestionOutputAction Error', {
                error: error instanceof Error ? error.message : String(error),
                rawOutputLength: rawOutput?.length || 0
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'validateAISuggestionOutputAction', { rawOutputLength: rawOutput?.length || 0 })
            };
        }
    },
    'validateAISuggestionOutputAction',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Server action wrapper for the complete AI suggestions pipeline (server action)
 *
 * • Wraps getAndApplyAISuggestions to make it callable from client components
 * • Runs the complete 4-step AI suggestions pipeline with progress tracking
 * • Handles session data management and editor ref
 * • Used by: Client components that need the full AI suggestions pipeline
 * • Calls: getAndApplyAISuggestions from aiSuggestion.ts
 */
export const getAndApplyAISuggestionsAction = withLogging(
    async function getAndApplyAISuggestionsAction(
        currentContent: string,
        progressCallback: boolean = false,
        sessionData?: {
            session_id?: string;
            explanation_id: number;
            explanation_title: string;
            user_prompt: string;
        }
    ): Promise<{
        success: boolean;
        content?: string;
        error?: string;
        session_id?: string;
    }> {
        try {
            // Import the function here to avoid client-side import issues
            const { getAndApplyAISuggestions } = await import('../aiSuggestion');

            logger.debug('🎭 getAndApplyAISuggestionsAction: Starting pipeline', {
                hasSessionData: !!sessionData,
                contentLength: currentContent.length,
                progressCallback
            }, FILE_DEBUG);

            // Progress callback function for server action (simplified)
            const onProgress = progressCallback ? (step: string, progress: number) => {
                logger.debug(`Pipeline progress: ${step} (${progress}%)`, {}, FILE_DEBUG);
            } : undefined;

            // Run the pipeline
            const result = await getAndApplyAISuggestions(
                currentContent,
                null, // editorRef not needed for server action
                onProgress,
                sessionData
            );

            logger.debug('🎭 getAndApplyAISuggestionsAction: Pipeline result', {
                success: result.success,
                hasContent: !!result.content,
                session_id: result.session_id
            }, FILE_DEBUG);

            return result;
        } catch (error) {
            logger.error('getAndApplyAISuggestionsAction Error', {
                error: error instanceof Error ? error.message : String(error),
                contentLength: currentContent.length
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : 'AI suggestions pipeline failed',
                content: currentContent // Return original content on failure
            };
        }
    },
    'getAndApplyAISuggestionsAction',
    {
        enabled: FILE_DEBUG
    }
);