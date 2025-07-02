'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, explanationBaseType, explanationBaseSchema, type ExplanationInsertType, type UserQueryDataType, type QueryResponseType, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema, matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findMatches, enhanceMatchesWithCurrentContent } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/functionLogger';

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
        matchMode: MatchMode
    ): Promise<{
        originalUserQuery: string,
        match_found: Boolean | null,
        error: ErrorResponse | null,
        explanationId: number | null,
        matches: matchWithCurrentContentType[],
        data: explanationBaseType | null
    }> {
        try {
            if (!userQuery.trim()) {
                return {
                    originalUserQuery: userQuery,
                    match_found: null,
                    error: createInputError('userQuery cannot be empty'),
                    explanationId: null,
                    matches: [],
                    data: null
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
                    data: null
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

            if (shouldReturnMatch) {
                return {
                    originalUserQuery: userQuery,
                    match_found: true,
                    error: null,
                    explanationId: bestSourceResult.explanationId,
                    matches: matches,
                    data: null
                };
            }

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
                    data: null
                };
            }

            const explanationData = {
                explanation_title: firstTitle,
                content: parsedResult.data.content,
            };
            
            const validatedUserQuery = explanationBaseSchema.safeParse(explanationData);
            
            if (!validatedUserQuery.success) {
                return {
                    originalUserQuery: userQuery,
                    match_found: null,
                    error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                    explanationId: null,
                    matches: matches,
                    data: null
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
                    data: null
                };
            }

            if (newExplanationId == null) {
                return {
                    originalUserQuery: userQuery,
                    match_found: null,
                    error: createError(ERROR_CODES.SAVE_FAILED, 'Failed to save explanation: missing explanation ID.'),
                    explanationId: null,
                    matches: matches,
                    data: null
                };
            }

            return {
                originalUserQuery: userQuery,
                match_found: false,
                error: null,
                explanationId: newExplanationId,
                matches: matches,
                data: explanationData
            };
        } catch (error) {
            return {
                originalUserQuery: userQuery,
                match_found: null,
                error: handleError(error, 'generateExplanation', { userQuery, matchMode, savedId }),
                explanationId: null,
                matches: [],
                data: null
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
    async function saveUserQuery(userQuery: UserQueryDataType, explanationId: number) {
        try {
            const userQueryWithId = { ...userQuery, explanation_id: explanationId };
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