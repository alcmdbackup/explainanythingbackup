'use client';

import { useState, useCallback } from 'react';
import {
    getExplanationByIdAction,
    isExplanationSavedByUserAction,
    getTagsForExplanationAction,
    loadFromPineconeUsingExplanationIdAction,
    resolveLinksForDisplayAction
} from '@/actions/actions';
import { ExplanationStatus, TagUIType, matchWithCurrentContentType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import { useClientPassRequestId } from '@/hooks/clientPassRequestId';

const FILE_DEBUG = false;

/**
 * Custom hook for loading and managing explanation data
 *
 * Encapsulates:
 * - Explanation metadata (id, title, status)
 * - Content and vector data
 * - User saved status
 * - Loading states and error handling
 *
 * Used by: Results page, potentially other pages that display explanations
 */

export interface UseExplanationLoaderOptions {
    /**
     * User ID for request context tracking
     * Falls back to 'anonymous' if not provided
     */
    userId?: string;

    /**
     * Callback invoked when tags are loaded for the explanation
     * Used to dispatch to tag reducer in parent component
     */
    onTagsLoad?: (tags: TagUIType[]) => void;

    /**
     * Callback invoked when matches are loaded
     * Used to update matches state in parent component
     */
    onMatchesLoad?: (matches: matchWithCurrentContentType[]) => void;

    /**
     * Callback invoked when prompt should be cleared
     * Used to clear search prompt in parent component
     */
    onClearPrompt?: () => void;

    /**
     * Callback invoked when original values are set for change tracking
     * Used by edit/publishing reducer in parent component
     */
    onSetOriginalValues?: (content: string, title: string, status: ExplanationStatus) => void;
}

export interface UseExplanationLoaderReturn {
    // State variables (read)
    explanationId: number | null;
    explanationTitle: string;
    content: string;
    explanationStatus: ExplanationStatus | null;
    explanationVector: { values: number[] } | null;
    systemSavedId: number | null;
    userSaved: boolean;
    isLoading: boolean;
    error: string | null;

    // Setters (write) - exposed for streaming and direct updates
    setExplanationId: (id: number | null) => void;
    setExplanationTitle: (title: string) => void;
    setContent: (content: string) => void;
    setExplanationStatus: (status: ExplanationStatus | null) => void;
    setExplanationVector: (vector: { values: number[] } | null) => void;
    setSystemSavedId: (id: number | null) => void;
    setUserSaved: (saved: boolean) => void;
    setError: (error: string | null) => void;

    // Functions
    loadExplanation: (
        explanationId: number,
        clearPrompt: boolean,
        userid: string | null,
        matches?: matchWithCurrentContentType[]
    ) => Promise<void>;
    clearSystemSavedId: () => void;
}

export function useExplanationLoader(
    options: UseExplanationLoaderOptions = {}
): UseExplanationLoaderReturn {
    const { userId, onTagsLoad, onMatchesLoad, onClearPrompt, onSetOriginalValues } = options;
    const { withRequestId } = useClientPassRequestId(userId || 'anonymous');

    // State for the 7 explanation-related variables
    const [explanationId, setExplanationId] = useState<number | null>(null);
    const [explanationTitle, setExplanationTitle] = useState('');
    const [content, setContent] = useState('');
    const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
    const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);
    const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
    const [userSaved, setUserSaved] = useState(false);

    // Loading and error states
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Checks if the current explanation is saved by the user
     *
     * • Validates that both explanationId and userid are available
     * • Calls isExplanationSavedByUserAction to check save status
     * • Updates userSaved state with the result
     * • Handles errors by setting userSaved to false
     */
    const checkUserSaved = useCallback(async (targetExplanationId: number, userid: string) => {
        if (!targetExplanationId || !userid) return;
        try {
            const saved = await isExplanationSavedByUserAction(
                withRequestId({ explanationid: targetExplanationId, userid })
            );
            setUserSaved(saved);
        } catch {
            setUserSaved(false);
        }
    }, [withRequestId]);

    /**
     * Loads an explanation by ID and updates the state
     *
     * • Fetches explanation data from the database using getExplanationById
     * • Updates explanation title, content, and saved ID in state
     * • Resets generation loading state to allow content display
     * • Enhances matches with current content if available
     * • Optionally clears the prompt based on clearPrompt parameter
     * • Fetches tags for the explanation
     * • Loads vector representation from Pinecone
     * • Checks if explanation is saved by the user
     *
     * Used by: useEffect (initial page load), handleSubmit (when match found), View buttons in matches tab
     * Calls: getExplanationByIdAction, checkUserSaved, getTagsForExplanationAction, loadFromPineconeUsingExplanationIdAction
     */
    const loadExplanation = useCallback(async (
        targetExplanationId: number,
        clearPrompt: boolean,
        userid: string | null,
        matches?: matchWithCurrentContentType[]
    ) => {
        try {
            logger.debug('[loadExplanation] START - loading explanation:', { targetExplanationId }, FILE_DEBUG);
            setIsLoading(true);
            setError(null);

            logger.debug('[loadExplanation] Calling getExplanationByIdAction...', null, FILE_DEBUG);
            const explanation = await getExplanationByIdAction(
                withRequestId({ id: targetExplanationId })
            );
            logger.debug('[loadExplanation] getExplanationByIdAction returned:', { found: !!explanation }, FILE_DEBUG);

            if (!explanation) {
                setError('Explanation not found');
                setIsLoading(false);
                return;
            }

            // Update all state with loaded explanation data
            setExplanationTitle(explanation.explanation_title);

            // Resolve links at render time (overlay system)
            let contentToDisplay = explanation.content;
            logger.debug('[loadExplanation] Calling resolveLinksForDisplayAction...', { contentLength: explanation.content.length }, FILE_DEBUG);
            try {
                contentToDisplay = await resolveLinksForDisplayAction(
                    withRequestId({ explanationId: explanation.id, content: explanation.content })
                );
                logger.debug('[loadExplanation] resolveLinksForDisplayAction returned:', {
                    resultLength: contentToDisplay.length,
                    hasLinks: contentToDisplay.includes('/standalone-title')
                }, FILE_DEBUG);
            } catch (err) {
                // Fallback to raw content if link resolution fails
                logger.error('Failed to resolve links for display:', { error: err });
            }
            setContent(contentToDisplay);

            setSystemSavedId(explanation.id);
            setExplanationId(explanation.id);
            setExplanationStatus(explanation.status);

            // Notify parent component to set original values for change tracking
            if (onSetOriginalValues) {
                onSetOriginalValues(
                    explanation.content,
                    explanation.explanation_title,
                    explanation.status
                );
            }

            // Handle matches if provided
            if (matches && onMatchesLoad) {
                onMatchesLoad(matches);
            }

            // Clear prompt if requested
            if (clearPrompt && onClearPrompt) {
                onClearPrompt();
            }

            // Check if this explanation is saved by the user
            if (userid) {
                await checkUserSaved(explanation.id, userid);
            }

            // Fetch tags for the explanation
            const tagsResult = await getTagsForExplanationAction(
                withRequestId({ explanationId: explanation.id })
            );

            if (tagsResult.success && tagsResult.data) {
                if (onTagsLoad) {
                    onTagsLoad(tagsResult.data);
                }
            } else {
                logger.error('Failed to fetch tags for explanation:', { error: tagsResult.error });
                if (onTagsLoad) {
                    onTagsLoad([]);
                }
            }

            // Load vector representation from Pinecone
            logger.debug('Attempting to load vector for explanation:', {
                explanationId: explanation.id,
                explanationTitle: explanation.explanation_title
            }, FILE_DEBUG);

            const vectorResult = await loadFromPineconeUsingExplanationIdAction(
                withRequestId({ explanationId: explanation.id })
            );

            if (vectorResult.success) {
                if (vectorResult.data) {
                    // Ensure the vector data has the expected structure
                    let vectorData = vectorResult.data;
                    const vectorDataAny = vectorData as unknown as { vector?: number[] };

                    if (!vectorData.values && vectorDataAny.vector) {
                        vectorData = {
                            ...vectorData,
                            values: vectorDataAny.vector
                        };
                    }

                    // Only set if values exist
                    if (vectorData.values) {
                        setExplanationVector(vectorData as { values: number[] });
                    } else {
                        setExplanationVector(null);
                    }
                    logger.debug('Loaded explanation vector:', {
                        found: true,
                        explanationId: explanation.id,
                        vectorKeys: Object.keys(vectorData),
                        hasValues: 'values' in vectorData,
                        valuesType: typeof vectorData.values,
                        isArray: Array.isArray(vectorData.values),
                        valuesLength: vectorData.values?.length || 0,
                        hasId: 'id' in vectorData,
                        hasScore: 'score' in vectorData,
                        hasMetadata: 'metadata' in vectorData,
                        hasVector: 'vector' in vectorDataAny,
                        vectorType: typeof vectorDataAny.vector,
                        vectorLength: vectorDataAny.vector?.length || 0
                    }, FILE_DEBUG);
                } else {
                    // No vector found for this explanation (normal for older explanations)
                    setExplanationVector(null);
                    logger.debug('No vector found for explanation:', {
                        found: false,
                        explanationId: explanation.id
                    }, FILE_DEBUG);
                }
            } else {
                // Check if this is a specific error or just no vector found
                if (vectorResult.error && vectorResult.error.message) {
                    logger.error('Failed to load explanation vector:', {
                        error: vectorResult.error,
                        explanationId: explanation.id
                    });
                } else {
                    logger.debug('No vector found for explanation (normal for older explanations):', {
                        explanationId: explanation.id
                    });
                }
                setExplanationVector(null);
            }

            setIsLoading(false);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load explanation';
            setError(errorMessage);
            logger.error('Failed to load explanation:', { error: errorMessage });
            setIsLoading(false);
        }
    }, [withRequestId, checkUserSaved, onTagsLoad, onMatchesLoad, onClearPrompt, onSetOriginalValues]);

    /**
     * Clears the systemSavedId
     * Called after API calls to prevent reuse of stale IDs
     */
    const clearSystemSavedId = useCallback(() => {
        setSystemSavedId(null);
    }, []);

    return {
        // State (read)
        explanationId,
        explanationTitle,
        content,
        explanationStatus,
        explanationVector,
        systemSavedId,
        userSaved,
        isLoading,
        error,

        // Setters (write)
        setExplanationId,
        setExplanationTitle,
        setContent,
        setExplanationStatus,
        setExplanationVector,
        setSystemSavedId,
        setUserSaved,
        setError,

        // Functions
        loadExplanation,
        clearSystemSavedId
    };
}
