'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, llmQuerySchema, type ExplanationInsertType, type UserQueryInsertType, type QueryResponseType, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { handleUserQuery } from '@/lib/services/vectorsim';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findMatchingSource, enhanceSourcesWithCurrentContent } from '@/lib/services/sourceMatching';
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
 * - Called by saveExplanationAndTopic for new explanations
 * - Uses handleUserQuery, enhanceSourcesWithCurrentContent, findMatchingSource
 */
export const generateAiExplanation = withLogging(
    async function generateAiExplanation(
        userQuery: string,
        savedId: number | null,
        matchMode: MatchMode
    ): Promise<{
        data: (QueryResponseType & { title: string }) | null,
        error: ErrorResponse | null,
        originalUserQuery: string
    }> {
        console.log('🔍 [generateAiExplanation] Starting with:', { userQuery, savedId, matchMode });
        
        try {
            if (!userQuery.trim()) {
                console.log('❌ [generateAiExplanation] Empty user query detected');
                return {
                    data: null,
                    error: createInputError('userQuery cannot be empty'),
                    originalUserQuery: userQuery
                };
            }

            console.log('📝 [generateAiExplanation] Generating article titles...');
            // Generate article titles using the ORIGINAL user query
            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callGPT4omini(titlePrompt, titleQuerySchema, 'titleQuery');
            const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));

            console.log('📋 [generateAiExplanation] Title generation result:', { 
                success: parsedTitles.success, 
                titles: parsedTitles.success ? parsedTitles.data : null 
            });

            // Get similar text snippets using the FIRST TITLE if available, else throw error
            if (!parsedTitles.success || !parsedTitles.data.title1) {
                console.log('❌ [generateAiExplanation] No valid title1 found for vector search');
                return {
                    data: null,
                    error: createError(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH, 'No valid title1 found for vector search. Cannot proceed.'),
                    originalUserQuery: userQuery
                };
            }
            
            const firstTitle = parsedTitles.data.title1;
            console.log('🔍 [generateAiExplanation] Using first title for vector search:', firstTitle);
            
            console.log('🔎 [generateAiExplanation] Starting vector search...');
            const similarTexts = await handleUserQuery(firstTitle);
            console.log('📊 [generateAiExplanation] Vector search found', similarTexts.length, 'similar texts');
            
            const sources = await enhanceSourcesWithCurrentContent(similarTexts);
            console.log('📚 [generateAiExplanation] Enhanced sources count:', sources.length);

            // Add the call to selectBestSource here
            console.log('🎯 [generateAiExplanation] Finding best matching source...');
            const bestSourceResult = await findMatchingSource(firstTitle, sources, matchMode, savedId);
            console.log('🎯 [generateAiExplanation] Best source result:', {
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

            console.log('🤔 [generateAiExplanation] Match decision:', {
                matchMode,
                shouldReturnMatch,
                selectedIndex: bestSourceResult.selectedIndex,
                minSimilarityIndex: MIN_SIMILARITY_INDEX
            });

            if (shouldReturnMatch) {
                console.log('✅ [generateAiExplanation] Returning existing match');
                return {
                    data: {
                        match_found: true,
                        data: {
                            explanation_id: bestSourceResult.explanationId!,
                            topic_id: bestSourceResult.topicId!,
                            sources: sources
                        },
                        title: firstTitle
                    },
                    error: null,
                    originalUserQuery: userQuery
                };
            }

            console.log('🤖 [generateAiExplanation] Generating new explanation with LLM...');
            const formattedPrompt = createExplanationPrompt(firstTitle);
            const result = await callGPT4omini(formattedPrompt, llmQuerySchema, 'llmQuery');
            
            // Parse the result to ensure it matches our schema
            const parsedResult = llmQuerySchema.safeParse(JSON.parse(result));

            console.log('📝 [generateAiExplanation] LLM response parsing:', {
                success: parsedResult.success,
                contentLength: parsedResult.success ? parsedResult.data.content.length : null
            });

            if (!parsedResult.success) {
                console.log('❌ [generateAiExplanation] LLM response parsing failed:', parsedResult.error);
                return {
                    data: null,
                    error: createValidationError('AI response did not match expected format', parsedResult.error),
                    originalUserQuery: userQuery
                };
            }

            // Validate against userQueryInsertSchema before returning
            const userQueryData = {
                user_query: userQuery,
                explanation_title: firstTitle,
                content: parsedResult.data.content,
                matches: sources // Include the matches from vector search
            };
            
            console.log('✅ [generateAiExplanation] Validating user query data...');
            const validatedUserQuery = userQueryInsertSchema.safeParse(userQueryData);
            
            if (!validatedUserQuery.success) {
                console.log('❌ [generateAiExplanation] User query validation failed:', validatedUserQuery.error);
                return {
                    data: null,
                    error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                    originalUserQuery: userQuery
                };
            }

            console.log('✅ [generateAiExplanation] Successfully generated new explanation');
            return {
                data: {
                    match_found: false,
                    data: validatedUserQuery.data,
                    title: firstTitle
                },
                error: null,
                originalUserQuery: userQuery
            };
        } catch (error) {
            console.error('💥 [generateAiExplanation] Unexpected error:', error);
            return {
                data: null,
                error: handleError(error, 'generateAiExplanation', { userQuery, matchMode, savedId }),
                originalUserQuery: userQuery
            };
        }
    },
    'generateAiExplanation',
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
 * - Called after generateAiExplanation for new content
 * - Uses createTopic, createExplanation, processContentToStoreEmbedding
 */
export const saveExplanationAndTopic = withLogging(
    async function saveExplanationAndTopic(userQuery: string, explanationData: UserQueryInsertType) {
        try {
            // Create a topic first using the explanation title, if it doesn't already exist
            const topic = await createTopic({
                topic_title: explanationData.explanation_title
            });

            // Add the topic ID to the explanation data
            const explanationWithTopic: ExplanationInsertType = {
                explanation_title: explanationData.explanation_title,
                content: explanationData.content,
                sources: explanationData.matches,
                primary_topic_id: topic.id
            };

            // Debug log the data being validated
            console.log('🔍 [saveExplanationAndTopic] Validating explanation data:', {
                explanation_title: explanationWithTopic.explanation_title,
                content_length: explanationWithTopic.content?.length,
                sources_count: explanationWithTopic.sources?.length,
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
            const savedExplanation = await createExplanation(explanationWithTopic);

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
 * - Called by generateAiExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export const saveUserQuery = withLogging(
    async function saveUserQuery(userQuery: UserQueryInsertType) {
        try {
            // Validate the user query data against our schema
            const validatedData = userQueryInsertSchema.safeParse(userQuery);

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