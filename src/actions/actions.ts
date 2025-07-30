'use server';

import { callOpenAIModel } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, explanationBaseType, explanationBaseSchema, type ExplanationInsertType, MatchMode, UserInputType, titleQuerySchema, type UserExplanationEventsType } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';
import { createUserQuery, getUserQueryById } from '@/lib/services/userQueries';
import { userQueryInsertSchema, matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { findMatches, enhanceMatchesWithCurrentContent } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging, withLoggingAndTracing } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { getExplanationById, getRecentExplanations } from '@/lib/services/explanations';
import { saveExplanationToLibrary, isExplanationSavedByUser, getUserLibraryExplanations } from '@/lib/services/userLibrary';
import { createMappingsHeadingsToLinks, createMappingsKeytermsToLinks } from '@/lib/services/links';
import { createUserExplanationEvent } from '@/lib/services/metrics';
import { createTags, getTagById, updateTag, deleteTag } from '@/lib/services/tags';
import { evaluateExplanationDifficulty } from '@/lib/services/tagEvaluation';
import { addTagsToExplanation, removeTagsFromExplanation, getTagsForExplanation } from '@/lib/services/explanationTags';
import { type TagInsertType, type TagFullDbType, type ExplanationTagFullDbType } from '@/lib/schemas/schemas';

const FILE_DEBUG = true;

// Constants for better maintainability
const MIN_SIMILARITY_INDEX = 0;
const CONTENT_FORMAT_TEMPLATE = '# {title}\n\n{content}';

/**
 * Key points:
 * - Generates article title from user query using LLM
 * - Validates the response format and returns first title
 * - Used by generateExplanation for title creation
 * - Calls createTitlePrompt, callOpenAIModel
 * - Used by generateExplanation
 */
const generateTitleFromUserQuery = withLogging(
    async function generateTitleFromUserQuery(userQuery: string, userid:string): Promise<{
        success: boolean;
        title: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callOpenAIModel(titlePrompt, "generateTitleFromUserQuery", userid, "gpt-4o-mini", titleQuerySchema, 'titleQuery');
            const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));

            if (!parsedTitles.success || !parsedTitles.data.title1) {
                return {
                    success: false,
                    title: null,
                    error: createError(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH, 'No valid title1 found for vector search. Cannot proceed.')
                };
            }

            return {
                success: true,
                title: parsedTitles.data.title1,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                title: null,
                error: handleError(error, 'generateTitleFromUserQuery', { userQuery })
            };
        }
    },
    'generateTitleFromUserQuery',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Key points:
 * - Main function for generating AI explanations
 * - Handles both matching and new explanation generation
 * - Uses vector search and LLM for content creation
 * - Generates article titles using the original user query (not enhanced)
 * - Uses the first generated title for vector search (handleUserQuery)
 * - Automatically saves new explanations to database with embeddings
 * - Returns explanation ID for both new and matched explanations
 * - Accepts userInputType to differentiate between queries and titles from links
 * - Uses handleUserQuery, enhanceMatchesWithCurrentContent, findMatchingSource, saveExplanationAndTopic
 */
export const generateExplanation = withLoggingAndTracing(
    async function generateExplanation(
        userInput: string,
        savedId: number | null,
        matchMode: MatchMode,
        userid: string,
        userInputType: UserInputType
    ): Promise<{
        originalUserInput: string,
        match_found: Boolean | null,
        error: ErrorResponse | null,
        explanationId: number | null,
        matches: matchWithCurrentContentType[],
        data: explanationBaseType | null,
        userQueryId: number | null,
        userInputType: UserInputType
    }> {
        try {
            if (!userInput.trim()) {
                return {
                    originalUserInput: userInput,
                    match_found: null,
                    error: createInputError('userInput cannot be empty'),
                    explanationId: null,
                    matches: [],
                    data: null,
                    userQueryId: null,
                    userInputType
                };
            }

            let titleResult: string;
            
            if (userInputType === UserInputType.Query) {
                const titlesGenerated = await generateTitleFromUserQuery(userInput, userid);
                if (!titlesGenerated.success || !titlesGenerated.title) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: titlesGenerated.error,
                        explanationId: null,
                        matches: [],
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }
                titleResult = titlesGenerated.title;
            } else {
                // For TitleFromLink, use the userInput directly as the title
                titleResult = userInput;
            }
            const similarTexts = await findMatchesInVectorDb(titleResult);
            const matches = await enhanceMatchesWithCurrentContent(similarTexts);
            const bestSourceResult = await findMatches(titleResult, matches, matchMode, savedId, userid);
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
                const formattedPrompt = createExplanationPrompt(titleResult);
                const result = await callOpenAIModel(formattedPrompt, "generateNewExplanation", userid, "gpt-4o-mini", explanationBaseSchema, 'llmQuery');
                
                const parsedResult = explanationBaseSchema.safeParse(JSON.parse(result));

                if (!parsedResult.success) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: createValidationError('AI response did not match expected format', parsedResult.error),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }

                // Run enhancement functions and difficulty evaluation in parallel
                const [headingMappings, keyTermMappings, tagToApply] = await Promise.all([
                    createMappingsHeadingsToLinks(parsedResult.data.content, titleResult, userid, FILE_DEBUG),
                    createMappingsKeytermsToLinks(parsedResult.data.content, userid, FILE_DEBUG),
                    evaluateExplanationDifficulty(titleResult, parsedResult.data.content, userid)
                ]);
                
                // Apply both heading and key term mappings to the content
                let enhancedContent = parsedResult.data.content;
                
                // Apply heading mappings first
                for (const [originalHeading, linkedHeading] of Object.entries(headingMappings)) {
                    enhancedContent = enhancedContent.replace(originalHeading, linkedHeading);
                }
                
                // Apply key term mappings second
                for (const [originalKeyTerm, linkedKeyTerm] of Object.entries(keyTermMappings)) {
                    enhancedContent = enhancedContent.replace(originalKeyTerm, linkedKeyTerm);
                }

                const newExplanationData = {
                    explanation_title: titleResult,
                    content: enhancedContent,
                };
                
                const validatedUserQuery = explanationBaseSchema.safeParse(newExplanationData);
                
                if (!validatedUserQuery.success) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }

                const { error: explanationTopicError, id: newExplanationId } = await saveExplanationAndTopic(userInput, validatedUserQuery.data);
                
                if (explanationTopicError) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: explanationTopicError,
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }

                if (newExplanationId == null) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: createError(ERROR_CODES.SAVE_FAILED, 'Failed to save explanation: missing explanation ID.'),
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }

                finalExplanationId = newExplanationId;
                explanationData = newExplanationData;
                
                // Apply difficulty tag if evaluation was successful
                if (tagToApply && !tagToApply.error && tagToApply.difficultyLevel) {
                    try {
                        const tagResult = await addTagsToExplanationAction(newExplanationId, [tagToApply.difficultyLevel]);
                        if (tagResult.error) {
                            logger.error('Failed to apply difficulty tag to explanation', {
                                explanationId: newExplanationId,
                                difficultyLevel: tagToApply.difficultyLevel,
                                error: tagResult.error
                            });
                        } else {
                            logger.debug('Successfully applied difficulty tag to explanation', {
                                explanationId: newExplanationId,
                                difficultyLevel: tagToApply.difficultyLevel
                            });
                        }
                    } catch (error) {
                        logger.error('Error applying difficulty tag to explanation', {
                            explanationId: newExplanationId,
                            difficultyLevel: tagToApply.difficultyLevel,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                    }
                }
            }

            // Save user query once - works for both match and new explanation cases
            let userQueryId: number | null = null;
            if (finalExplanationId && userid) {
                
                const { error: userQueryError, id: savedUserQueryId } = await saveUserQuery(userInput, matches, finalExplanationId, userid, !isMatchFound, userInputType);
                if (userQueryError) {
                    // Error already logged by withLogging decorator
                } else {
                    userQueryId = savedUserQueryId;
                }
            }

            return {
                originalUserInput: userInput,
                match_found: isMatchFound,
                error: null,
                explanationId: finalExplanationId,
                matches: matches,
                data: explanationData,
                userQueryId: userQueryId,
                userInputType
            };
        } catch (error) {
            return {
                originalUserInput: userInput,
                match_found: null,
                error: handleError(error, 'generateExplanation', { userInput, matchMode, savedId, userid, userInputType }),
                explanationId: null,
                matches: [],
                data: null,
                userQueryId: null,
                userInputType
            };
        }
    },
    'generateExplanation',
    { 
        enabled: FILE_DEBUG
    },
    {
        enabled: true,
        customAttributes: {
            'business.operation': 'generateExplanation',
            'business.context': 'ai_explanation_generation'
        }
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
        enabled: FILE_DEBUG
    }
);

/**
 * Key points:
 * - Saves user queries to database with userInputType tracking
 * - Validates query data against schema including userInputType
 * - Called by generateExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export const saveUserQuery = withLogging(
    async function saveUserQuery(userInput, matches, explanationId: number, userid: string, newExplanation: boolean, userInputType: UserInputType) {
        
        try {
            const userQueryWithId = { user_query: userInput, matches, explanation_id: explanationId, userid, newExplanation, userInputType };
            
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
 * • Calls getTagById service to fetch tag from database
 * • Returns tag data if found, null if not found
 * • Used by client code to fetch tag details via server action
 * • Calls: getTagById
 * • Used by: Tag editing components, tag display interfaces
 */
export const getTagByIdAction = withLogging(
    async function getTagByIdAction(id: number): Promise<{
        success: boolean;
        data: TagFullDbType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tag = await getTagById(id);
            
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
        data: TagFullDbType[] | null;
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