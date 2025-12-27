/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt, editExplanationPrompt, createLinkCandidatesPrompt, createExplanationWithSourcesPrompt, editExplanationWithSourcesPrompt } from '@/lib/prompts';
import { explanationBaseType, explanationBaseSchema, MatchMode, UserInputType, titleQuerySchema, AnchorSet, linkCandidatesExtractionSchema, type SourceCacheFullType, type SourceForPromptType } from '@/lib/schemas/schemas';
import { findMatchesInVectorDb, maxNumberAnchors, calculateAllowedScores, searchForSimilarVectors } from '@/lib/services/vectorsim';
import { matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { findBestMatchFromList, enhanceMatchesWithCurrentContentAndDiversity } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLoggingAndTracing, withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { logger } from '@/lib/client_utilities';
import { cleanupAfterEnhancements } from '@/lib/services/links';
import { evaluateTags } from '@/lib/services/tagEvaluation';
import { generateHeadingStandaloneTitles, saveHeadingLinks } from '@/lib/services/linkWhitelist';
import { saveCandidatesFromLLM } from '@/lib/services/linkCandidates';
import { linkSourcesToExplanation } from '@/lib/services/sourceCache';
import {
  saveExplanationAndTopic,
  saveUserQuery,
  addTagsToExplanationAction
} from '@/actions/actions';

// Simple streaming callback for text content
export type StreamingCallback = (content: string) => void;

const FILE_DEBUG = true;
const MIN_SIMILARITY_INDEX = 0;

/**
 * Key points:
 * - Generates article title from user query using LLM
 * - Validates the response format and returns first title
 * - Used by returnExplanation for title creation
 * - Calls createTitlePrompt, callOpenAIModel
 */
export const generateTitleFromUserQuery = withLogging(
    async function generateTitleFromUserQuery(userQuery: string, userid:string): Promise<{
        success: boolean;
        title: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callOpenAIModel(titlePrompt, "generateTitleFromUserQuery", userid, default_model, false, null, titleQuerySchema, 'titleQuery');
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
 * Extracts link candidates from article content using LLM
 *
 * Key responsibilities:
 * - Calls LLM with structured output to identify 5-15 educational terms
 * - Returns array of candidate terms for whitelist consideration
 * - Runs in parallel with other postprocessing tasks
 *
 * Used by: postprocessNewExplanationContent
 * Calls: callOpenAIModel with linkCandidatesExtractionSchema
 */
export const extractLinkCandidates = withLogging(
    async function extractLinkCandidates(
        content: string,
        articleTitle: string,
        userid: string
    ): Promise<string[]> {
        try {
            const prompt = createLinkCandidatesPrompt(content, articleTitle);

            const aiResponse = await callOpenAIModel(
                prompt,
                'extractLinkCandidates',
                userid,
                default_model,
                false,
                null,
                linkCandidatesExtractionSchema,
                'linkCandidatesExtraction',
                FILE_DEBUG
            );

            const parsedResponse = JSON.parse(aiResponse);
            const candidates = parsedResponse.candidates || [];

            logger.debug('Extracted link candidates', {
                articleTitle,
                candidateCount: candidates.length,
                candidates: candidates.slice(0, 5) // Log first 5 for debugging
            });

            return candidates;
        } catch (error) {
            logger.error('Error extracting link candidates', {
                articleTitle,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    },
    'extractLinkCandidates',
    {
        enabled: FILE_DEBUG
    }
);

/**
 * Postprocesses explanation content by generating heading standalone titles, evaluating tags, extracting link candidates, and validating the result
 *
 * Key responsibilities:
 * - Generates heading standalone titles, evaluates tags, and extracts link candidates in parallel
 * - Cleans up formatting and removes unwanted patterns
 * - Returns enhanced content, heading titles (for DB storage), tag evaluation, and link candidates
 *
 * Note: Key term links are now resolved at render time via linkResolver service
 *
 * Used by: generateNewExplanation
 * Calls: generateHeadingStandaloneTitles, evaluateTags, extractLinkCandidates, cleanupAfterEnhancements
 */
export const postprocessNewExplanationContent = withLogging(
    async function postprocessExplanationContent(
        rawContent: string,
        titleResult: string,
        userid: string
    ): Promise<{
        enhancedContent: string;
        tagEvaluation: any;
        headingTitles: Record<string, string>;
        linkCandidates: string[];
        error: ErrorResponse | null;
    }> {
        try {
            // Generate heading standalone titles, evaluate tags, and extract link candidates in parallel
            // Key term links are now resolved at render time via linkResolver
            const [headingTitles, tagEvaluation, linkCandidates] = await Promise.all([
                generateHeadingStandaloneTitles(rawContent, titleResult, userid, FILE_DEBUG),
                evaluateTags(titleResult, rawContent, userid),
                extractLinkCandidates(rawContent, titleResult, userid)
            ]);

            // Clean up any remaining **bold** patterns
            const enhancedContent = cleanupAfterEnhancements(rawContent);

            logger.debug('Content postprocessing completed', {
                originalContentLength: rawContent.length,
                enhancedContentLength: enhancedContent.length,
                headingTitlesCount: Object.keys(headingTitles).length,
                hasTagEvaluation: !!tagEvaluation,
                linkCandidatesCount: linkCandidates.length
            });

            return {
                enhancedContent,
                tagEvaluation,
                headingTitles,
                linkCandidates,
                error: null
            };
        } catch (error) {
            return {
                enhancedContent: '',
                tagEvaluation: null,
                headingTitles: {},
                linkCandidates: [],
                error: handleError(error, 'postprocessExplanationContent', {
                    titleResult,
                    contentLength: rawContent.length
                })
            };
        }
    },
    'postprocessExplanationContent',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Generates a new explanation using AI and enhances it with links and tags
 * 
 * Key responsibilities:
 * - Selects appropriate prompt based on userInputType (create vs edit)
 * - Calls OpenAI model to generate explanation content
 * - Postprocesses content to add links and evaluate tags
 * - Validates the final explanation data
 * - Returns enhanced explanation data or error
 * 
 * Used by: returnExplanationLogic
 * Calls: callOpenAIModel, postprocessExplanationContent
 */
export const generateNewExplanation = withLogging(
    async function generateNewExplanation(
        titleResult: string,
        additionalRules: string[],
        userInputType: UserInputType,
        userid: string,
        existingContent?: string,
        onStreamingText?: StreamingCallback,
        sources?: SourceForPromptType[]
    ): Promise<{
        explanationData: explanationBaseType | null;
        error: ErrorResponse | null;
        tagEvaluation?: any;
        headingTitles?: Record<string, string>;
        linkCandidates?: string[];
    }> {
        try {
            // Choose prompt function based on userInputType and sources
            // Decision matrix:
            // | UserInputType | Sources? | ExistingContent? | Prompt Function |
            // |---------------|----------|------------------|-----------------|
            // | EditWithTags  | Yes      | Yes              | editExplanationWithSourcesPrompt |
            // | Any           | Yes      | No               | createExplanationWithSourcesPrompt |
            // | EditWithTags  | No       | Yes              | editExplanationPrompt |
            // | Other         | No       | —                | createExplanationPrompt |
            let formattedPrompt: string;

            if (sources && sources.length > 0) {
                // Sources provided - check if edit or rewrite
                if (userInputType === UserInputType.EditWithTags && existingContent) {
                    formattedPrompt = editExplanationWithSourcesPrompt(titleResult, sources, additionalRules, existingContent);
                    logger.debug('Using editExplanationWithSourcesPrompt for EditWithTags + sources', {
                        titleResult,
                        additionalRulesCount: additionalRules.length,
                        sourceCount: sources.length,
                        hasExistingContent: !!existingContent
                    });
                } else {
                    formattedPrompt = createExplanationWithSourcesPrompt(titleResult, sources, additionalRules);
                    logger.debug('Using createExplanationWithSourcesPrompt with sources', {
                        titleResult,
                        additionalRulesCount: additionalRules.length,
                        sourceCount: sources.length
                    });
                }
            } else if (userInputType === UserInputType.EditWithTags && existingContent) {
                formattedPrompt = editExplanationPrompt(titleResult, additionalRules, existingContent);
                logger.debug('Using editExplanationPrompt for EditWithTags mode', {
                    titleResult,
                    additionalRulesCount: additionalRules.length,
                    hasExistingContent: !!existingContent
                });
            } else {
                formattedPrompt = createExplanationPrompt(titleResult, additionalRules);
                logger.debug('Using createExplanationPrompt for standard mode', {
                    titleResult,
                    additionalRulesCount: additionalRules.length
                });
            }
            
            // Log tag rules for debugging
            if (additionalRules.length > 0) {
                logger.debug('Using tag rules for explanation generation', {
                    rules: additionalRules
                });
            }
            
            // Determine if we should stream based on presence of callback
            const shouldStream = onStreamingText !== undefined;
            
            const newExplanationContent = await callOpenAIModel(
                formattedPrompt, 
                "generateNewExplanation", 
                userid, 
                default_model, 
                shouldStream, 
                shouldStream ? onStreamingText : null, 
                null, 
                'llmQuery'
            );

            // Postprocess the content to add links, evaluate tags, and extract link candidates
            const { enhancedContent, tagEvaluation, headingTitles, linkCandidates, error: postprocessError } = await postprocessNewExplanationContent(
                newExplanationContent,
                titleResult,
                userid
            );

            if (postprocessError) {
                return {
                    explanationData: null,
                    error: postprocessError,
                    tagEvaluation: undefined,
                    headingTitles: undefined,
                    linkCandidates: undefined
                };
            }

            const newExplanationData = {
                explanation_title: titleResult,
                content: enhancedContent,
            };

            const validatedUserQuery = explanationBaseSchema.safeParse(newExplanationData);

            if (!validatedUserQuery.success) {
                return {
                    explanationData: null,
                    error: createValidationError('Generated response does not match user query schema', validatedUserQuery.error),
                    tagEvaluation: undefined,
                    headingTitles: undefined,
                    linkCandidates: undefined
                };
            }

            return {
                explanationData: newExplanationData,
                error: null,
                tagEvaluation,
                headingTitles,
                linkCandidates
            };
        } catch (error) {
            return {
                explanationData: null,
                error: handleError(error, 'generateNewExplanation', {
                    titleResult,
                    userInputType,
                    additionalRulesCount: additionalRules.length
                }),
                tagEvaluation: undefined,
                headingTitles: undefined,
                linkCandidates: undefined
            };
        }
    },
    'generateNewExplanation',
    { 
        enabled: FILE_DEBUG
    }
);

/**
 * Applies tags to an explanation based on AI evaluation
 * 
 * Key responsibilities:
 * - Takes tag evaluation results and applies them to explanation
 * - Handles difficulty, length, and simple tags
 * - Logs success/failure of tag application
 * - Gracefully handles errors without breaking main flow
 * 
 * Used by: returnExplanationLogic
 * Calls: addTagsToExplanationAction
 */
export const applyTagsToExplanation = withLogging(
    async function applyTagsToExplanation(
        explanationId: number,
        tagEvaluation: any,
        _userid: string
    ): Promise<void> {
        try {
            if (!tagEvaluation || tagEvaluation.error) {
                logger.debug('No valid tag evaluation to apply', {
                    explanationId,
                    hasTagEvaluation: !!tagEvaluation,
                    hasError: tagEvaluation?.error
                }, FILE_DEBUG);
                return;
            }

            const tagsToApply: number[] = [];
            
            // Add difficulty tag if available
            if (tagEvaluation.difficultyLevel) {
                tagsToApply.push(tagEvaluation.difficultyLevel);
            }
            
            // Add length tag if available
            if (tagEvaluation.length) {
                tagsToApply.push(tagEvaluation.length);
            }
            
            // Add simple tags if available
            if (tagEvaluation.simpleTags && tagEvaluation.simpleTags.length > 0) {
                tagsToApply.push(...tagEvaluation.simpleTags);
            }
            
            if (tagsToApply.length > 0) {
                const tagResult = await addTagsToExplanationAction(explanationId, tagsToApply);
                if (tagResult.error) {
                    logger.error('Failed to apply tags to explanation', {
                        explanationId,
                        tags: tagsToApply,
                        error: tagResult.error
                    });
                } else {
                    logger.debug('Successfully applied tags to explanation', {
                        explanationId,
                        tags: tagsToApply
                    });
                }
            } else {
                logger.debug('No tags to apply to explanation', {
                    explanationId,
                    tagEvaluation
                });
            }
        } catch (error) {
            logger.error('Error applying tags to explanation', {
                explanationId,
                tags: tagEvaluation,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    'applyTagsToExplanation',
    { 
        enabled: FILE_DEBUG
    }
);

export const returnExplanationLogic = withLoggingAndTracing(
    async function returnExplanationLogic(
        userInput: string,
        savedId: number | null,
        matchMode: MatchMode,
        userid: string,
        userInputType: UserInputType,
        additionalRules: string[],
        onStreamingText?: StreamingCallback,
        existingContent?: string,
        previousExplanationViewedId?: number | null,
        previousExplanationViewedVector?: { values: number[] } | null, // Pinecone match object with embedding values for context in rewrite operations
        sources?: SourceCacheFullType[] // Optional sources for citation-grounded explanations
    ): Promise<{
        originalUserInput: string,
        match_found: boolean | null,
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
                
                // Send progress event when title is generated
                if (onStreamingText) {
                    const progressData = {
                        type: 'progress',
                        stage: 'title_generated',
                        title: titleResult
                    };
                    logger.debug('Sending title_generated progress event', progressData, true);
                    onStreamingText(JSON.stringify(progressData));
                }
            } else {
                // For TitleFromLink, TitleFromRegenerate, RewriteWithTags, EditWithTags, and any other types
                // use the userInput directly as the title
                // The additionalRules parameter will contain the tag descriptions for rewrite/edit modes
                titleResult = userInput;
                
                // Send progress event for non-query input types
                if (onStreamingText) {
                    const progressData = {
                        type: 'progress',
                        stage: 'title_direct',
                        title: titleResult,
                        userInputType: userInputType
                    };
                    logger.debug('Sending title_direct progress event', progressData, true);
                    onStreamingText(JSON.stringify(progressData));
                }
            }
            // Send progress event for searching matches
            if (onStreamingText) {
                const progressData = {
                    type: 'progress',
                    stage: 'searching_matches',
                    title: titleResult
                };
                logger.debug('Sending searching_matches progress event', progressData, true);
                onStreamingText(JSON.stringify(progressData));
            }
            
            // Run anchorComparison, similarTexts, and diversityComparison in parallel
            const [similarTexts, anchorComparison, diversityComparison] = await Promise.all([
                findMatchesInVectorDb(titleResult, false, null),
                findMatchesInVectorDb(titleResult, true, AnchorSet.Main, maxNumberAnchors),
                // Extract embedding values from Pinecone match object - previousExplanationViewedVector is a Pinecone match object with a 'values' property
                (async () => {
                    if (previousExplanationViewedVector && previousExplanationViewedVector.values) {
                        return await searchForSimilarVectors(previousExplanationViewedVector.values, false, null);
                    } else {
                        return [];
                    }
                })()
            ]);
            
            // Calculate allowed scores
            const allowedScores = await calculateAllowedScores(anchorComparison, similarTexts);
            
            // Check if title is allowed
            if (!allowedScores.allowedTitle) {
                // Save user query with allowedQuery = false
                let userQueryId: number | null = null;
                if (userid) {
                    const { error: userQueryError, id: savedUserQueryId } = await saveUserQuery(userInput, [], null, userid, false, userInputType, false, previousExplanationViewedId ?? null);
                    if (!userQueryError) {
                        userQueryId = savedUserQueryId;
                    }
                }
                
                return {
                    originalUserInput: userInput,
                    match_found: null,
                    error: createError(ERROR_CODES.QUERY_NOT_ALLOWED, 'Query not allowed'),
                    explanationId: null,
                    matches: [],
                    data: null,
                    userQueryId: userQueryId,
                    userInputType
                };
            }
            
            // Chain dependent operations
            const matches = await enhanceMatchesWithCurrentContentAndDiversity(similarTexts, diversityComparison);
            const bestSourceResult = await findBestMatchFromList(titleResult, matches, matchMode, savedId, userid);

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
                // Convert sources to prompt format if provided
                const sourcesForPrompt: SourceForPromptType[] | undefined = sources?.map((source, index) => ({
                    index: index + 1,
                    title: source.title || source.domain,
                    domain: source.domain,
                    content: source.extracted_text || '',
                    isVerbatim: !source.is_summarized
                })).filter(s => s.content.length > 0);

                // Generate new explanation using the extracted function
                const { explanationData: newExplanationData, error: generationError, tagEvaluation, headingTitles, linkCandidates } = await generateNewExplanation(
                    titleResult,
                    additionalRules,
                    userInputType,
                    userid,
                    existingContent,
                    onStreamingText,
                    sourcesForPrompt
                );

                if (generationError) {
                    return {
                        originalUserInput: userInput,
                        match_found: null,
                        error: generationError,
                        explanationId: null,
                        matches: matches,
                        data: null,
                        userQueryId: null,
                        userInputType
                    };
                }

                // Save the generated explanation
                const { error: explanationTopicError, id: newExplanationId } = await saveExplanationAndTopic(userInput, newExplanationData!);

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

                // Save heading links to DB (for link overlay system)
                if (headingTitles && Object.keys(headingTitles).length > 0) {
                    await saveHeadingLinks(newExplanationId, headingTitles);
                }

                // Apply tags if evaluation was successful
                if (tagEvaluation && !tagEvaluation.error) {
                    await applyTagsToExplanation(newExplanationId, tagEvaluation, userid);
                }

                // Save link candidates for admin approval queue
                if (linkCandidates && linkCandidates.length > 0) {
                    await saveCandidatesFromLLM(newExplanationId, newExplanationData!.content, linkCandidates, FILE_DEBUG);
                }

                // Link sources to the explanation if provided
                if (sources && sources.length > 0) {
                    const sourceIds = sources.map(s => s.id);
                    await linkSourcesToExplanation(newExplanationId, sourceIds);
                    logger.debug('Linked sources to explanation', {
                        explanationId: newExplanationId,
                        sourceCount: sources.length,
                        sourceIds
                    });
                }
            }

            // Save user query once - works for both match and new explanation cases
            let userQueryId: number | null = null;
            if (finalExplanationId && userid) {
                
                const { error: userQueryError, id: savedUserQueryId } = await saveUserQuery(userInput, matches, finalExplanationId, userid, !isMatchFound, userInputType, true, previousExplanationViewedId ?? null);
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
                error: handleError(error, 'returnExplanation', { userInput, matchMode, savedId, userid, userInputType }),
                explanationId: null,
                matches: [],
                data: null,
                userQueryId: null,
                userInputType
            };
        }
    },
    'returnExplanation',
    { 
        enabled: FILE_DEBUG
    },
    {
        enabled: true,
        customAttributes: {
            'business.operation': 'returnExplanation',
            'business.context': 'ai_explanation_generation'
        }
    }
);