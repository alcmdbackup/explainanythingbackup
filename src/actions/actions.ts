'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations.server';
import { explanationInsertSchema, explanationBaseType, explanationBaseSchema, type ExplanationInsertType, type UserQueryDataType, type QueryResponseType, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';
import { createUserQuery, getUserQueryById } from '@/lib/services/userQueries';
import { userQueryInsertSchema, matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findMatches, enhanceMatchesWithCurrentContent } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { getExplanationById, getRecentExplanations } from '@/lib/services/explanations.server';
import { saveExplanationToLibrary, isExplanationSavedByUser, getUserLibraryExplanations } from '@/lib/services/userLibrary';

const FILE_DEBUG = true;

// Constants for better maintainability
const MIN_SIMILARITY_INDEX = 0;
const CONTENT_FORMAT_TEMPLATE = '# {title}\n\n{content}';

/**
 * Key points:
 * - Main function for generating AI explanations
 * - Handles both matching and new explanation generation
 * - Uses vector search and LLM for content creation
 * - Generates article titles using the original user query (not enhanced)
 * - Uses the first generated title for vector search (handleUserQuery)
 * - Automatically saves new explanations to database with embeddings
 * - Returns explanation ID for both new and matched explanations
 * - Uses handleUserQuery, enhanceMatchesWithCurrentContent, findMatchingSource, saveExplanationAndTopic
 */
export const generateExplanation = withLogging(
    async function generateExplanation(
        userQuery: string,
        savedId: number | null,
        matchMode: MatchMode,
        userid: string
    ): Promise<{
        originalUserQuery: string,
        match_found: Boolean | null,
        error: ErrorResponse | null,
        explanationId: number | null,
        matches: matchWithCurrentContentType[],
        data: explanationBaseType | null,
        userQueryId: number | null
    }> {
        try {
            if (!userQuery.trim()) {
                return {
                    originalUserQuery: userQuery,
                    match_found: null,
                    error: createInputError('userQuery cannot be empty'),
                    explanationId: null,
                    matches: [],
                    data: null,
                    userQueryId: null
                };
            }

            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callGPT4omini(titlePrompt, titleQuerySchema, 'titleQuery');
            const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));

            if (!parsedTitles.success || !parsedTitles.data.title1) {
                return {
                    originalUserQuery: userQuery,
                    match_found: null,
                    error: createError(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH, 'No valid title1 found for vector search. Cannot proceed.'),
                    explanationId: null,
                    matches: [],
                    data: null,
                    userQueryId: null
                };
            }
            
            const firstTitle = parsedTitles.data.title1;
            const similarTexts = await findMatchesInVectorDb(firstTitle);
            const matches = await enhanceMatchesWithCurrentContent(similarTexts);
            const bestSourceResult = await findMatches(firstTitle, matches, matchMode, savedId);
            const shouldReturnMatch = (matchMode === MatchMode.Normal || matchMode === MatchMode.ForceMatch) && 
                bestSourceResult.selectedIndex && 
                bestSourceResult.selectedIndex > MIN_SIMILARITY_INDEX && 
                bestSourceResult.explanationId !== null && 
                bestSourceResult.topicId !== null;

            let finalExplanationId: number | null = null;
            let explanationData: explanationBaseType | null = null;
            let isMatchFound = false;

            if (shouldReturnMatch) {
                finalExplanationId = bestSourceResult.explanationId;
                isMatchFound = true;
            } else {
                const formattedPrompt = createExplanationPrompt(firstTitle);
                const result = await callGPT4omini(formattedPrompt, explanationBaseSchema, 'llmQuery');
                
                const parsedResult = explanationBaseSchema.safeParse(JSON.parse(result));

                if (!parsedResult.success) {
                    return {
                        originalUserQuery: userQuery,
                        match_found: null,
                        error: createValidationError('AI response did not match expected format', parsedResult.error),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null
                    };
                }

                const newExplanationData = {
                    explanation_title: firstTitle,
                    content: parsedResult.data.content,
                };
                
                const validatedUserQuery = explanationBaseSchema.safeParse(newExplanationData);
                
                if (!validatedUserQuery.success) {
                    return {
                        originalUserQuery: userQuery,
                        match_found: null,
                        error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null
                    };
                }

                const { error: explanationTopicError, id: newExplanationId } = await saveExplanationAndTopic(userQuery, validatedUserQuery.data);
                
                if (explanationTopicError) {
                    return {
                        originalUserQuery: userQuery,
                        match_found: null,
                        error: explanationTopicError,
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null
                    };
                }

                if (newExplanationId == null) {
                    return {
                        originalUserQuery: userQuery,
                        match_found: null,
                        error: createError(ERROR_CODES.SAVE_FAILED, 'Failed to save explanation: missing explanation ID.'),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null
                    };
                }

                finalExplanationId = newExplanationId;
                explanationData = newExplanationData;
            }

            // Save user query once - works for both match and new explanation cases
            let userQueryId: number | null = null;
            if (finalExplanationId && userid) {
                const userQueryData: UserQueryDataType = {
                    user_query: userQuery,
                    matches: matches
                };
                
                const { error: userQueryError, id: savedUserQueryId } = await saveUserQuery(userQueryData, finalExplanationId, userid, !isMatchFound);
                if (userQueryError) {
                    logger.error('Failed to save user query:', { error: userQueryError });
                } else {
                    userQueryId = savedUserQueryId;
                }
            }

            return {
                originalUserQuery: userQuery,
                match_found: isMatchFound,
                error: null,
                explanationId: finalExplanationId,
                matches: matches,
                data: explanationData,
                userQueryId: userQueryId
            };
        } catch (error) {
            return {
                originalUserQuery: userQuery,
                match_found: null,
                error: handleError(error, 'generateExplanation', { userQuery, matchMode, savedId, userid }),
                explanationId: null,
                matches: [],
                data: null,
                userQueryId: null
            };
        }
    },
    'generateExplanation',
    { 
        enabled: FILE_DEBUG,
        maxInputLength: 500,
        maxOutputLength: 1000,
        sensitiveFields: ['apiKey', 'token']
    }
);

/**
 * Key points:
 * - Saves new explanations and topics to database
 * - Creates embeddings for vector search
 * - Called internally by generateExplanation for new content
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
            logger.debug('Error in saveExplanationAndTopic', { error, userQuery, explanationTitle: explanationData.explanation_title }, FILE_DEBUG);
            return {
                success: false,
                error: handleError(error, 'saveExplanationAndTopic', { userQuery, explanationTitle: explanationData.explanation_title }),
                id: null
            };
        }
    },
    'saveExplanationAndTopic',
    { 
        enabled: FILE_DEBUG,
        maxInputLength: 300,
        maxOutputLength: 500
    }
);

/**
 * Key points:
 * - Saves user queries to database
 * - Validates query data against schema
 * - Called by generateExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export const saveUserQuery = withLogging(
    async function saveUserQuery(userQuery: UserQueryDataType, explanationId: number, userid: string, newExplanation: boolean) {
        logger.debug('saveUserQuery started', { userQuery: userQuery.user_query, explanationId, userid, newExplanation }, FILE_DEBUG);
        
        try {
            logger.debug('Preparing user query with explanation ID, userid, and newExplanation', { userQuery, explanationId, userid, newExplanation }, FILE_DEBUG);
            const userQueryWithId = { ...userQuery, explanation_id: explanationId, userid, newExplanation };
            
            logger.debug('Validating user query data', { userQueryWithId }, FILE_DEBUG);
            const validatedData = userQueryInsertSchema.safeParse(userQueryWithId);

            if (!validatedData.success) {
                logger.debug('Validation failed', { errors: validatedData.error }, FILE_DEBUG);
                return {
                    success: false,
                    error: createValidationError('Invalid user query data format', validatedData.error),
                    id: null
                };
            }

            logger.debug('Validation successful, creating user query', { validatedData: validatedData.data }, FILE_DEBUG);
            const savedQuery = await createUserQuery(validatedData.data);
            
            logger.debug('User query saved successfully', { savedQueryId: savedQuery.id }, FILE_DEBUG);
            return { 
                success: true, 
                error: null,
                id: savedQuery.id 
            };
        } catch (error) {
            logger.debug('Error in saveUserQuery', { error, userQuery: userQuery.user_query }, FILE_DEBUG);
            return {
                success: false,
                error: handleError(error, 'saveUserQuery', { userQuery: userQuery.user_query}),
                id: null
            };
        }
    },
    'saveUserQuery',
    { 
        enabled: FILE_DEBUG,
        maxInputLength: 200,
        maxOutputLength: 100
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