'use server';

import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { createExplanation } from '@/lib/services/explanations';
import { explanationInsertSchema, explanationBaseType, type ExplanationInsertType, UserInputType, type UserExplanationEventsType, type ExplanationMetricsType, type ExplanationMetricsTableType, ExplanationStatus, type MatchType } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding, loadFromPineconeUsingExplanationId } from '@/lib/services/vectorsim';
import { createUserQuery, getUserQueryById } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { logger } from '@/lib/client_utilities';
import { getExplanationById, getRecentExplanations } from '@/lib/services/explanations';
import { saveExplanationToLibrary, isExplanationSavedByUser, getUserLibraryExplanations } from '@/lib/services/userLibrary';
import { 
  createUserExplanationEvent, 
  getMultipleExplanationMetrics, 
  refreshExplanationMetrics
} from '@/lib/services/metrics';
import { createTags, getTagsById, updateTag, deleteTag, getTagsByPresetId, getAllTags, getTempTagsForRewriteWithTags } from '@/lib/services/tags';
import { addTagsToExplanation, removeTagsFromExplanation, getTagsForExplanation } from '@/lib/services/explanationTags';
import { type TagInsertType, type TagFullDbType, type ExplanationTagFullDbType, type TagUIType } from '@/lib/schemas/schemas';
import { createAISuggestionPrompt, createApplyEditsPrompt, aiSuggestionSchema } from '../editorFiles/aiSuggestion';
import { checkAndSaveTestingPipelineRecord, updateTestingPipelineRecordSetName, type TestingPipelineRecord } from '../lib/services/testingPipeline';
import { createSupabaseServerClient } from '../lib/utils/supabase/server';
import { resolveLinksForArticle, applyLinksToContent, getOverridesForArticle, setOverride, removeOverride } from '@/lib/services/linkResolver';
import {
  createWhitelistTerm,
  updateWhitelistTerm,
  deleteWhitelistTerm,
  getAllActiveWhitelistTerms,
  getWhitelistTermById,
  addAliases,
  removeAlias,
  getAliasesForTerm,
  getSnapshot,
  getHeadingLinksForArticle
} from '@/lib/services/linkWhitelist';
import {
  getAllCandidates,
  getCandidateById,
  approveCandidate,
  rejectCandidate,
  deleteCandidate,
  updateOccurrencesForArticle
} from '@/lib/services/linkCandidates';
import type {
  LinkWhitelistInsertType,
  LinkWhitelistFullType,
  LinkAliasFullType,
  ArticleLinkOverrideFullType,
  LinkCandidateFullType
} from '@/lib/schemas/schemas';
import { CandidateStatus } from '@/lib/schemas/schemas';


const FILE_DEBUG = true;

// Constants for better maintainability
const CONTENT_FORMAT_TEMPLATE = '# {title}\n\n{content}';

// Type for Pinecone vector data
interface PineconeVectorMatch {
    id: string;
    score?: number;
    values?: number[];
    metadata?: Record<string, unknown>;
}

// Type for session metadata
type SessionMetadata = Record<string, unknown>;




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
                primary_topic_id: topic.id,
                status: ExplanationStatus.Draft
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
 * Updates an existing explanation's content and/or status
 *
 * Key points:
 * - Updates existing explanations without creating new records
 * - Can update content, status, or both
 * - Regenerates embeddings when content changes
 * - Used for editing published/draft articles
 */
const _updateExplanationAndTopic = withLogging(
    async function updateExplanationAndTopic(
        params: {
            explanationId: number;
            updates: { content?: string; status?: ExplanationStatus; explanation_title?: string };
        }
    ) {
        const { explanationId, updates } = params;
        try {
            // Import updateExplanation function
            const { updateExplanation } = await import('@/lib/services/explanations');

            // Validate that we have something to update
            if (!updates.content && !updates.status && !updates.explanation_title) {
                return {
                    success: false,
                    error: createInputError('No updates provided'),
                    id: explanationId
                };
            }

            // Update the explanation record
            const updatedExplanation = await updateExplanation(explanationId, updates);

            // If content was updated, regenerate embeddings
            if (updates.content || updates.explanation_title) {
                const combinedContent = CONTENT_FORMAT_TEMPLATE
                    .replace('{title}', updates.explanation_title || updatedExplanation.explanation_title)
                    .replace('{content}', updates.content || updatedExplanation.content);

                await processContentToStoreEmbedding(
                    combinedContent,
                    explanationId,
                    updatedExplanation.primary_topic_id
                );
            }

            // If content was updated, re-count candidate occurrences
            if (updates.content) {
                try {
                    await updateOccurrencesForArticle(explanationId, updates.content, FILE_DEBUG);
                } catch (occError) {
                    // Log but don't fail the update if occurrence recounting fails
                    logger.error('Failed to update candidate occurrences', {
                        explanationId,
                        error: occError instanceof Error ? occError.message : String(occError)
                    });
                }
            }

            return {
                success: true,
                error: null,
                id: explanationId
            };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'updateExplanationAndTopic', { explanationId, updates }),
                id: explanationId
            };
        }
    },
    'updateExplanationAndTopic',
    {
        enabled: FILE_DEBUG
    }
);

export const updateExplanationAndTopic = serverReadRequestId(_updateExplanationAndTopic);

/**
 * Saves or publishes changes to an explanation based on its current status
 *
 * Key points:
 * - For draft articles: updates the existing record to published status
 * - For published articles: creates a new published version, leaving original unchanged
 * - Returns the ID of the explanation (existing or new) that was published
 * - Used by the in-UI editing feature
 */
const _saveOrPublishChanges = withLogging(
    async function saveOrPublishChanges(
        params: {
            explanationId: number;
            newContent: string;
            newTitle: string;
            originalStatus: ExplanationStatus;
            targetStatus?: ExplanationStatus;
        }
    ) {
        const { explanationId, newContent, newTitle, originalStatus, targetStatus = ExplanationStatus.Published } = params;
        try {
            if (originalStatus === ExplanationStatus.Draft) {
                // For draft articles, update the existing record
                // Always include status change, and include content/title if they're provided
                const updates: { content?: string; status: ExplanationStatus; explanation_title?: string } = {
                    status: targetStatus
                };

                if (newContent) {
                    updates.content = newContent;
                }
                if (newTitle) {
                    updates.explanation_title = newTitle;
                }

                const result = await updateExplanationAndTopic({ explanationId, updates });

                return {
                    success: result.success,
                    error: result.error,
                    id: explanationId, // Return the same ID for drafts
                    isNewExplanation: false
                };
            } else {
                // For published articles, create a new published version
                const explanationData: explanationBaseType = {
                    explanation_title: newTitle,
                    content: newContent
                };
                const result = await saveExplanationAndTopic('', explanationData);

                // After creating, update status to target status if different from default
                if (result.success && result.id && targetStatus !== ExplanationStatus.Draft) {
                    await updateExplanationAndTopic({ explanationId: result.id, updates: { status: targetStatus } });
                }

                return {
                    success: result.success,
                    error: result.error,
                    id: result.id, // Return the new ID for published articles
                    isNewExplanation: true
                };
            }
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'saveOrPublishChanges', {
                    explanationId,
                    originalStatus,
                    targetStatus
                }),
                id: null,
                isNewExplanation: false
            };
        }
    },
    'saveOrPublishChanges',
    {
        enabled: FILE_DEBUG
    }
);

export const saveOrPublishChanges = serverReadRequestId(_saveOrPublishChanges);

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
                    matches_with_diversity: matches?.map((match: MatchType) => ({
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
const _getExplanationByIdAction = async function(params: { id: number }) {
    return await getExplanationById(params.id);
};

export const getExplanationByIdAction = serverReadRequestId(_getExplanationByIdAction);

/**
 * Resolves and applies links to explanation content at render time (server action)
 *
 * • Fetches heading links from article_heading_links table
 * • Matches whitelist terms (first occurrence only)
 * • Applies per-article overrides
 * • Returns content with markdown links applied
 * • Falls back to raw content if resolution fails
 * • Calls: resolveLinksForArticle, applyLinksToContent
 * • Used by: useExplanationLoader hook when displaying content
 */
const _resolveLinksForDisplayAction = async function(params: {
    explanationId: number;
    content: string;
}) {
    const links = await resolveLinksForArticle(params.explanationId, params.content);
    return applyLinksToContent(params.content, links);
};

export const resolveLinksForDisplayAction = serverReadRequestId(_resolveLinksForDisplayAction);

/**
 * Data structure for Lexical-level link overlay
 * Used by LexicalEditor.applyLinkOverlay() to apply links at the editor tree level
 */
export interface LexicalLinkOverlayData {
    headingLinks: { headingTextLower: string; standaloneTitle: string }[];
    whitelistTerms: { termLower: string; canonicalTerm: string; standaloneTitle: string }[];
    overrides: { termLower: string; type: 'disabled' | 'custom_title'; customTitle?: string }[];
}

/**
 * Fetches link data for Lexical-level overlay (server action)
 *
 * • Fetches heading links from article_heading_links table
 * • Fetches whitelist terms from snapshot cache
 * • Fetches per-article overrides
 * • Returns data in format suitable for Lexical tree-level processing
 * • Used by: LexicalEditor.applyLinkOverlay()
 */
const _getLinkDataForLexicalOverlayAction = async function(params: {
    explanationId: number;
}): Promise<LexicalLinkOverlayData> {
    // Fetch heading links
    const headingLinksMap = await getHeadingLinksForArticle(params.explanationId);
    const headingLinks = Array.from(headingLinksMap.entries()).map(([headingTextLower, standaloneTitle]) => ({
        headingTextLower,
        standaloneTitle
    }));

    // Fetch whitelist snapshot
    const snapshot = await getSnapshot();
    const whitelistTerms = Object.entries(snapshot.data).map(([termLower, entry]) => ({
        termLower,
        canonicalTerm: entry.canonical_term,
        standaloneTitle: entry.standalone_title
    }));

    // Fetch per-article overrides
    const overridesMap = await getOverridesForArticle(params.explanationId);
    const overrides = Array.from(overridesMap.entries()).map(([termLower, override]) => ({
        termLower,
        type: override.override_type as 'disabled' | 'custom_title',
        customTitle: override.custom_standalone_title ?? undefined
    }));

    return {
        headingLinks,
        whitelistTerms,
        overrides
    };
};

export const getLinkDataForLexicalOverlayAction = serverReadRequestId(_getLinkDataForLexicalOverlayAction);

/**
 * Saves an explanation to the user's library (server action)
 *
 * • Calls saveExplanationToLibrary service to insert a record for the user and explanation
 * • Throws error if the insert fails
 * • Used by client code to save explanations via server action
 * • Calls: saveExplanationToLibrary
 * • Used by: ResultsPage, other client components
 */
const _saveExplanationToLibraryAction = async function(params: { explanationid: number; userid: string }) {
    return await saveExplanationToLibrary(params.explanationid, params.userid);
};

export const saveExplanationToLibraryAction = serverReadRequestId(_saveExplanationToLibraryAction);

/**
 * Checks if an explanation is saved by the user (server action)
 *
 * • Calls isExplanationSavedByUser service to check for a user/explanation record
 * • Returns true if found, false otherwise
 * • Used by client code to check save status via server action
 * • Calls: isExplanationSavedByUser
 * • Used by: ResultsPage, other client components
 */
const _isExplanationSavedByUserAction = async function(params: { explanationid: number; userid: string }) {
    return await isExplanationSavedByUser(params.explanationid, params.userid);
};

export const isExplanationSavedByUserAction = serverReadRequestId(_isExplanationSavedByUserAction); 

/**
 * Fetches recent explanations with pagination (server action)
 *
 * • Calls getRecentExplanations service to fetch recent explanations from database
 * • Supports limit, offset, orderBy, and order parameters
 * • Used by client code to fetch lists of explanations via server action
 * • Calls: getRecentExplanations
 * • Used by: ExplanationsPage, other client components
 */
const _getRecentExplanationsAction = async function(
    limit?: number,
    offset?: number,
    options?: { sort?: 'new' | 'top'; period?: 'today' | 'week' | 'month' | 'all' }
) {
    return await getRecentExplanations(limit, offset, options);
};

export const getRecentExplanationsAction = serverReadRequestId(_getRecentExplanationsAction); 

/**
 * Fetches all explanations saved in a user's library (server action)
 *
 * • Calls getUserLibraryExplanations service to fetch explanations for a user
 * • Throws error if the fetch fails
 * • Used by client code to fetch user library explanations via server action
 * • Calls: getUserLibraryExplanations
 * • Used by: UserLibraryPage, other client components
 */
const _getUserLibraryExplanationsAction = async function(userid: string) {
    return await getUserLibraryExplanations(userid);
};

export const getUserLibraryExplanationsAction = serverReadRequestId(_getUserLibraryExplanationsAction);

/**
 * Fetches a user query by its ID (server action)
 *
 * • Calls getUserQueryById service to fetch user query from database
 * • Throws error if user query is not found
 * • Used by client code to fetch user query details via server action
 * • Calls: getUserQueryById
 * • Used by: ResultsPage, other client components
 */
const _getUserQueryByIdAction = async function(params: { id: number }) {
    return await getUserQueryById(params.id);
};

export const getUserQueryByIdAction = serverReadRequestId(_getUserQueryByIdAction);

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
const _createUserExplanationEventAction = async function(eventData: UserExplanationEventsType): Promise<UserExplanationEventsType> {
    return await createUserExplanationEvent(eventData);
};

export const createUserExplanationEventAction = serverReadRequestId(_createUserExplanationEventAction);

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
const _createTagsAction = withLogging(
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

export const createTagsAction = serverReadRequestId(_createTagsAction);

/**
 * Fetches a tag record by ID (server action)
 *
 * • Calls getTagsById service to fetch tag from database
 * • Returns tag data if found, null if not found
 * • Used by client code to fetch tag details via server action
 * • Calls: getTagsById
 * • Used by: Tag editing components, tag display interfaces
 */
const _getTagByIdAction = withLogging(
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

export const getTagByIdAction = serverReadRequestId(_getTagByIdAction);

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
const _updateTagAction = withLogging(
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

export const updateTagAction = serverReadRequestId(_updateTagAction);

/**
 * Deletes a tag record (server action)
 *
 * • Removes tag record from database by ID
 * • Cascade deletion will also remove explanation_tags relationships
 * • Used by tag management and cleanup operations
 * • Calls: deleteTag
 * • Used by: Tag management components, admin interfaces
 */
const _deleteTagAction = withLogging(
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

export const deleteTagAction = serverReadRequestId(_deleteTagAction);

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
const _addTagsToExplanationAction = withLogging(
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

export const addTagsToExplanationAction = serverReadRequestId(_addTagsToExplanationAction);

/**
 * Removes specific tags from an explanation (server action)
 *
 * • Removes multiple explanation-tag relationships by tag IDs
 * • Safe operation that won't fail if relationships don't exist
 * • Used by tag removal operations (single or multiple)
 * • Calls: removeTagsFromExplanation
 * • Used by: Tag management components, explanation editing interfaces
 */
const _removeTagsFromExplanationAction = withLogging(
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

export const removeTagsFromExplanationAction = serverReadRequestId(_removeTagsFromExplanationAction);

/**
 * Gets all tags for a specific explanation (server action)
 *
 * • Retrieves all tags associated with an explanation via junction table
 * • Returns array of full tag records with tag details
 * • Used by explanation display and editing interfaces
 * • Calls: getTagsForExplanation
 * • Used by: Explanation view components, tag display interfaces
 */
const _getTagsForExplanationAction = withLogging(
    async function getTagsForExplanationAction(params: { explanationId: number }): Promise<{
        success: boolean;
        data: TagUIType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const tags = await getTagsForExplanation(params.explanationId);

            return {
                success: true,
                data: tags,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getTagsForExplanationAction', { explanationId: params.explanationId })
            };
        }
    },
    'getTagsForExplanationAction',
    {
        enabled: FILE_DEBUG
    }
);

export const getTagsForExplanationAction = serverReadRequestId(_getTagsForExplanationAction);

/**
 * Gets all tags with the specified preset tag IDs (server action)
 *
 * • Retrieves all tags that share any of the provided preset tag IDs
 * • Returns array of tags ordered by name for consistent results
 * • Used by tag dropdown functionality in UI components
 * • Calls: getTagsByPresetId
 * • Used by: TagBar component for preset tag dropdowns
 */
const _getTagsByPresetIdAction = withLogging(
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

export const getTagsByPresetIdAction = serverReadRequestId(_getTagsByPresetIdAction);

/**
 * Get all available tags
 * • Retrieves all tags from the database ordered by name
 * • Returns array of all available tags for selection
 * • Used by tag selection interfaces and add tag functionality
 * • Calls getAllTags service function
 */
const _getAllTagsAction = withLogging(
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

export const getAllTagsAction = serverReadRequestId(_getAllTagsAction);

/**
 * Gets temporary tags for "rewrite with tags" functionality (server action)
 * 
 * • Retrieves two specific preset tags: "medium" (ID 2) and "moderate" (ID 5)
 * • Returns tags with both tag_active_current and tag_active_initial set to true
 * • Used by "rewrite with tags" functionality to start with minimal preset tags
 * • Calls getTempTagsForRewriteWithTags service function
 */
const _getTempTagsForRewriteWithTagsAction = withLogging(
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

export const getTempTagsForRewriteWithTagsAction = serverReadRequestId(_getTempTagsForRewriteWithTagsAction);

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
const _getExplanationMetricsAction = async function(explanationId: number): Promise<ExplanationMetricsTableType | null> {
    const results = await getMultipleExplanationMetrics([explanationId]);
    return results[0];
};

export const getExplanationMetricsAction = serverReadRequestId(_getExplanationMetricsAction);

/**
 * Gets aggregate metrics for multiple explanations (server action)
 *
 * • Efficiently fetches metrics for multiple explanations
 * • Returns metrics in same order as input IDs
 * • Missing explanations return null in the corresponding position
 * • Calls: getMultipleExplanationMetrics
 * • Used by: List views, dashboard components showing multiple explanation stats
 */
const _getMultipleExplanationMetricsAction = async function(explanationIds: number[]): Promise<(ExplanationMetricsTableType | null)[]> {
    return await getMultipleExplanationMetrics(explanationIds);
};

export const getMultipleExplanationMetricsAction = serverReadRequestId(_getMultipleExplanationMetricsAction);

/**
 * Refreshes aggregate metrics for specific explanations or all explanations (server action)
 *
 * • Recalculates total saves, views, and save rate using database stored procedures
 * • Updates explanationMetrics table with fresh data
 * • Returns updated metrics records and count of processed explanations
 * • Calls: refreshExplanationMetrics
 * • Used by: Admin interfaces, manual refresh operations, batch maintenance
 */
const _refreshExplanationMetricsAction = withLogging(
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

export const refreshExplanationMetricsAction = serverReadRequestId(_refreshExplanationMetricsAction);

/**
 * Loads a single vector from Pinecone based on explanation ID (server action)
 *
 * • Queries Pinecone using metadata filter for specific explanation_id
 * • Returns the first vector chunk associated with the explanation
 * • Used by results page to load explanation vector for comparison
 * • Calls: loadFromPineconeUsingExplanationId
 * • Used by: Results page for vector comparison and analysis
 */
const _loadFromPineconeUsingExplanationIdAction = withLogging(
    async function loadFromPineconeUsingExplanationIdAction(params: { explanationId: number; namespace?: string }): Promise<{
        success: boolean;
        data: PineconeVectorMatch | null;
        error: ErrorResponse | null;
    }> {
        try {
            const vector = await loadFromPineconeUsingExplanationId(params.explanationId, params.namespace || 'default');

            logger.debug('Vector loading result:', {
                explanationId: params.explanationId,
                namespace: params.namespace || 'default',
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
                explanationId: params.explanationId,
                namespace: params.namespace || 'default',
                error: error instanceof Error ? error.message : String(error),
                errorType: typeof error,
                errorKeys: error && typeof error === 'object' ? Object.keys(error) : []
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'loadFromPineconeUsingExplanationIdAction', {
                    explanationId: params.explanationId,
                    namespace: params.namespace || 'default'
                })
            };
        }
    },
    'loadFromPineconeUsingExplanationIdAction',
    {
        enabled: FILE_DEBUG
    }
);

export const loadFromPineconeUsingExplanationIdAction = serverReadRequestId(_loadFromPineconeUsingExplanationIdAction);

/**
 * Generates AI suggestions for text improvement (server action)
 *
 * • Creates a prompt using the provided text and improvement type
 * • Calls OpenAI model to generate editing suggestions
 * • Returns the AI response for text improvement
 * • Calls: createAISuggestionPrompt, callOpenAIModel
 * • Used by: Editor test pages for AI-powered text suggestions
 */
const _generateAISuggestionsAction = withLogging(
    async function generateAISuggestionsAction(
        currentText: string,
        userid: string,
        userPrompt: string
    ): Promise<{
        success: boolean;
        data: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const prompt = createAISuggestionPrompt(currentText, userPrompt);

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

export const generateAISuggestionsAction = serverReadRequestId(_generateAISuggestionsAction);

/**
 * Applies AI suggestions to the original content (server action)
 *
 * • Creates a prompt using createApplyEditsPrompt to apply AI suggestions
 * • Calls OpenAI model to generate the final edited text
 * • Returns the complete text with all edits applied
 * • Calls: createApplyEditsPrompt, callOpenAIModel
 * • Used by: Editor test pages to apply AI suggestions to content
 */
const _applyAISuggestionsAction = withLogging(
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
                default_model,
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

export const applyAISuggestionsAction = serverReadRequestId(_applyAISuggestionsAction);

/**
 * Saves content to testing pipeline if it doesn't already exist (server action)
 *
 * • Checks if exact match exists in TESTING_edits_pipeline table
 * • Saves record only if no exact match found
 * • Supports both legacy setName usage and new session metadata
 * • Returns boolean indicating if save was performed
 * • Calls: checkAndSaveTestingPipelineRecord from testingPipeline service
 * • Used by: Editor test pages to track pipeline results at each step
 */
const _saveTestingPipelineStepAction = withLogging(
    async function saveTestingPipelineStepAction(
        setName: string,
        step: string,
        content: string,
        sessionData?: {
            session_id: string;
            explanation_id: number;
            explanation_title: string;
            user_prompt: string;
            source_content: string;
            session_metadata?: SessionMetadata;
        }
    ): Promise<{
        success: boolean;
        data: { saved: boolean; recordId?: number; session_id?: string } | null;
        error: ErrorResponse | null;
    }> {
        try {
            const result = await checkAndSaveTestingPipelineRecord(setName, step, content, sessionData);

            return {
                success: true,
                data: {
                    saved: result.saved,
                    recordId: result.record?.id,
                    session_id: sessionData?.session_id
                },
                error: null
            };
        } catch (error) {
            logger.error('Save Testing Pipeline Step Error', {
                error: error instanceof Error ? error.message : String(error),
                setName,
                step,
                contentLength: content.length,
                hasSessionData: !!sessionData,
                sessionId: sessionData?.session_id
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'saveTestingPipelineStepAction', {
                    setName,
                    step,
                    contentLength: content.length,
                    hasSessionData: !!sessionData
                })
            };
        }
    },
    'saveTestingPipelineStepAction',
    {
        enabled: FILE_DEBUG
    }
);

export const saveTestingPipelineStepAction = serverReadRequestId(_saveTestingPipelineStepAction);

/**
 * Gets testing pipeline records by step (server action)
 *
 * • Retrieves all records from testing_edits_pipeline table for a specific step
 * • Orders by created_at to show most recent first
 * • Returns set_name, content, and metadata for dropdown selection
 * • Calls: getTestingPipelineRecords from testingPipeline service
 * • Used by: Editor test pages to populate dropdowns for loading previous results
 */
const _getTestingPipelineRecordsByStepAction = withLogging(
    async function getTestingPipelineRecordsByStepAction(
        step: string
    ): Promise<{
        success: boolean;
        data: Array<{ id: number; name: string; content: string; created_at: string }> | null;
        error: ErrorResponse | null;
    }> {
        try {
            // Get all records for this step from the database
            const supabase = await createSupabaseServerClient();
            const { data, error } = await supabase
                .from('testing_edits_pipeline')
                .select('id, set_name, content, created_at')
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

            // Map set_name to name for backwards compatibility
            const mappedData = data?.map(record => ({
                id: record.id,
                name: record.set_name,
                content: record.content,
                created_at: record.created_at
            })) || [];

            return {
                success: true,
                data: mappedData,
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

export const getTestingPipelineRecordsByStepAction = serverReadRequestId(_getTestingPipelineRecordsByStepAction);

/**
 * Updates the name for a testing pipeline record (server action)
 *
 * • Updates a single record's name field in testing_edits_pipeline table
 * • Returns success status and updated record data
 * • Calls: updateTestingPipelineRecordSetName from testingPipeline service
 * • Used by: Editor test pages to rename test sets from dropdown UI
 */
const _updateTestingPipelineRecordSetNameAction = withLogging(
    async function updateTestingPipelineRecordSetNameAction(
        recordId: number,
        newSetName: string
    ): Promise<{
        success: boolean;
        data: TestingPipelineRecord | null;
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

export const updateTestingPipelineRecordSetNameAction = serverReadRequestId(_updateTestingPipelineRecordSetNameAction);

/**
 * Gets all AI suggestion sessions for a specific explanation (server action)
 *
 * • Retrieves distinct session records from testing_edits_pipeline table
 * • Filters by explanation_id when provided
 * • Returns session metadata for dropdown selection
 * • Used by: EditorTest page to populate AI suggestion session dropdown
 */
const _getAISuggestionSessionsAction = withLogging(
    async function getAISuggestionSessionsAction(
        explanationId?: number
    ): Promise<{
        success: boolean;
        data: Array<{
            session_id: string;
            explanation_id: number;
            explanation_title: string;
            user_prompt: string;
            created_at: string;
        }> | null;
        error: ErrorResponse | null;
    }> {
        try {
            const supabase = await createSupabaseServerClient();
            let query = supabase
                .from('testing_edits_pipeline')
                .select('session_id, explanation_id, explanation_title, user_prompt, created_at')
                .not('session_id', 'is', null);

            if (explanationId) {
                query = query.eq('explanation_id', explanationId);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Supabase error fetching AI suggestion sessions:', {
                    error: error.message,
                    errorCode: error.code,
                    explanationId
                });
                throw error;
            }

            // Remove duplicates by session_id (keep most recent)
            const uniqueSessions = data?.reduce((acc, session) => {
                if (!acc.some(s => s.session_id === session.session_id)) {
                    acc.push(session);
                }
                return acc;
            }, [] as typeof data) || [];

            return {
                success: true,
                data: uniqueSessions,
                error: null
            };
        } catch (error) {
            logger.error('Get AI Suggestion Sessions Error', {
                error: error instanceof Error ? error.message : String(error),
                explanationId
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'getAISuggestionSessionsAction', { explanationId })
            };
        }
    },
    'getAISuggestionSessionsAction',
    {
        enabled: FILE_DEBUG
    }
);

export const getAISuggestionSessionsAction = serverReadRequestId(_getAISuggestionSessionsAction);

/**
 * Loads all pipeline steps for a specific AI suggestion session (server action)
 *
 * • Retrieves all records from testing_edits_pipeline table for a session_id
 * • Returns all 4 pipeline steps with content and metadata
 * • Used by: EditorTest page to load complete session pipeline
 */
const _loadAISuggestionSessionAction = withLogging(
    async function loadAISuggestionSessionAction(
        sessionId: string
    ): Promise<{
        success: boolean;
        data: {
            session_metadata: {
                session_id: string;
                explanation_id: number;
                explanation_title: string;
                user_prompt: string;
                source_content: string;
            };
            steps: Array<{
                step: string;
                content: string;
                session_metadata: SessionMetadata;
                created_at: string;
            }>;
        } | null;
        error: ErrorResponse | null;
    }> {
        try {
            const supabase = await createSupabaseServerClient();
            const { data, error } = await supabase
                .from('testing_edits_pipeline')
                .select('step, content, session_id, explanation_id, explanation_title, user_prompt, source_content, session_metadata, created_at')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true });

            if (error) {
                logger.error('Supabase error loading AI suggestion session:', {
                    error: error.message,
                    errorCode: error.code,
                    sessionId
                });
                throw error;
            }

            if (!data || data.length === 0) {
                return {
                    success: false,
                    data: null,
                    error: createError(ERROR_CODES.NOT_FOUND, 'Session not found')
                };
            }

            // Extract session metadata from first record (all records have same session data)
            const firstRecord = data[0];
            const sessionMetadata = {
                session_id: firstRecord.session_id!,
                explanation_id: firstRecord.explanation_id!,
                explanation_title: firstRecord.explanation_title!,
                user_prompt: firstRecord.user_prompt!,
                source_content: firstRecord.source_content!
            };

            const steps = data.map(record => ({
                step: record.step,
                content: record.content,
                session_metadata: record.session_metadata,
                created_at: record.created_at
            }));

            return {
                success: true,
                data: {
                    session_metadata: sessionMetadata,
                    steps: steps
                },
                error: null
            };
        } catch (error) {
            logger.error('Load AI Suggestion Session Error', {
                error: error instanceof Error ? error.message : String(error),
                sessionId
            });

            return {
                success: false,
                data: null,
                error: handleError(error, 'loadAISuggestionSessionAction', { sessionId })
            };
        }
    },
    'loadAISuggestionSessionAction',
    {
        enabled: FILE_DEBUG
    }
);

export const loadAISuggestionSessionAction = serverReadRequestId(_loadAISuggestionSessionAction);

// ============================================================================
// LINK WHITELIST CRUD ACTIONS
// ============================================================================

/**
 * Create a new whitelist term (server action)
 *
 * • Creates a new term in the link_whitelist table
 * • Automatically rebuilds the snapshot cache
 * • Used by admin UI for managing whitelisted terms
 */
const _createWhitelistTermAction = withLogging(
    async function createWhitelistTermAction(
        term: LinkWhitelistInsertType
    ): Promise<{
        success: boolean;
        data: LinkWhitelistFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const created = await createWhitelistTerm(term);
            return { success: true, data: created, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'createWhitelistTermAction', { term: term.canonical_term })
            };
        }
    },
    'createWhitelistTermAction',
    { enabled: FILE_DEBUG }
);

export const createWhitelistTermAction = serverReadRequestId(_createWhitelistTermAction);

/**
 * Get all active whitelist terms (server action)
 *
 * • Fetches all active terms from link_whitelist table
 * • Used by admin UI to display whitelist
 */
const _getAllWhitelistTermsAction = withLogging(
    async function getAllWhitelistTermsAction(): Promise<{
        success: boolean;
        data: LinkWhitelistFullType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const terms = await getAllActiveWhitelistTerms();
            return { success: true, data: terms, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getAllWhitelistTermsAction', {})
            };
        }
    },
    'getAllWhitelistTermsAction',
    { enabled: FILE_DEBUG }
);

export const getAllWhitelistTermsAction = serverReadRequestId(_getAllWhitelistTermsAction);

/**
 * Get a whitelist term by ID (server action)
 *
 * • Fetches a single term by ID from link_whitelist table
 * • Used by admin UI for editing a term
 */
const _getWhitelistTermByIdAction = withLogging(
    async function getWhitelistTermByIdAction(id: number): Promise<{
        success: boolean;
        data: LinkWhitelistFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const term = await getWhitelistTermById(id);
            return { success: true, data: term, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getWhitelistTermByIdAction', { id })
            };
        }
    },
    'getWhitelistTermByIdAction',
    { enabled: FILE_DEBUG }
);

export const getWhitelistTermByIdAction = serverReadRequestId(_getWhitelistTermByIdAction);

/**
 * Update a whitelist term (server action)
 *
 * • Updates an existing term in link_whitelist table
 * • Automatically rebuilds the snapshot cache
 * • Used by admin UI for editing terms
 */
const _updateWhitelistTermAction = withLogging(
    async function updateWhitelistTermAction(
        id: number,
        updates: Partial<LinkWhitelistInsertType>
    ): Promise<{
        success: boolean;
        data: LinkWhitelistFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const updated = await updateWhitelistTerm(id, updates);
            return { success: true, data: updated, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'updateWhitelistTermAction', { id, updates })
            };
        }
    },
    'updateWhitelistTermAction',
    { enabled: FILE_DEBUG }
);

export const updateWhitelistTermAction = serverReadRequestId(_updateWhitelistTermAction);

/**
 * Delete a whitelist term (server action)
 *
 * • Deletes a term from link_whitelist table (cascades to aliases)
 * • Automatically rebuilds the snapshot cache
 * • Used by admin UI for removing terms
 */
const _deleteWhitelistTermAction = withLogging(
    async function deleteWhitelistTermAction(id: number): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await deleteWhitelistTerm(id);
            return { success: true, error: null };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'deleteWhitelistTermAction', { id })
            };
        }
    },
    'deleteWhitelistTermAction',
    { enabled: FILE_DEBUG }
);

export const deleteWhitelistTermAction = serverReadRequestId(_deleteWhitelistTermAction);

// ============================================================================
// ALIAS CRUD ACTIONS
// ============================================================================

/**
 * Add aliases to a whitelist term (server action)
 *
 * • Creates new aliases for a whitelist term
 * • Deduplicates and skips existing aliases
 * • Automatically rebuilds the snapshot cache
 */
const _addAliasesAction = withLogging(
    async function addAliasesAction(
        whitelistId: number,
        aliases: string[]
    ): Promise<{
        success: boolean;
        data: LinkAliasFullType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const created = await addAliases(whitelistId, aliases);
            return { success: true, data: created, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'addAliasesAction', { whitelistId, aliasCount: aliases.length })
            };
        }
    },
    'addAliasesAction',
    { enabled: FILE_DEBUG }
);

export const addAliasesAction = serverReadRequestId(_addAliasesAction);

/**
 * Remove an alias (server action)
 *
 * • Deletes an alias from link_whitelist_aliases table
 * • Automatically rebuilds the snapshot cache
 */
const _removeAliasAction = withLogging(
    async function removeAliasAction(aliasId: number): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await removeAlias(aliasId);
            return { success: true, error: null };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'removeAliasAction', { aliasId })
            };
        }
    },
    'removeAliasAction',
    { enabled: FILE_DEBUG }
);

export const removeAliasAction = serverReadRequestId(_removeAliasAction);

/**
 * Get aliases for a whitelist term (server action)
 *
 * • Fetches all aliases for a whitelist term
 * • Used by admin UI for managing aliases
 */
const _getAliasesForTermAction = withLogging(
    async function getAliasesForTermAction(whitelistId: number): Promise<{
        success: boolean;
        data: LinkAliasFullType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const aliases = await getAliasesForTerm(whitelistId);
            return { success: true, data: aliases, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getAliasesForTermAction', { whitelistId })
            };
        }
    },
    'getAliasesForTermAction',
    { enabled: FILE_DEBUG }
);

export const getAliasesForTermAction = serverReadRequestId(_getAliasesForTermAction);

// ============================================================================
// LINK CANDIDATE ACTIONS
// ============================================================================

/**
 * Get all link candidates (server action)
 *
 * • Fetches all candidates, optionally filtered by status
 * • Ordered by total_occurrences DESC
 * • Used by admin UI for candidate queue
 */
const _getAllCandidatesAction = withLogging(
    async function getAllCandidatesAction(
        status?: CandidateStatus
    ): Promise<{
        success: boolean;
        data: LinkCandidateFullType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const candidates = await getAllCandidates(status);
            return { success: true, data: candidates, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getAllCandidatesAction', { status })
            };
        }
    },
    'getAllCandidatesAction',
    { enabled: FILE_DEBUG }
);

export const getAllCandidatesAction = serverReadRequestId(_getAllCandidatesAction);

/**
 * Get a candidate by ID (server action)
 *
 * • Fetches a single candidate by ID
 * • Used by admin UI for viewing candidate details
 */
const _getCandidateByIdAction = withLogging(
    async function getCandidateByIdAction(id: number): Promise<{
        success: boolean;
        data: LinkCandidateFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const candidate = await getCandidateById(id);
            return { success: true, data: candidate, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getCandidateByIdAction', { id })
            };
        }
    },
    'getCandidateByIdAction',
    { enabled: FILE_DEBUG }
);

export const getCandidateByIdAction = serverReadRequestId(_getCandidateByIdAction);

/**
 * Approve a candidate (server action)
 *
 * • Creates a whitelist entry with the provided standalone_title
 * • Updates candidate status to 'approved'
 * • Used by admin UI to promote candidates to whitelist
 */
const _approveCandidateAction = withLogging(
    async function approveCandidateAction(
        id: number,
        standaloneTitle: string
    ): Promise<{
        success: boolean;
        data: LinkCandidateFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const approved = await approveCandidate(id, standaloneTitle);
            return { success: true, data: approved, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'approveCandidateAction', { id, standaloneTitle })
            };
        }
    },
    'approveCandidateAction',
    { enabled: FILE_DEBUG }
);

export const approveCandidateAction = serverReadRequestId(_approveCandidateAction);

/**
 * Reject a candidate (server action)
 *
 * • Updates candidate status to 'rejected'
 * • Candidate is kept for deduplication
 * • Used by admin UI to reject candidates
 */
const _rejectCandidateAction = withLogging(
    async function rejectCandidateAction(id: number): Promise<{
        success: boolean;
        data: LinkCandidateFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const rejected = await rejectCandidate(id);
            return { success: true, data: rejected, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'rejectCandidateAction', { id })
            };
        }
    },
    'rejectCandidateAction',
    { enabled: FILE_DEBUG }
);

export const rejectCandidateAction = serverReadRequestId(_rejectCandidateAction);

/**
 * Delete a candidate (server action)
 *
 * • Permanently deletes a candidate and its occurrences
 * • Used by admin UI for removing candidates
 */
const _deleteCandidateAction = withLogging(
    async function deleteCandidateAction(id: number): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await deleteCandidate(id);
            return { success: true, error: null };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'deleteCandidateAction', { id })
            };
        }
    },
    'deleteCandidateAction',
    { enabled: FILE_DEBUG }
);

export const deleteCandidateAction = serverReadRequestId(_deleteCandidateAction);

// ============================================================================
// ARTICLE LINK OVERRIDE ACTIONS
// ============================================================================

/**
 * Set an override for a term in a specific article (server action)
 *
 * • Creates or updates an override in article_link_overrides table
 * • overrideType: 'custom_title' (provide customTitle) or 'disabled' (hide link)
 */
const _setArticleLinkOverrideAction = withLogging(
    async function setArticleLinkOverrideAction(
        explanationId: number,
        term: string,
        overrideType: 'custom_title' | 'disabled',
        customTitle?: string
    ): Promise<{
        success: boolean;
        data: ArticleLinkOverrideFullType | null;
        error: ErrorResponse | null;
    }> {
        try {
            const override = await setOverride(explanationId, term, overrideType, customTitle);
            return { success: true, data: override, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'setArticleLinkOverrideAction', { explanationId, term, overrideType })
            };
        }
    },
    'setArticleLinkOverrideAction',
    { enabled: FILE_DEBUG }
);

export const setArticleLinkOverrideAction = serverReadRequestId(_setArticleLinkOverrideAction);

/**
 * Remove an override for a term in a specific article (server action)
 *
 * • Deletes the override, reverting to global default behavior
 */
const _removeArticleLinkOverrideAction = withLogging(
    async function removeArticleLinkOverrideAction(
        explanationId: number,
        term: string
    ): Promise<{
        success: boolean;
        error: ErrorResponse | null;
    }> {
        try {
            await removeOverride(explanationId, term);
            return { success: true, error: null };
        } catch (error) {
            return {
                success: false,
                error: handleError(error, 'removeArticleLinkOverrideAction', { explanationId, term })
            };
        }
    },
    'removeArticleLinkOverrideAction',
    { enabled: FILE_DEBUG }
);

export const removeArticleLinkOverrideAction = serverReadRequestId(_removeArticleLinkOverrideAction);

/**
 * Get all overrides for an article (server action)
 *
 * • Fetches all overrides for a specific explanation
 * • Returns as array for easier consumption in UI
 */
const _getArticleLinkOverridesAction = withLogging(
    async function getArticleLinkOverridesAction(explanationId: number): Promise<{
        success: boolean;
        data: ArticleLinkOverrideFullType[] | null;
        error: ErrorResponse | null;
    }> {
        try {
            const overridesMap = await getOverridesForArticle(explanationId);
            const overrides = Array.from(overridesMap.values());
            return { success: true, data: overrides, error: null };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'getArticleLinkOverridesAction', { explanationId })
            };
        }
    },
    'getArticleLinkOverridesAction',
    { enabled: FILE_DEBUG }
);

export const getArticleLinkOverridesAction = serverReadRequestId(_getArticleLinkOverridesAction);

