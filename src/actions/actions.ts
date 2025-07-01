'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, explanationBaseSchema, type ExplanationInsertType, type UserQueryDataType, type QueryResponseType, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryDataSchema, userQueryInsertSchema, matchWithCurrentContentType } from '@/lib/schemas/schemas';
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
        data: (QueryResponseType & { title: string }) | null,
        error: ErrorResponse | null,
        originalUserQuery: string,
        matches: matchWithCurrentContentType[],
        explanationId: number | null
    }> {
        console.log('🔍 [generateExplanation] Starting with:', { userQuery, savedId, matchMode });
        
        try {
            if (!userQuery.trim()) {
                console.log('❌ [generateExplanation] Empty user query detected');
                return {
                    data: null,
                    error: createInputError('userQuery cannot be empty'),
                    originalUserQuery: userQuery,
                    matches: [],
                    explanationId: null
                };
            }

            console.log('📝 [generateExplanation] Generating article titles...');
            // Generate article titles using the ORIGINAL user query
            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callGPT4omini(titlePrompt, titleQuerySchema, 'titleQuery');
            const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));

            console.log('📋 [generateExplanation] Title generation result:', { 
                success: parsedTitles.success, 
                titles: parsedTitles.success ? parsedTitles.data : null 
            });

            // Get similar text snippets using the FIRST TITLE if available, else throw error
            if (!parsedTitles.success || !parsedTitles.data.title1) {
                console.log('❌ [generateExplanation] No valid title1 found for vector search');
                return {
                    data: null,
                    error: createError(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH, 'No valid title1 found for vector search. Cannot proceed.'),
                    originalUserQuery: userQuery,
                    matches: [],
                    explanationId: null
                };
            }
            
            const firstTitle = parsedTitles.data.title1;
            console.log('🔍 [generateExplanation] Using first title for vector search:', firstTitle);
            
            console.log('🔎 [generateExplanation] Starting vector search...');
            const similarTexts = await findMatchesInVectorDb(firstTitle);
            console.log('📊 [generateExplanation] Vector search found', similarTexts.length, 'similar texts');
            
            const matches = await enhanceMatchesWithCurrentContent(similarTexts);
            console.log('📚 [generateExplanation] Enhanced matches count:', matches.length);

            // Add the call to selectBestSource here
            console.log('🎯 [generateExplanation] Finding best matching source...');
            const bestSourceResult = await findMatches(firstTitle, matches, matchMode, savedId);
            console.log('🎯 [generateExplanation] Best source result:', {
                selectedIndex: bestSourceResult.selectedIndex,
                explanationId: bestSourceResult.explanationId,
                topicId: bestSourceResult.topicId
            });

            // Check if we should return a match based on matchMode and source quality
            const shouldReturnMatch = (matchMode === MatchMode.Normal || matchMode === MatchMode.ForceMatch) && 
                bestSourceResult.selectedIndex && 
                bestSourceResult.selectedIndex > MIN_SIMILARITY_INDEX && 
                bestSourceResult.explanationId !== null && 
                bestSourceResult.topicId !== null;

            console.log('🤔 [generateExplanation] Match decision:', {
                matchMode,
                shouldReturnMatch,
                selectedIndex: bestSourceResult.selectedIndex,
                minSimilarityIndex: MIN_SIMILARITY_INDEX
            });

            if (shouldReturnMatch) {
                console.log('✅ [generateExplanation] Returning existing match');
                return {
                    data: {
                        match_found: true,
                        data: {
                            explanation_id: bestSourceResult.explanationId!,
                            topic_id: bestSourceResult.topicId!
                        },
                        title: firstTitle
                    },
                    error: null,
                    originalUserQuery: userQuery, 
                    matches: matches,
                    explanationId: bestSourceResult.explanationId
                };
            }

            console.log('🤖 [generateExplanation] Generating new explanation with LLM...');
            const formattedPrompt = createExplanationPrompt(firstTitle);
            const result = await callGPT4omini(formattedPrompt, explanationBaseSchema, 'llmQuery');
            
            // Parse the result to ensure it matches our schema
            const parsedResult = explanationBaseSchema.safeParse(JSON.parse(result));

            console.log('📝 [generateExplanation] LLM response parsing:', {
                success: parsedResult.success,
                contentLength: parsedResult.success ? parsedResult.data.content.length : null
            });

            if (!parsedResult.success) {
                console.log('❌ [generateExplanation] LLM response parsing failed:', parsedResult.error);
                return {
                    data: null,
                    error: createValidationError('AI response did not match expected format', parsedResult.error),
                    originalUserQuery: userQuery,
                    matches: matches,
                    explanationId: null
                };
            }

            // Validate against userQueryDataSchema before returning
            const userQueryData = {
                user_query: userQuery,
                explanation_title: firstTitle,
                content: parsedResult.data.content,
                matches: matches // Include the matches from vector search
            };
            
            console.log('✅ [generateExplanation] Validating user query data...');
            const validatedUserQuery = userQueryDataSchema.safeParse(userQueryData);
            
            if (!validatedUserQuery.success) {
                console.log('❌ [generateExplanation] User query validation failed:', validatedUserQuery.error);
                return {
                    data: null,
                    error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                    originalUserQuery: userQuery,
                    matches: matches,
                    explanationId: null
                };
            }

            console.log('💾 [generateExplanation] Saving new explanation to database...');
            const { error: explanationTopicError, id: newExplanationId } = await saveExplanationAndTopic(userQuery, validatedUserQuery.data);
            
            if (explanationTopicError) {
                console.log('❌ [generateExplanation] Failed to save explanation:', explanationTopicError);
                return {
                    data: null,
                    error: explanationTopicError,
                    originalUserQuery: userQuery,
                    matches: matches,
                    explanationId: null
                };
            }

            if (newExplanationId == null) {
                console.log('❌ [generateExplanation] Missing explanation ID after save');
                return {
                    data: null,
                    error: createError(ERROR_CODES.SAVE_FAILED, 'Failed to save explanation: missing explanation ID.'),
                    originalUserQuery: userQuery,
                    matches: matches,
                    explanationId: null
                };
            }

            console.log('✅ [generateExplanation] Successfully generated and saved new explanation');
            return {
                data: {
                    match_found: false,
                    data: validatedUserQuery.data,
                    title: firstTitle
                },
                error: null,
                originalUserQuery: userQuery,
                matches: matches,
                explanationId: newExplanationId
            };
        } catch (error) {
            console.error('💥 [generateExplanation] Unexpected error:', error);
            return {
                data: null,
                error: handleError(error, 'generateExplanation', { userQuery, matchMode, savedId }),
                originalUserQuery: userQuery,
                matches: [],
                explanationId: null
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
    async function saveExplanationAndTopic(userQuery: string, explanationData: UserQueryDataType) {
        try {
            // Create a topic first using the explanation title, if it doesn't already exist
            const topic = await createTopic({
                topic_title: explanationData.explanation_title
            });

            // Add the topic ID to the explanation data
            const explanationWithTopic: ExplanationInsertType = {
                explanation_title: explanationData.explanation_title,
                content: explanationData.content,
                primary_topic_id: topic.id
            };

            // Debug log the data being validated
            console.log('🔍 [saveExplanationAndTopic] Validating explanation data:', {
                explanation_title: explanationWithTopic.explanation_title,
                content_length: explanationWithTopic.content?.length,
                primary_topic_id: explanationWithTopic.primary_topic_id
            });

            // Validate the explanation data against our schema
            const validatedData = explanationInsertSchema.safeParse(explanationWithTopic);

            if (!validatedData.success) {
                return {
                    success: false,
                    error: createValidationError('Invalid explanation data format', validatedData.error),
                    id: null
                };
            }

            // Save to database
            console.log('💾 [saveExplanationAndTopic] Saving explanation to database:', JSON.stringify(validatedData.data, null, 2));
            const savedExplanation = await createExplanation(validatedData.data);

            // Format content for embedding in the same way as displayed in the UI
            const combinedContent = CONTENT_FORMAT_TEMPLATE
                .replace('{title}', explanationData.explanation_title)
                .replace('{content}', explanationData.content);
            
            // Create embeddings for the combined content
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
            // Add explanationId to the userQuery object
            const userQueryWithId = { ...userQuery, explanation_id: explanationId };
            // Validate the user query data against our schema
            const validatedData = userQueryInsertSchema.safeParse(userQueryWithId);

            if (!validatedData.success) {
                return {
                    success: false,
                    error: createValidationError('Invalid user query data format', validatedData.error),
                    id: null
                };
            }

            // Save to database
            const savedQuery = await createUserQuery(validatedData.data);
            
            return { 
                success: true, 
                error: null,
                id: savedQuery.id 
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'saveUserQuery', { userQueryTitle: userQuery.explanation_title }),
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