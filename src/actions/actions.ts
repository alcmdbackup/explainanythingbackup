'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation, getExplanationById} from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { explanationInsertSchema, llmQuerySchema, matchingSourceLLMSchema, type ExplanationInsertType, sourceWithCurrentContentType, type LlmQueryType, type UserQueryInsertType, type matchingSourceLLMType, type QueryResponseType, matchingSourceReturnSchema, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { handleUserQuery } from '@/lib/services/vectorsim';
import { type ZodIssue } from 'zod';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findMatchingSource, enhanceSourcesWithCurrentContent } from '@/lib/services/fileMatching';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';

const FILE_DEBUG = true;

// Type for vector search results
type VectorSearchResult = {
    text: string;
    explanation_id: number;
    similarity: number;
};

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
export async function generateAiExplanation(
    userQuery: string,
    savedId: number | null,
    matchMode: MatchMode
): Promise<{
    data: (QueryResponseType & { title: string }) | null,
    error: ErrorResponse | null,
    originalUserQuery: string
}> {
    try {
        logger.debug('Starting generateAiExplanation', { 
            userQuery_length: userQuery.length,
            savedId,
            matchMode
        }, FILE_DEBUG);

        if (!userQuery.trim()) {
            logger.debug('Empty userQuery detected');
            return {
                data: null,
                error: createInputError('userQuery cannot be empty'),
                originalUserQuery: userQuery
            };
        }

        // Generate article titles using the ORIGINAL user query
        const titlePrompt = createTitlePrompt(userQuery);
        logger.debug('Created title prompt', { title_prompt_length: titlePrompt.length }, FILE_DEBUG);
        const titleResult = await callGPT4omini(titlePrompt, titleQuerySchema, 'titleQuery');
        const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));
        if (parsedTitles.success) {
            logger.debug('Generated article titles', {
                title1: parsedTitles.data.title1,
                title2: parsedTitles.data.title2,
                title3: parsedTitles.data.title3
            }, FILE_DEBUG);
        } else {
            logger.debug('Failed to parse article titles', { errors: parsedTitles.error.errors }, FILE_DEBUG);
        }

        // Get similar text snippets using the FIRST TITLE if available, else throw error
        logger.debug('Fetching similar texts from vector search');
       
        if (!parsedTitles.success || !parsedTitles.data.title1) {
            logger.debug('No valid title1 found in parsedTitles', { parsedTitles }, FILE_DEBUG);
            return {
                data: null,
                error: createError(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH, 'No valid title1 found for vector search. Cannot proceed.'),
                originalUserQuery: userQuery
            };
        }
        
        const firstTitle = parsedTitles.data.title1;
        const similarTexts = await handleUserQuery(firstTitle);
        logger.debug('Vector search results', { 
            count: similarTexts?.length || 0,
            first_result: similarTexts?.[0] 
        }, FILE_DEBUG);

        const sources = await enhanceSourcesWithCurrentContent(similarTexts);
        logger.debug('Enhanced sources', { 
            sources_count: sources?.length || 0,
            first_source: sources?.[0]
        }, FILE_DEBUG);

        // Add the call to selectBestSource here
        const bestSourceResult = await findMatchingSource(firstTitle, sources, matchMode, savedId);
        logger.debug('Best source selection result', {
            selectedIndex: bestSourceResult.selectedIndex,
            explanationId: bestSourceResult.explanationId,
            topicId: bestSourceResult.topicId,
            hasError: !!bestSourceResult.error,
            errorCode: bestSourceResult.error?.code,
            matchMode: matchMode
        }, FILE_DEBUG);

        // Update the match condition to use matchMode
        if ((matchMode === MatchMode.Normal || matchMode === MatchMode.ForceMatch) && 
            bestSourceResult.selectedIndex && 
            bestSourceResult.selectedIndex > 0 && 
            bestSourceResult.explanationId && 
            bestSourceResult.topicId) {
            
            return {
                data: {
                    match_found: true,
                    data: {
                        explanation_id: bestSourceResult.explanationId,
                        topic_id: bestSourceResult.topicId,
                        sources: sources
                    },
                    title: firstTitle
                },
                error: null,
                originalUserQuery: userQuery
            };
        }

        const formattedPrompt = createExplanationPrompt(firstTitle);
        logger.debug('Created formatted prompt', { 
            formatted_prompt_length: formattedPrompt.length 
        }, FILE_DEBUG);

        logger.debug('Calling GPT-4', { prompt_length: formattedPrompt.length });
        const result = await callGPT4omini(formattedPrompt, llmQuerySchema, 'llmQuery');
        logger.debug('Received GPT-4 response', { 
            response_length: result?.length || 0 
        }, FILE_DEBUG);
        
        // Parse the result to ensure it matches our schema
        logger.debug('Parsing LLM response with schema', {}, FILE_DEBUG);
        const parsedResult = llmQuerySchema.safeParse(JSON.parse(result));

        if (!parsedResult.success) {
            logger.debug('Schema validation failed', { 
                errors: parsedResult.error.errors 
            });
            return {
                data: null,
                error: createValidationError('AI response did not match expected format', parsedResult.error),
                originalUserQuery: userQuery
            };
        }

        logger.debug('Successfully generated AI explanation', {
            has_sources: !!sources?.length,
            response_data_keys: Object.keys(parsedResult.data)
        });

        // Validate against userQueryInsertSchema before returning
        const userQueryData = {
            user_query: userQuery,
            explanation_title: firstTitle,
            content: parsedResult.data.content,
            sources: sources // Include the sources from vector search
        };
        
        const validatedUserQuery = userQueryInsertSchema.safeParse(userQueryData);
        
        if (!validatedUserQuery.success) {
            logger.debug('User query validation failed', { 
                errors: validatedUserQuery.error.errors 
            }, FILE_DEBUG);
            return {
                data: null,
                error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                originalUserQuery: userQuery
            };
        }

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
        const errorResponse = handleError(error, 'generateAiExplanation', { userQuery });
        
        return { 
            data: null, 
            error: errorResponse,
            originalUserQuery: userQuery
        };
    }
}

/**
 * Key points:
 * - Saves new explanations and topics to database
 * - Creates embeddings for vector search
 * - Called after generateAiExplanation for new content
 * - Uses createTopic, createExplanation, processContentToStoreEmbedding
 */
export async function saveExplanationAndTopic(userQuery: string, explanationData: UserQueryInsertType) {
    try {
        // Create a topic first using the explanation title, if it doesn't already exist
        const topic = await createTopic({
            topic_title: explanationData.explanation_title
        });

        // Add the topic ID to the explanation data
        const explanationWithTopic: ExplanationInsertType = {
            explanation_title: explanationData.explanation_title,
            content: explanationData.content,
            sources: explanationData.sources,
            primary_topic_id: topic.id
        };

        // Validate the explanation data against our schema
        const validatedData = explanationInsertSchema.safeParse(explanationWithTopic);

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid explanation data format: ${validatedData.error.errors.map((err: ZodIssue) => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`,
                id: null
            };
        }

        // Save to database
        const savedExplanation = await createExplanation(explanationWithTopic);

        // Format content for embedding in the same way as displayed in the UI
        const combinedContent = `# ${explanationData.explanation_title}\n\n${explanationData.content}`;
        
        // Create embeddings for the combined content
        try {
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id, topic.id);
        } catch (embeddingError) {
            logger.error('Failed to create embeddings', {
                error: embeddingError,
                title_length: explanationData.explanation_title.length,
                content_length: explanationData.content.length
            });
            return {
                success: false,
                error: 'Failed to process content for explanation',
                id: null
            };
        }
        
        return { 
            success: true, 
            error: null,
            id: savedExplanation.id 
        };
    } catch (error: any) {
        logger.error('Failed to save explanation to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: userQuery.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save explanation',
            id: null
        };
    }
}

/**
 * Key points:
 * - Saves user queries to database
 * - Validates query data against schema
 * - Called by generateAiExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export async function saveUserQuery(userQuery: UserQueryInsertType) {
    try {
        // Validate the user query data against our schema
        const validatedData = userQueryInsertSchema.safeParse(userQuery);

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid user query data format: ${validatedData.error.errors.map((err: ZodIssue) => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`,
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
    } catch (error: any) {
        logger.error('Failed to save user query to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: userQuery.user_query.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save user query',
            id: null
        };
    }
} 