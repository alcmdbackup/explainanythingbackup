'use server';

import { callOpenAIModel } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, explanationBaseType, explanationBaseSchema, type ExplanationInsertType, MatchMode, UserInputType, type UserExplanationEventsType, type ExplanationMetricsType } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding, findMatchesInVectorDb, loadFromPineconeUsingExplanationId } from '@/lib/services/vectorsim';
import { createUserQuery, getUserQueryById } from '@/lib/services/userQueries';
import { userQueryInsertSchema, matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findBestMatchFromList, enhanceMatchesWithCurrentContentAndDiversity } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging, withLoggingAndTracing } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { getExplanationById, getRecentExplanations } from '@/lib/services/explanations';
import { saveExplanationToLibrary, isExplanationSavedByUser, getUserLibraryExplanations } from '@/lib/services/userLibrary';
import { createMappingsHeadingsToLinks, createMappingsKeytermsToLinks, cleanupAfterEnhancements } from '@/lib/services/links';
import { 
  createUserExplanationEvent, 
  getMultipleExplanationMetrics, 
  refreshExplanationMetrics
} from '@/lib/services/metrics';
import { createTags, getTagsById, updateTag, deleteTag, getTagsByPresetId, getAllTags, getTempTagsForRewriteWithTags } from '@/lib/services/tags';
import { addTagsToExplanation, removeTagsFromExplanation, getTagsForExplanation } from '@/lib/services/explanationTags';
import { type TagInsertType, type TagFullDbType, type ExplanationTagFullDbType, type TagUIType } from '@/lib/schemas/schemas';
import { createAISuggestionPrompt, createApplyEditsPrompt, aiSuggestionSchema } from '../editorFiles/aiSuggestion';
import { checkAndSaveTestingPipelineRecord } from '../lib/services/testingPipeline';


const FILE_DEBUG = true;

// Constants for better maintainability
const MIN_SIMILARITY_INDEX = 0;
const CONTENT_FORMAT_TEMPLATE = '# {title}\n\n{content}';




/**
 * Key points:
 * - Saves new explanations and topics to database
 * - Creates embeddings for vector search
 * - Called internally by returnExplanation for new content
 * - Uses createTopic, createExplanation, processContentToStoreEmbedding
 */
export const saveExplanationAndTopic = withLogging(
    async function saveExplanationAndTopic(userQuery: string, explanationData: explanationBaseType) {
        try {
            const topic = await createTopic({
                topic_title: explanationData.explanation_title
            });

            const explanationWithTopic: ExplanationInsertType = {
                explanation_title: explanationData.explanation_title,
                content: explanationData.content,
                primary_topic_id: topic.id
            };

            const validatedData = explanationInsertSchema.safeParse(explanationWithTopic);

            if (!validatedData.success) {
                return {
                    success: false,
                    error: createValidationError('Invalid explanation data format', validatedData.error),
                    id: null
                };
            }

            const savedExplanation = await createExplanation(validatedData.data);

            const combinedContent = CONTENT_FORMAT_TEMPLATE
                .replace('{title}', explanationData.explanation_title)
                .replace('{content}', explanationData.content);
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id, topic.id);
            
            return { 
                success: true, 
                error: null,
                id: savedExplanation.id 
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'saveExplanationAndTopic', { userQuery, explanationTitle: explanationData.explanation_title }),
                id: null
            };
        }
    },
    'saveExplanationAndTopic',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Key points:
 * - Saves user queries to database with userInputType tracking
 * - Validates query data against schema including userInputType
 * - Called by returnExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export const saveUserQuery = withLogging(
    async function saveUserQuery(userInput, matches, explanationId: number | null, userid: string, newExplanation: boolean, userInputType: UserInputType, allowedQuery: boolean, previousExplanationViewedId: number | null) {
        
        try {
            // Add debug logging for rewrite operations
            if (userInputType === UserInputType.Rewrite) {
                logger.debug('saveUserQuery called for REWRITE operation', {
                    userInput,
                    matches_count: matches?.length || 0,
                    explanationId,
                    userid,
                    newExplanation,
                    userInputType,
                    allowedQuery,
                    previousExplanationViewedId,
                    matches_with_diversity: matches?.map((match: any) => ({
                        explanation_id: match.explanation_id,
                        ranking: match.ranking,
                        diversity_score: match.ranking?.diversity_score
                    })) || []
                }, FILE_DEBUG);
            }

            const userQueryWithId = { user_query: userInput, matches, explanation_id: explanationId, userid, newExplanation, userInputType, allowedQuery, previousExplanationViewedId };
            
            const validatedData = userQueryInsertSchema.safeParse(userQueryWithId);

            if (!validatedData.success) {
                return {
                    success: false,
                    error: createValidationError('Invalid user query data format', validatedData.error),
                    id: null
                };
            }

            const savedQuery = await createUserQuery(validatedData.data);
            
            return { 
                success: true, 
                error: null,
                id: savedQuery.id 
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'saveUserQuery', { userInput}),
                id: null
            };
        }
    },
    'saveUserQuery',
    { 
        enabled: FILE_DEBUG
    }
); 

/**
 * Fetches a single explanation by its ID (server action)
 *
 * • Calls getExplanationById service to fetch explanation from database
 * • Throws error if explanation is not found
 * • Used by client code to fetch explanation details via server action
 * • Calls: getExplanationById
 * • Used by: ResultsPage, other client components
 */
export async function getExplanationByIdAction(id: number) {
    return await getExplanationById(id);
}

/**
 * Saves an explanation to the user's library (server action)
 *
 * • Calls saveExplanationToLibrary service to insert a record for the user and explanation
 * • Throws error if the insert fails
 * • Used by client code to save explanations via server action
 * • Calls: saveExplanationToLibrary
 * • Used by: ResultsPage, other client components
 */
export async function saveExplanationToLibraryAction(explanationid: number, userid: string) {
    return await saveExplanationToLibrary(explanationid, userid);
}

/**
 * Checks if an explanation is saved by the user (server action)
 *
 * • Calls isExplanationSavedByUser service to check for a user/explanation record
 * • Returns true if found, false otherwise
 * • Used by client code to check save status via server action
 * • Calls: isExplanationSavedByUser
 * • Used by: ResultsPage, other client components
 */
export async function isExplanationSavedByUserAction(explanationid: number, userid: string) {
    return await isExplanationSavedByUser(explanationid, userid);
} 

/**
 * Fetches recent explanations with pagination (server action)
 *
 * • Calls getRecentExplanations service to fetch recent explanations from database
 * • Supports limit, offset, orderBy, and order parameters
 * • Used by client code to fetch lists of explanations via server action
 * • Calls: getRecentExplanations
 * • Used by: ExplanationsPage, other client components
 */
export async function getRecentExplanationsAction(limit?: number, offset?: number, orderBy?: string, order?: 'asc' | 'desc') {
    return await getRecentExplanations(limit, offset, orderBy, order);
} 

/**
 * Fetches all explanations saved in a user's library (server action)
 *
 * • Calls getUserLibraryExplanations service to fetch explanations for a user
 * • Throws error if the fetch fails
 * • Used by client code to fetch user library explanations via server action
 * • Calls: getUserLibraryExplanations
 * • Used by: UserLibraryPage, other client components
 */
export async function getUserLibraryExplanationsAction(userid: string) {
    return await getUserLibraryExplanations(userid);
}

/**
 * Fetches a user query by its ID (server action)
 *
 * • Calls getUserQueryById service to fetch user query from database
 * • Throws error if user query is not found
 * • Used by client code to fetch user query details via server action
 * • Calls: getUserQueryById
 * • Used by: ResultsPage, other client components
 */
export async function getUserQueryByIdAction(id: number) {
    return await getUserQueryById(id);
}

/**
 * Creates a user explanation event record (server action)
 *
 * • Calls createUserExplanationEvent service to track user interactions with explanations
 * • Validates event data against schema before database insertion
 * • Returns the created event record with database-generated fields
 * • Used by client code to track user analytics via server action
 * • Calls: createUserExplanationEvent
 * • Used by: Analytics tracking, user interaction components
 */
export async function createUserExplanationEventAction(eventData: UserExplanationEventsType): Promise<UserExplanationEventsType> {
    return await createUserExplanationEvent(eventData);
}

/**
 * Creates tags in bulk, skipping duplicates (server action)
 *
 * • Validates input data against tagInsertSchema before processing
 * • Creates multiple tags efficiently, skipping existing ones
 * • Returns array of all tag records (existing + newly created)
 * • Used by tag management interfaces and bulk import operations
 * • Calls: createTags
 * • Used by: Tag management components, admin interfaces
 */
export const createTagsAction = withLogging(
    async function createTagsAction(tags: TagInsertType[]): Promise<{
        success: boolean;
        data: TagFullDbType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const createdTags = await createTags(tags);
            
            return {
                success: true,
                data: createdTags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'createTagsAction', { tagCount: tags.length })
            };
        }
    },
    'createTagsAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Fetches a tag record by ID (server action)
 *
 * • Calls getTagsById service to fetch tag from database
 * • Returns tag data if found, null if not found
 * • Used by client code to fetch tag details via server action
 * • Calls: getTagsById
 * • Used by: Tag editing components, tag display interfaces
 */
export const getTagByIdAction = withLogging(
    async function getTagByIdAction(id: number): Promise<{
        success: boolean;
        data: TagFullDbType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getTagsById([id]);
            const tag = tags.length > 0 ? tags[0] : null;
            
            return {
                success: true,
                data: tag,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getTagByIdAction', { tagId: id })
            };
        }
    },
    'getTagByIdAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Updates an existing tag record (server action)
 *
 * • Validates partial input data against tagInsertSchema before processing
 * • Updates tag record with provided partial data
 * • Returns updated tag record with all fields
 * • Used by tag editing and management operations
 * • Calls: updateTag
 * • Used by: Tag editing components, admin interfaces
 */
export const updateTagAction = withLogging(
    async function updateTagAction(id: number, updates: Partial<TagInsertType>): Promise<{
        success: boolean;
        data: TagFullDbType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const updatedTag = await updateTag(id, updates);
            
            return {
                success: true,
                data: updatedTag,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'updateTagAction', { tagId: id, updates })
            };
        }
    },
    'updateTagAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Deletes a tag record (server action)
 *
 * • Removes tag record from database by ID
 * • Cascade deletion will also remove explanation_tags relationships
 * • Used by tag management and cleanup operations
 * • Calls: deleteTag
 * • Used by: Tag management components, admin interfaces
 */
export const deleteTagAction = withLogging(
    async function deleteTagAction(id: number): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await deleteTag(id);
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'deleteTagAction', { tagId: id })
            };
        }
    },
    'deleteTagAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Adds tags to an explanation (server action)
 *
 * • Validates input data against explanationTagInsertSchema before processing
 * • Creates explanation-tag relationships in a single transaction
 * • Returns array of created relationship records
 * • Used by tag assignment operations (single or multiple)
 * • Calls: addTagsToExplanation
 * • Used by: Tag management components, explanation editing interfaces
 */
export const addTagsToExplanationAction = withLogging(
    async function addTagsToExplanationAction(
        explanationId: number,
        tagIds: number[]
    ): Promise<{
        success: boolean;
        data: ExplanationTagFullDbType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const relationships = await addTagsToExplanation(explanationId, tagIds);
            
            return {
                success: true,
                data: relationships,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'addTagsToExplanationAction', { 
                    explanationId, 
                    tagIds, 
                    tagCount: tagIds.length 
                })
            };
        }
    },
    'addTagsToExplanationAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Removes specific tags from an explanation (server action)
 *
 * • Removes multiple explanation-tag relationships by tag IDs
 * • Safe operation that won't fail if relationships don't exist
 * • Used by tag removal operations (single or multiple)
 * • Calls: removeTagsFromExplanation
 * • Used by: Tag management components, explanation editing interfaces
 */
export const removeTagsFromExplanationAction = withLogging(
    async function removeTagsFromExplanationAction(
        explanationId: number,
        tagIds: number[]
    ): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await removeTagsFromExplanation(explanationId, tagIds);
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'removeTagsFromExplanationAction', { 
                    explanationId, 
                    tagIds,
                    tagCount: tagIds.length 
                })
            };
        }
    },
    'removeTagsFromExplanationAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Gets all tags for a specific explanation (server action)
 *
 * • Retrieves all tags associated with an explanation via junction table
 * • Returns array of full tag records with tag details
 * • Used by explanation display and editing interfaces
 * • Calls: getTagsForExplanation
 * • Used by: Explanation view components, tag display interfaces
 */
export const getTagsForExplanationAction = withLogging(
    async function getTagsForExplanationAction(explanationId: number): Promise<{
        success: boolean;
        data: TagUIType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getTagsForExplanation(explanationId);
            
            return {
                success: true,
                data: tags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getTagsForExplanationAction', { explanationId })
            };
        }
    },
    'getTagsForExplanationAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Gets all tags with the specified preset tag IDs (server action)
 *
 * • Retrieves all tags that share any of the provided preset tag IDs
 * • Returns array of tags ordered by name for consistent results
 * • Used by tag dropdown functionality in UI components
 * • Calls: getTagsByPresetId
 * • Used by: TagBar component for preset tag dropdowns
 */
export const getTagsByPresetIdAction = withLogging(
    async function getTagsByPresetIdAction(presetTagIds: number[]): Promise<{
        success: boolean;
        data: TagFullDbType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getTagsByPresetId(presetTagIds);
            
            return {
                success: true,
                data: tags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getTagsByPresetIdAction', { presetTagIds })
            };
        }
    },
    'getTagsByPresetIdAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Get all available tags
 * • Retrieves all tags from the database ordered by name
 * • Returns array of all available tags for selection
 * • Used by tag selection interfaces and add tag functionality
 * • Calls getAllTags service function
 */
export const getAllTagsAction = withLogging(
    async function getAllTagsAction(): Promise<{
        success: boolean;
        data: TagFullDbType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getAllTags();
            return {
                success: true,
                data: tags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getAllTagsAction', {})
            };
        }
    },
    'getAllTagsAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Gets temporary tags for "rewrite with tags" functionality (server action)
 * 
 * • Retrieves two specific preset tags: "medium" (ID 2) and "moderate" (ID 5)
 * • Returns tags with both tag_active_current and tag_active_initial set to true
 * • Used by "rewrite with tags" functionality to start with minimal preset tags
 * • Calls getTempTagsForRewriteWithTags service function
 */
export const getTempTagsForRewriteWithTagsAction = withLogging(
    async function getTempTagsForRewriteWithTagsAction(): Promise<{
        success: boolean;
        data: TagUIType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getTempTagsForRewriteWithTags();
            return {
                success: true,
                data: tags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getTempTagsForRewriteWithTagsAction', {})
            };
        }
    },
    'getTempTagsForRewriteWithTagsAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * === AGGREGATE METRICS ACTION FUNCTIONS ===
 * Server actions for accessing explanation aggregate metrics
 */

/**
 * Gets aggregate metrics for a specific explanation (server action)
 *
 * • Returns cached metrics from explanationMetrics table
 * • Uses getMultipleExplanationMetrics with single ID for consistency
 * • Returns null if explanation doesn't exist
 * • Calls: getMultipleExplanationMetrics
 * • Used by: UI components displaying explanation performance data
 */
export async function getExplanationMetricsAction(explanationId: number): Promise<ExplanationMetricsType | null> {
    const results = await getMultipleExplanationMetrics([explanationId]);
    return results[0];
}

/**
 * Gets aggregate metrics for multiple explanations (server action)
 *
 * • Efficiently fetches metrics for multiple explanations
 * • Returns metrics in same order as input IDs
 * • Missing explanations return null in the corresponding position
 * • Calls: getMultipleExplanationMetrics
 * • Used by: List views, dashboard components showing multiple explanation stats
 */
export async function getMultipleExplanationMetricsAction(explanationIds: number[]): Promise<(ExplanationMetricsType | null)[]> {
    return await getMultipleExplanationMetrics(explanationIds);
}

/**
 * Refreshes aggregate metrics for specific explanations or all explanations (server action)
 *
 * • Recalculates total saves, views, and save rate using database stored procedures
 * • Updates explanationMetrics table with fresh data
 * • Returns updated metrics records and count of processed explanations
 * • Calls: refreshExplanationMetrics
 * • Used by: Admin interfaces, manual refresh operations, batch maintenance
 */
export const refreshExplanationMetricsAction = withLogging(
    async function refreshExplanationMetricsAction(options: {
        explanationIds?: number | number[];
        refreshAll?: boolean;
    } = {}): Promise<{
        success: boolean;
        data: {
            results: ExplanationMetricsType[];
            count: number;
        } | null;
        error: ErrorResponse | null;
    }> {
        try {
            const result = await refreshExplanationMetrics(options);
            
            return {
                success: true,
                data: result,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'refreshExplanationMetricsAction', options)
            };
        }
    },
    'refreshExplanationMetricsAction',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Loads a single vector from Pinecone based on explanation ID (server action)
 *
 * • Queries Pinecone using metadata filter for specific explanation_id
 * • Returns the first vector chunk associated with the explanation
 * • Used by results page to load explanation vector for comparison
 * • Calls: loadFromPineconeUsingExplanationId
 * • Used by: Results page for vector comparison and analysis
 */
export const loadFromPineconeUsingExplanationIdAction = withLogging(
    async function loadFromPineconeUsingExplanationIdAction(explanationId: number, namespace: string = 'default'): Promise<{
        success: boolean;
        data: any | null;
        error: ErrorResponse | null;
    }> {
        try {
            const vector = await loadFromPineconeUsingExplanationId(explanationId, namespace);
            
            logger.debug('Vector loading result:', {
                explanationId,
                namespace,
                found: !!vector,
                vectorType: vector ? typeof vector : 'null',
                valuesPreview: vector?.values ? vector.values.slice(0, 5) : null, // Preview of first 5 values
                valuesLength: vector?.values?.length || 0
            }, FILE_DEBUG);
            
            return {
                success: true,
                data: vector,
                error: null
            };
        } catch (error) {
            logger.error('Error in loadFromPineconeUsingExplanationIdAction:', {
                explanationId,
                namespace,
                error: error instanceof Error ? error.message : String(error),
                errorType: typeof error,
                errorKeys: error && typeof error === 'object' ? Object.keys(error) : []
            });
            
            return {
                success: false,
                data: null,
                error: handleError(error, 'loadFromPineconeUsingExplanationIdAction', { explanationId, namespace })
            };
        }
    },
    'loadFromPineconeUsingExplanationIdAction',
    { 
        enabled: FILE_DEBUG
    }
);

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

