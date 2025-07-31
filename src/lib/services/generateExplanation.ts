import { callOpenAIModel } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { explanationBaseType, explanationBaseSchema, MatchMode, UserInputType, titleQuerySchema } from '@/lib/schemas/schemas';
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';
import { matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { findMatches, enhanceMatchesWithCurrentContent } from '@/lib/services/findMatches';
import { handleError, createError, createInputError, createValidationError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { withLoggingAndTracing, withLogging } from '@/lib/functionLogger';
import { logger } from '@/lib/client_utilities';
import { createMappingsHeadingsToLinks, createMappingsKeytermsToLinks, cleanupAfterEnhancements } from '@/lib/services/links';
import { evaluateExplanationDifficulty } from '@/lib/services/tagEvaluation';
import { 
  saveExplanationAndTopic, 
  saveUserQuery, 
  addTagsToExplanationAction 
} from '@/actions/actions';

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
                const result = await callOpenAIModel(formattedPrompt, "generateNewExplanation", userid, "gpt-4o-mini", false, null, explanationBaseSchema, 'llmQuery');
                
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