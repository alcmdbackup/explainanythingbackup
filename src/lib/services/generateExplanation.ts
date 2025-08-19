import { callOpenAIModel } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt, editExplanationPrompt } from '@/lib/prompts';
import { explanationBaseType, explanationBaseSchema, MatchMode, UserInputType, titleQuerySchema, AnchorSet } from '@/lib/schemas/schemas';
import { findMatchesInVectorDb, maxNumberAnchors, calculateAllowedScores, searchForSimilarVectors } from '@/lib/services/vectorsim';
import { matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { findMatches, enhanceMatchesWithCurrentContentAndDiversity } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLoggingAndTracing, withLogging } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { createMappingsHeadingsToLinks, createMappingsKeytermsToLinks, cleanupAfterEnhancements } from '@/lib/services/links';
import { evaluateTags } from '@/lib/services/tagEvaluation';
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
 * - Used by generateExplanation for title creation
 * - Calls createTitlePrompt, callOpenAIModel
 * - Used by generateExplanation
 */
export const generateTitleFromUserQuery = withLogging(
    async function generateTitleFromUserQuery(userQuery: string, userid:string): Promise<{
        success: boolean;
        title: string | null;
        error: ErrorResponse | null;
    }> {
        try {
            const titlePrompt = createTitlePrompt(userQuery);
            const titleResult = await callOpenAIModel(titlePrompt, "generateTitleFromUserQuery", userid, "gpt-4o-mini", false, null, titleQuerySchema, 'titleQuery');
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
 * Replaces all occurrences of a term in content while skipping lines that start with ##
 */
function replaceAllExceptHeadings(content: string, originalTerm: string, replacementTerm: string): string {
    const lines = content.split('\n');
    const processedLines = lines.map(line => {
        // Skip lines that start with ## (headings)
        if (line.trim().startsWith('##')) {
            return line;
        }
        return line.replaceAll(originalTerm, replacementTerm);
    });
    return processedLines.join('\n');
}

export const generateExplanationLogic = withLoggingAndTracing(
    async function generateExplanationLogic(
        userInput: string,
        savedId: number | null,
        matchMode: MatchMode,
        userid: string,
        userInputType: UserInputType,
        additionalRules: string[],
        onStreamingText?: StreamingCallback,
        existingContent?: string,
        previousExplanationViewedId?: number | null,
        previousExplanationViewedVector?: { values: number[] } | null // Pinecone match object with embedding values for context in rewrite operations
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
                // For TitleFromLink, TitleFromRegenerate, RewriteWithTags, EditWithTags, and any other types
                // use the userInput directly as the title
                // The additionalRules parameter will contain the tag descriptions for rewrite/edit modes
                titleResult = userInput;
            }
            // Run anchorComparison, similarTexts, and diversityComparison in parallel
            const [similarTexts, anchorComparison, diversityComparison] = await Promise.all([
                findMatchesInVectorDb(titleResult, false, null),
                findMatchesInVectorDb(titleResult, true, AnchorSet.Main, maxNumberAnchors),
                // Extract embedding values from Pinecone match object - previousExplanationViewedVector is a Pinecone match object with a 'values' property
                previousExplanationViewedVector && previousExplanationViewedVector.values ? searchForSimilarVectors(previousExplanationViewedVector.values, false, null) : Promise.resolve([])
            ]);
            
            // Log debug information about the previous explanation vector
            if (previousExplanationViewedVector) {
                logger.debug('Previous explanation vector details:', {
                    hasValues: !!previousExplanationViewedVector.values,
                    valuesType: typeof previousExplanationViewedVector.values,
                    isArray: Array.isArray(previousExplanationViewedVector.values),
                    valuesLength: previousExplanationViewedVector.values?.length
                }, FILE_DEBUG);
            }
            
            // Calculate allowed scores
            const allowedScores = await calculateAllowedScores(anchorComparison, similarTexts);
            
            logger.debug('Allowed scores for title:', {
                titleResult,
                anchorScore: allowedScores.anchorScore,
                explanationScore: allowedScores.explanationScore,
                allowedTitle: allowedScores.allowedTitle
            }, FILE_DEBUG);
            
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
                // Choose prompt function based on userInputType
                let formattedPrompt: string;
                
                if (userInputType === UserInputType.EditWithTags && existingContent) {
                    formattedPrompt = editExplanationPrompt(titleResult, additionalRules, existingContent);
                    console.log('Using editExplanationPrompt for EditWithTags mode');
                } else {
                    formattedPrompt = createExplanationPrompt(titleResult, additionalRules);
                    console.log('Using createExplanationPrompt for standard mode');
                }
                
                // Add console debugging for tag rules
                if (additionalRules.length > 0) {
                    console.log('Using tag rules for explanation generation:', additionalRules);
                }
                
                // Determine if we should stream based on presence of callback
                const shouldStream = onStreamingText !== undefined;
                
                const result = await callOpenAIModel(
                    formattedPrompt, 
                    "generateNewExplanation", 
                    userid, 
                    "gpt-4o-mini", 
                    shouldStream, 
                    shouldStream ? onStreamingText : null, 
                    explanationBaseSchema, 
                    'llmQuery'
                );
                
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

                // Run enhancement functions and tag evaluation in parallel
                const [headingMappings, keyTermMappings, tagEvaluation] = await Promise.all([
                    createMappingsHeadingsToLinks(parsedResult.data.content, titleResult, userid, FILE_DEBUG),
                    createMappingsKeytermsToLinks(parsedResult.data.content, userid, FILE_DEBUG),
                    evaluateTags(titleResult, parsedResult.data.content, userid)
                ]);
                
                // Apply both heading and key term mappings to the content
                let enhancedContent = parsedResult.data.content;
                
                // Apply heading mappings first
                for (const [originalHeading, linkedHeading] of Object.entries(headingMappings)) {
                    enhancedContent = enhancedContent.replace(originalHeading, linkedHeading);
                }
                
                // Apply key term mappings second (only to non-heading lines
                // This is to prevent bugs in formatting 
                for (const [originalKeyTerm, linkedKeyTerm] of Object.entries(keyTermMappings)) {
                    enhancedContent = replaceAllExceptHeadings(enhancedContent, originalKeyTerm, linkedKeyTerm);
                }
                
                // Clean up any remaining **bold** patterns
                enhancedContent = cleanupAfterEnhancements(enhancedContent);

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
                
                // Apply tags if evaluation was successful
                if (tagEvaluation && !tagEvaluation.error) {
                    try {
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
                            const tagResult = await addTagsToExplanationAction(newExplanationId, tagsToApply);
                            if (tagResult.error) {
                                logger.error('Failed to apply tags to explanation', {
                                    explanationId: newExplanationId,
                                    tags: tagsToApply,
                                    error: tagResult.error
                                });
                            } else {
                                logger.debug('Successfully applied tags to explanation', {
                                    explanationId: newExplanationId,
                                    tags: tagsToApply
                                });
                            }
                        }
                    } catch (error) {
                        logger.error('Error applying tags to explanation', {
                            explanationId: newExplanationId,
                            tags: tagEvaluation,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                    }
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