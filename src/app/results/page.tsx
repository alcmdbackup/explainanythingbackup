'use client';

import { useState, useEffect, useRef, useReducer, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { saveExplanationToLibraryAction, getUserQueryByIdAction, createUserExplanationEventAction, getTempTagsForRewriteWithTagsAction, saveOrPublishChanges, resolveLinksForDisplayAction } from '@/actions/actions';
import { matchWithCurrentContentType, MatchMode, UserInputType, ExplanationStatus, type SourceChipType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useClientPassRequestId } from '@/hooks/clientPassRequestId';
import Navigation from '@/components/Navigation';
import TagBar from '@/components/TagBar';
import FeedbackPanel from '@/components/FeedbackPanel';
import LexicalEditor, { LexicalEditorRef } from '@/editorFiles/lexicalEditor/LexicalEditor';
import AISuggestionsPanel from '@/components/AISuggestionsPanel';
import Bibliography from '@/components/sources/Bibliography';
import { tagModeReducer, createInitialTagModeState, isTagsModified } from '@/reducers/tagModeReducer';
import {
    pageLifecycleReducer,
    initialPageLifecycleState,
    isPageLoading as getIsPageLoading,
    isStreaming as getIsStreaming,
    isEditMode as getIsEditMode,
    isSavingChanges as getIsSavingChanges,
    getError as getPageError,
    getContent as getPageContent,
    getTitle as getPageTitle,
    hasUnsavedChanges as getHasUnsavedChanges
} from '@/reducers/pageLifecycleReducer';
import { useExplanationLoader } from '@/hooks/useExplanationLoader';
import { useUserAuth } from '@/hooks/useUserAuth';
import { useTextRevealSettings } from '@/hooks/useTextRevealSettings';

const FILE_DEBUG = true;
const FORCE_REGENERATION_ON_NAV = false;

function ResultsPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Initialize user authentication hook first (needed for request context)
    const { userid, fetchUserid } = useUserAuth();

    const { withRequestId } = useClientPassRequestId(userid || 'anonymous');
    const [prompt, setPrompt] = useState('');
    const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showMatches, setShowMatches] = useState(false);
    const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);
    const [streamCompleted, setStreamCompleted] = useState(false);
    const [tagState, dispatchTagAction] = useReducer(tagModeReducer, createInitialTagModeState());

    // Sources state for feedback/rewrite with sources
    const [sources, setSources] = useState<SourceChipType[]>([]);
    const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);

    // Convert sources to bibliography format (with index for citations)
    const bibliographySources = useMemo(() =>
        sources
            .filter(s => s.status === 'success')
            .map((s, idx) => ({
                index: idx + 1,
                title: s.title || s.domain,
                domain: s.domain,
                url: s.url,
                favicon_url: s.favicon_url
            })),
        [sources]
    );

    // Page lifecycle reducer (replaces 12 state variables with 1 reducer)
    const [lifecycleState, dispatchLifecycle] = useReducer(pageLifecycleReducer, initialPageLifecycleState);

    // Derived state from reducer (for easier access)
    const isPageLoading = getIsPageLoading(lifecycleState);
    const isStreaming = getIsStreaming(lifecycleState);
    const error = getPageError(lifecycleState);
    const isEditMode = getIsEditMode(lifecycleState);
    const isSavingChanges = getIsSavingChanges(lifecycleState);
    const hasUnsavedChanges = getHasUnsavedChanges(lifecycleState);

    // Initialize explanation loader hook
    const {
        explanationId,
        explanationTitle,
        content,
        explanationStatus,
        explanationVector,
        systemSavedId,
        userSaved,
        setExplanationTitle,
        setContent,
        setExplanationStatus,
        setExplanationVector,
        setUserSaved,
        loadExplanation,
        clearSystemSavedId
    } = useExplanationLoader({
        userId: userid || undefined,
        onTagsLoad: (tags) => dispatchTagAction({ type: 'LOAD_TAGS', tags }),
        onMatchesLoad: (matches) => setMatches(matches),
        onClearPrompt: () => setPrompt(''),
        onSetOriginalValues: (content, title, status) => {
            // Dispatch LOAD_EXPLANATION to set viewing state with original values
            dispatchLifecycle({
                type: 'LOAD_EXPLANATION',
                content,
                title,
                status
            });
        }
    });

    // Text reveal animation settings
    const { effect: textRevealEffect } = useTextRevealSettings();

    const regenerateDropdownRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<LexicalEditorRef>(null); // For AI suggestions panel

    // Editor synchronization state (moved from ResultsLexicalEditor)
    const [editorCurrentContent, setEditorCurrentContent] = useState('');
    const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastStreamingUpdateRef = useRef<string>('');
    const isInitialLoadRef = useRef<boolean>(true);
    const hasInitializedContent = useRef<boolean>(false);

    // Prevent duplicate API calls from useEffect re-firing (HMR, searchParams reference change)
    const processedParamsRef = useRef<string | null>(null);

    // Close dropdown when clicking outside and reset tags
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (regenerateDropdownRef.current && !regenerateDropdownRef.current.contains(event.target as Node)) {
                if (tagState.mode === 'normal' && tagState.showRegenerateDropdown) {
                    dispatchTagAction({ type: 'EXIT_TO_NORMAL' });
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [tagState.mode, tagState.showRegenerateDropdown]);

    /**
     * Initializes temporary tags for "rewrite with tags" functionality
     *
     * • Fetches two preset tags from database: "medium" (ID 2) and "moderate" (ID 5)
     * • Converts database tags to TagUIType format with both active states set to true
     * • Uses getTempTagsForRewriteWithTagsAction to retrieve actual tag data
     * • Dispatches ENTER_REWRITE_MODE action with fetched tags
     *
     * Used by: "Rewrite with tags" button click handler
     * Calls: getTempTagsForRewriteWithTagsAction, dispatchTagAction
     */
    const initializeTempTagsForRewriteWithTags = async () => {
        try {
            const result = await getTempTagsForRewriteWithTagsAction();
            if (result.success && result.data) {
                // Dispatch action to enter rewrite mode with temp tags
                dispatchTagAction({ type: 'ENTER_REWRITE_MODE', tempTags: result.data });
            } else {
                logger.error('Failed to fetch temp tags for rewrite with tags', { error: result.error });
            }
        } catch (error) {
            logger.error('Error initializing temp tags for rewrite with tags', { error: error instanceof Error ? error.message : String(error) });
        }
    };

    /**
     * Determines the mode from URL parameters or localStorage
     * 
     * • Reads mode from URL parameters with highest priority
     * • Falls back to localStorage saved mode preference
     * • Uses Normal as final fallback if no valid mode found
     * • Clears mode parameter from URL after processing to avoid re-triggers
     * • Returns the determined mode without side effects
     * 
     * Used by: processParams (during URL parameter processing)
     * Calls: router.replace (to clean URL)
     */
    const initializeMode = (router: AppRouterInstance, searchParams: URLSearchParams): MatchMode => {
        const urlMode = searchParams.get('mode') as MatchMode;
        const savedMode = localStorage.getItem('explanation-mode') as MatchMode;
        

        
        // Priority: URL > localStorage > default
        let initialMode = MatchMode.Normal;
        if (urlMode && Object.values(MatchMode).includes(urlMode)) {
            initialMode = urlMode;
        } else if (savedMode && Object.values(MatchMode).includes(savedMode)) {
            initialMode = savedMode;
        }
        
        // Clear mode parameter from URL if it was provided, to avoid re-triggering effects
        if (urlMode) {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('mode');
            const newUrl = newParams.toString() ? `/results?${newParams.toString()}` : '/results';
            router.replace(newUrl);
        }
        
        return initialMode;
    };



    /**
     * Loads user query data by ID and updates the UI state
     * 
     * • Fetches user query data from the database using getUserQueryById
     * • Updates prompt with the user query text
     * • Updates matches with the query matches data
     * • Resets generation loading state to allow content display
     * 
     * Used by: useEffect (initial page load when userQueryId parameter is present)
     * Calls: getUserQueryByIdAction
     */
    const loadUserQuery = async (userQueryId: number) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userQuery = await (getUserQueryByIdAction as any)(withRequestId({ id: userQueryId }));

            if (!userQuery) {
                dispatchLifecycle({ type: 'ERROR', error: 'User query not found' });
                return;
            }

            setPrompt(userQuery.user_query);
            setMatches(userQuery.matches || []);

            // Do not reset the active tab
            //setActiveTab('matches');

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load user query';
            dispatchLifecycle({ type: 'ERROR', error: errorMessage });
            logger.error('Failed to load user query:', { error: errorMessage });
        }
    };



    /**
     * Handles user actions for generating explanations
     * 
     * • Processes user input and generates explanations via API
     * • Supports streaming responses for real-time content updates
     * • Handles both query and title-based input types
     * • Manages loading states and error handling
     * • Accepts optional userid parameter to override state variable
     * • Accepts required additionalRules for tag-based rewriting
     * 
     * Used by: useEffect (initial query), Regenerate button, direct function calls
     * Calls: /api/returnExplanation, loadExplanation, saveUserQuery
     */
    const handleUserAction = async (userInput: string, userInputType: UserInputType, matchMode: MatchMode, overrideUserid: string|null, additionalRules: string[], previousExplanationViewedId: number|null, previousExplanationViewedVector: { values: number[] } | null, sourcesForRewrite?: SourceChipType[]) => {
        logger.debug('handleUserAction called', { userInput, userInputType, matchMode, prompt, systemSavedId, additionalRules, sourcesCount: sourcesForRewrite?.length }, FILE_DEBUG);
        if (!userInput.trim()) return;
        
        const effectiveUserid = overrideUserid !== undefined ? overrideUserid : userid;

        if (!effectiveUserid) {
            dispatchLifecycle({ type: 'ERROR', error: 'User not authenticated. Please log in to generate explanations.' });
            return;
        }

        // Start generation (resets to loading phase)
        dispatchLifecycle({ type: 'START_GENERATION' });
        setMatches([]);
        setContent(''); // Clear useExplanationLoader content
        setExplanationTitle(''); // Clear useExplanationLoader title
        dispatchTagAction({ type: 'LOAD_TAGS', tags: [] }); // Reset tags when generating new explanation
        setExplanationVector(null); // Reset vector when generating new explanation
        setExplanationStatus(null); // Reset explanation status when generating new explanation

        // Debug logging for tag rules
        if (additionalRules.length > 0) {
            logger.debug('Using additional rules for explanation generation', { additionalRules }, FILE_DEBUG);
        }
        
        // Prepare sources for the API - convert SourceChipType to the format expected by the API
        // The API/service will handle fetching full source data via getOrCreateCachedSource
        const validSourceUrls = sourcesForRewrite?.filter(s => s.status === 'success').map(s => s.url) || [];

        const requestBody = {
            userInput,
            savedId: systemSavedId,
            matchMode,
            userid: effectiveUserid,
            userInputType,
            additionalRules,
            existingContent: userInputType === UserInputType.EditWithTags ? formattedExplanation : undefined,
            previousExplanationViewedId,
            previousExplanationViewedVector,
            sourceUrls: validSourceUrls.length > 0 ? validSourceUrls : undefined
        };
        logger.debug('Sending request to API', { matchMode, requestBody }, FILE_DEBUG);
        
        // Add debug logging for rewrite operations
        if (userInputType === UserInputType.Rewrite) {
            logger.debug('handleUserAction sending REWRITE request to API', {
                userInput,
                userInputType,
                previousExplanationViewedId,
                previousExplanationViewedVector: previousExplanationViewedVector ? {
                    hasValues: !!previousExplanationViewedVector.values,
                    valuesType: typeof previousExplanationViewedVector.values,
                    isArray: Array.isArray(previousExplanationViewedVector.values),
                    valuesLength: previousExplanationViewedVector.values?.length
                } : null
            }, FILE_DEBUG);
        }
        
        // Call the API route directly
        const response = await fetch('/api/returnExplanation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(withRequestId(requestBody))
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Failed to get response reader');
        }
        logger.debug('Got response reader, starting to read SSE stream', null, FILE_DEBUG);

        const decoder = new TextDecoder();
        let finalResult: unknown = null;
        let chunkCount = 0;

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                logger.debug('Stream done', { totalChunks: chunkCount }, FILE_DEBUG);
                break;
            }

            chunkCount++;
            const chunk = decoder.decode(value);
            logger.debug('Chunk received', { chunkCount, length: chunk.length }, FILE_DEBUG);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        logger.debug('Client received streaming data', { data }, FILE_DEBUG);

                        if (data.type === 'error') {
                            logger.debug('Error event received, dispatching ERROR action', { error: data.error }, FILE_DEBUG);
                            dispatchLifecycle({ type: 'ERROR', error: data.error });
                            setExplanationVector(null); // Reset vector on error
                            setExplanationStatus(null); // Reset status on error
                            return;
                        }

                        if (data.type === 'streaming_start') {
                            logger.debug('Client received streaming_start', { data }, FILE_DEBUG);
                            dispatchLifecycle({ type: 'START_STREAMING' });
                        }

                        if (data.type === 'content') {
                            // Handle streaming content - update the UI in real-time
                            logger.debug('Client received content', { contentLength: data.content?.length }, FILE_DEBUG);
                            dispatchLifecycle({ type: 'STREAM_CONTENT', content: data.content });
                            // Also update useExplanationLoader for compatibility
                            setContent(data.content);
                        }

                        if (data.type === 'progress') {
                            // Handle progress events
                            logger.debug('Received progress data', { data }, FILE_DEBUG);
                            if (data.stage === 'title_generated' && data.title) {
                                dispatchLifecycle({ type: 'STREAM_TITLE', title: data.title });
                                setExplanationTitle(data.title); // Also update useExplanationLoader
                            }
                            if (data.stage === 'searching_matches' && data.title) {
                                dispatchLifecycle({ type: 'STREAM_TITLE', title: data.title });
                                setExplanationTitle(data.title); // Also update useExplanationLoader
                            }
                        }

                        if (data.type === 'streaming_end') {
                            logger.debug('Client received streaming_end', { data }, FILE_DEBUG);
                            // Do not set isStreaming to false at the end of streaming, keep the buttons disabled until page refreshes
                        }

                        if (data.type === 'complete' && data.result) {
                            logger.debug('Client received complete', { hasResult: !!data.result }, FILE_DEBUG);
                            finalResult = data.result;
                            setStreamCompleted(true); // Mark stream as completed for E2E testing
                            //setIsStreaming(false);
                            //wait for page reload to set this to false. This will prevent the flashing of the action buttons.
                            break;
                        }
                    } catch (parseError) {
                        logger.error('Error parsing streaming data:', { error: parseError });
                    }
                }
            }

            if (finalResult) break;
        }

        if (!finalResult) {
            dispatchLifecycle({ type: 'ERROR', error: 'No result received from server' });
            setExplanationVector(null); // Reset vector on error
            setExplanationStatus(null); // Reset status on error
            return;
        }

        const { data, error, originalUserInput, explanationId, userQueryId } = finalResult as { data?: unknown; error?: { message: string }; originalUserInput?: string; explanationId?: number; userQueryId?: number };

        logger.debug('API /returnExplanation result:', { data, error, originalUserInput, explanationId, userQueryId }, FILE_DEBUG);

        // Clear systemSavedId after the API call
        clearSystemSavedId();



        if (error) {
            dispatchLifecycle({ type: 'ERROR', error: error.message });
            setExplanationVector(null); // Reset vector on error
            setExplanationStatus(null); // Reset status on error
        } else {
            // Resolve links for the newly created explanation before redirect
            // This ensures links render correctly since loadExplanation may be skipped
            // when explanationId is already set from streaming
            if (explanationId && content) {
                try {
                    const contentWithLinks = await resolveLinksForDisplayAction(
                        withRequestId({ explanationId, content })
                    );
                    setContent(contentWithLinks);
                } catch (err) {
                    logger.error('Failed to resolve links after creation:', { error: err });
                    // Continue with redirect even if link resolution fails
                }
            }

            // Redirect to URL with explanation_id and userQueryId
            const params = new URLSearchParams();
            if (explanationId) {
                params.set('explanation_id', explanationId.toString());
            }
            if (userQueryId) {
                params.set('userQueryId', userQueryId.toString());
            }

            router.push(`/results?${params.toString()}`);
            // Note: setIsLoading(false) will be handled by the page reload
        }
    };

    /**
     * Handles apply button clicks from TagBar in rewrite or edit mode
     * 
     * • Routes to appropriate UserInputType based on current modeOverride
     * • Calls handleUserAction with tag descriptions as additional rules
     * • Supports both rewrite with tags and edit with tags modes
     * 
     * Used by: TagBar component tagBarApplyClickHandler prop
     * Calls: handleUserAction
     */
    const handleTagBarApplyClick = async (tagDescriptions: string[]) => {
        logger.debug('handleTagBarApplyClick called', { tagDescriptions, tagStateMode: tagState.mode, prompt, explanationTitle, userid }, FILE_DEBUG);

        // Handle apply button click in rewrite or edit mode
        if (tagState.mode === 'rewriteWithTags') {
            // For rewrite with tags, use the current explanation title as input
            const inputForRewrite = explanationTitle || prompt;
            logger.debug('Calling handleUserAction with RewriteWithTags', { mode, inputForRewrite }, FILE_DEBUG);
            await handleUserAction(inputForRewrite, UserInputType.RewriteWithTags, mode, userid, tagDescriptions, null, null);
        } else if (tagState.mode === 'editWithTags') {
            // For edit with tags, use the current explanation title as input
            const inputForEdit = explanationTitle || prompt;
            logger.debug('Calling handleUserAction with EditWithTags', { mode, inputForEdit }, FILE_DEBUG);
            await handleUserAction(inputForEdit, UserInputType.EditWithTags, mode, userid, tagDescriptions, null, null);
        } else {
            logger.debug('No matching mode found', { tagStateMode: tagState.mode }, FILE_DEBUG);
        }
    };

    /**
     * Handles apply from FeedbackPanel (tags + sources combined)
     *
     * Uses RewriteWithTags user input type with sources attached
     */
    const handleFeedbackPanelApply = async (tagDescriptions: string[], panelSources: SourceChipType[]) => {
        console.log('handleFeedbackPanelApply called', { tagDescriptions, sourcesCount: panelSources.length });

        const inputForRewrite = explanationTitle || prompt;
        if (!inputForRewrite) {
            dispatchLifecycle({ type: 'ERROR', error: 'No input available for rewriting. Please try again.' });
            return;
        }

        // Close the feedback panel
        setShowFeedbackPanel(false);

        // Call handleUserAction with sources
        await handleUserAction(
            inputForRewrite,
            UserInputType.RewriteWithTags,
            mode,
            userid,
            tagDescriptions,
            null,
            null,
            panelSources
        );
    };

    /**
     * Handles reset from FeedbackPanel
     */
    const handleFeedbackPanelReset = () => {
        dispatchTagAction({ type: 'RESET_TAGS' });
        setSources([]);
    };

    /**
     * Opens the FeedbackPanel for rewrite with feedback
     */
    const handleOpenFeedbackPanel = async () => {
        // Initialize temp tags like rewrite with tags does
        await initializeTempTagsForRewriteWithTags();
        setShowFeedbackPanel(true);
        // Close the dropdown
        dispatchTagAction({ type: 'EXIT_TO_NORMAL' });
    };

    /**
     * Saves the current explanation to the user's library
     *
     * • Uses the userid from component state (fetched once upfront)
     * • Gets the explanation ID from state
     * • Calls saveExplanationToLibrary to persist the explanation for the user
     * • Handles error states and loading indicators
     *
     * Used by: Save button in the UI
     * Calls: saveExplanationToLibrary
     */
    const handleSave = async () => {
        if (!explanationId || userSaved || isSaving || !userid) return;
        setIsSaving(true);
        try {
            logger.debug('Starting from handleSave', {}, true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (saveExplanationToLibraryAction as any)(withRequestId({ explanationid: explanationId, userid }));
            setUserSaved(true);
        } catch (err) {
            dispatchLifecycle({ type: 'ERROR', error: (err as Error).message || 'Failed to save explanation to library.' });
        }
        setIsSaving(false);
    };

    /**
     * Handles publishing changes based on the original article status
     *
     * For draft articles: Updates existing record to published status
     * For published articles: Creates new published version, leaving original unchanged
     */
    const handleSaveOrPublishChanges = async () => {
        if (!explanationId || (!hasUnsavedChanges && explanationStatus !== ExplanationStatus.Draft) || isSavingChanges || !userid) return;

        // Start save process
        dispatchLifecycle({ type: 'START_SAVE' });

        try {
            // Get current content from editor or from lifecycle state
            const currentContent = editorRef.current?.getContentAsMarkdown() || getPageContent(lifecycleState);
            const currentTitle = getPageTitle(lifecycleState);

            // Always target Published status - consistent "Publish Changes" experience
            const targetStatus = ExplanationStatus.Published;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (saveOrPublishChanges as any)(
                withRequestId({
                    explanationId,
                    newContent: currentContent,
                    newTitle: currentTitle,
                    originalStatus: explanationStatus!,
                    targetStatus
                })
            );

            if (result.success && result.id) {
                // Dispatch SAVE_SUCCESS (component will unmount before this renders)
                dispatchLifecycle({
                    type: 'SAVE_SUCCESS',
                    newId: result.id,
                    isNewExplanation: result.isNewExplanation
                });

                if (result.isNewExplanation) {
                    // For published articles: Navigate to the new published article
                    router.push(`/results?explanation_id=${result.id}`);
                } else {
                    // For draft articles: Force page reload
                    window.location.href = `/results?explanation_id=${result.id}`;
                }
            } else {
                dispatchLifecycle({
                    type: 'ERROR',
                    error: result.error?.message || 'Failed to publish changes'
                });
            }
        } catch (err) {
            dispatchLifecycle({
                type: 'ERROR',
                error: (err as Error).message || 'Failed to publish changes'
            });
        }
    };

    // Get content from hook (has resolved links) first, fallback to lifecycle reducer
    // The hook's content has resolved links from resolveLinksForDisplayAction
    const formattedExplanation = content || getPageContent(lifecycleState) || '';

    /**
     * Handles edit mode toggle for Lexical editor
     */
    const handleEditModeToggle = () => {
        if (isEditMode) {
            // Sync current editor content to lifecycle state before exiting edit mode
            const currentContent = editorRef.current?.getContentAsMarkdown() || '';
            if (currentContent) {
                dispatchLifecycle({ type: 'UPDATE_CONTENT', content: currentContent });
            }
            // Exit edit mode (preserves the content we just synced)
            dispatchLifecycle({ type: 'EXIT_EDIT_MODE' });
        } else {
            // Enter edit mode
            dispatchLifecycle({ type: 'ENTER_EDIT_MODE' });
        }
    };

    /**
     * Handles content changes from Lexical editor
     * Note: During editing, we don't update lifecycle state on every keystroke to prevent
     * feedback loop that resets cursor. Content is synced when exiting edit mode.
     */
    const handleEditorContentChange = (newContent: string) => {
        logger.debug('handleEditorContentChange called', {
            contentLength: newContent?.length,
            isEditMode,
            isInitialLoad: isInitialLoadRef.current
        }, FILE_DEBUG);

        // Clear initial load flag on first user edit (when in edit mode)
        if (isEditMode && isInitialLoadRef.current) {
            logger.debug('Clearing isInitialLoadRef.current on user edit', null, FILE_DEBUG);
            isInitialLoadRef.current = false;
        }

        const shouldCallParent = isEditMode && !isInitialLoadRef.current;

        // Only propagate changes if user is in edit mode and this is not initial load
        if (shouldCallParent) {
            logger.debug('Content change from user edit (tracked by editor)', null, FILE_DEBUG);
            // Don't update lifecycle state during editing - prevents cursor jumping
            // Content will be synced to lifecycle state when user exits edit mode or saves
        } else {
            logger.debug('NOT propagating content change', { isEditMode, isInitialLoad: isInitialLoadRef.current }, FILE_DEBUG);
        }
    };


    /**
     * Handles search form submission and navigates to results page
     * 
     * • Validates search query is not empty
     * • Either calls handleUserAction directly (if FORCE_REGENERATION_ON_NAV) or navigates to results page
     * • Triggers new explanation generation either directly or on page load
     * 
     * Used by: SearchBar component in navigation
     * Calls: handleUserAction (if FORCE_REGENERATION_ON_NAV), router.push
     */
    const handleSearchSubmit = async (query: string) => {
        if (!query.trim()) return;

        if (!FORCE_REGENERATION_ON_NAV) {
            await handleUserAction(query, UserInputType.Query, mode, userid, [], null, null, sources);
        } else {
            router.push(`/results?q=${encodeURIComponent(query)}`);
        }
    };

    // Fetch userid once upfront
    useEffect(() => {
        fetchUserid();
    }, [fetchUserid]);

    // Load sources from sessionStorage on mount (passed from home page)
    useEffect(() => {
        try {
            const pendingSourcesStr = sessionStorage.getItem('pendingSources');
            if (pendingSourcesStr) {
                const pendingSources = JSON.parse(pendingSourcesStr) as SourceChipType[];
                setSources(pendingSources);
                // Clear after loading
                sessionStorage.removeItem('pendingSources');
            }
        } catch (error) {
            logger.error('Failed to load pending sources from sessionStorage:', { error });
        }
    }, []);

    // NOTE: Auto-loading useEffect removed - lifecycle reducer handles phase transitions explicitly

    useEffect(() => {
        //Prevent this from double running in dev due to React strict mode
        //This breaks several things including search from top nav, maybe accept for now
        /*if (isFirstRun.current) {
            isFirstRun.current = false; // Mark as mounted
            return; // Skip running on mount
        }*/

        const processParams = async () => {
            // Extract params early to create fingerprint
            const urlExplanationId = searchParams.get('explanation_id');
            const urlUserQueryId = searchParams.get('userQueryId');
            const title = searchParams.get('t');
            const query = searchParams.get('q');

            // Create fingerprint from URL params to detect duplicate processing
            // This prevents HMR/Fast Refresh from re-triggering API calls
            const paramsFingerprint = `${query || ''}|${title || ''}|${urlExplanationId || ''}|${urlUserQueryId || ''}`;
            if (processedParamsRef.current === paramsFingerprint) {
                return; // Already processed these exact params
            }
            processedParamsRef.current = paramsFingerprint;

            // Get effective user ID first for request context
            const effectiveUserid = userid || await fetchUserid();

            // Initialize request ID for page load with actual user ID
            const pageLoadRequestId = `page-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            RequestIdContext.setClient({ requestId: pageLoadRequestId, userId: effectiveUserid || 'anonymous' });

            // Reset lifecycle to idle when processing new URL parameters
            dispatchLifecycle({ type: 'RESET' });

            // Immediately clear old content to prevent flash
            setExplanationTitle('');
            setContent('');
            setMatches([]);
            setUserSaved(false);
            dispatchTagAction({ type: 'LOAD_TAGS', tags: [] }); // Reset tags when processing new parameters
            setExplanationVector(null); // Reset vector when processing new parameters
            setExplanationStatus(null); // Reset explanation status when processing new parameters

            // Process mode first as an independent step
            const initialMode = initializeMode(router, searchParams);
            if (initialMode !== mode) {
                setMode(initialMode);
            }
            
            if (query) {
                setPrompt(query);
            }
            
            // Handle title parameter first
            if (title) {
                logger.debug('useEffect: handleUserAction called with title', { title }, FILE_DEBUG);
                handleUserAction(title, UserInputType.TitleFromLink, initialMode, effectiveUserid, [], null, null, sources);
                // Loading state will be managed automatically by content-watching useEffect
            } else if (query) {
                logger.debug('useEffect: handleUserAction called with query', { query }, FILE_DEBUG);
                handleUserAction(query, UserInputType.Query, initialMode, effectiveUserid, [], null, null, sources);
                // Loading state will be managed automatically by content-watching useEffect
            } else {
                // Handle userQueryId parameter
                if (urlUserQueryId) {
                    const newUserQueryIdFromUrl = parseInt(urlUserQueryId, 10);

                    // Load user query data (only if valid number)
                    if (!isNaN(newUserQueryIdFromUrl)) {
                        await loadUserQuery(newUserQueryIdFromUrl);
                    }
                }
                
                // Only load explanation if it's different from the currently loaded one
                if (urlExplanationId) {
                    const newExplanationIdFromUrl = parseInt(urlExplanationId, 10);

                    // Prevent loop: only load if this is a valid number and different from currently loaded
                    if (!isNaN(newExplanationIdFromUrl) && newExplanationIdFromUrl !== explanationId) {
                        await loadExplanation(newExplanationIdFromUrl, true, effectiveUserid);

                        // Track explanation loaded event (only for authenticated users)
                        if (effectiveUserid && effectiveUserid !== 'anonymous' && effectiveUserid.length > 0) {
                            try {
                                await createUserExplanationEventAction({
                                    event_name: 'explanation_viewed',
                                    userid: effectiveUserid,
                                    explanationid: newExplanationIdFromUrl,
                                    value: 1,
                                    metadata: JSON.stringify({ source: 'url_navigation', method: 'direct_load' })
                                });
                            } catch (error) {
                                logger.error('Failed to track explanation loaded event:', {
                                    error: error instanceof Error ? error.message : String(error)
                                });
                            }
                        }
                    }
                }
            }
            
            // Loading state will be automatically managed by the content-watching useEffect
        };
        
        processParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);
    //Comment - any time explanation id changes, the page should have already reloaded
    //No need to add to dependency array here

    // Save mode to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('explanation-mode', mode);
    }, [mode]);

    // === Editor Synchronization Logic (moved from ResultsLexicalEditor) ===

    // Lock editor during streaming to prevent conflicts
    useEffect(() => {
        if (isStreaming && editorRef.current) {
            editorRef.current.setEditMode(false);
        } else if (!isStreaming && editorRef.current) {
            editorRef.current.setEditMode(isEditMode);
        }
    }, [isStreaming, isEditMode]);

    // Debounced update function for streaming content
    const debouncedUpdateContent = useCallback((newContent: string) => {
        // Clear any existing debounce timeout
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }

        // Set a new debounce timeout
        debounceTimeoutRef.current = setTimeout(() => {
            if (editorRef.current && newContent !== lastStreamingUpdateRef.current) {
                try {
                    editorRef.current.setContentFromMarkdown(newContent);
                    lastStreamingUpdateRef.current = newContent;
                    setEditorCurrentContent(newContent);

                    // After first content update, mark as no longer initial load
                    if (isInitialLoadRef.current) {
                        setTimeout(() => {
                            isInitialLoadRef.current = false;
                        }, 0);
                    }
                } catch (error) {
                    logger.error('Error updating editor content during streaming', { error: error instanceof Error ? error.message : String(error) });
                }
            }
        }, isStreaming ? 100 : 0);
    }, [isStreaming]);

    // Update editor content when content prop changes (streaming updates)
    useEffect(() => {
        // Early return if editor ref is not yet initialized
        if (!editorRef.current) {
            logger.debug('Editor ref not yet initialized, skipping content sync', null, FILE_DEBUG);
            return;
        }

        // Prioritize content from hook (has resolved links) over lifecycle state
        const currentPageContent = content || getPageContent(lifecycleState);

        // On first run, just sync the state without updating the editor
        // LexicalEditor handles initialContent on its own
        if (!hasInitializedContent.current) {
            logger.debug('First content sync - initializing state only', null, FILE_DEBUG);
            setEditorCurrentContent(currentPageContent);
            hasInitializedContent.current = true;
            return;
        }

        logger.debug('Content comparison useEffect', {
            contentLength: currentPageContent?.length,
            editorContentLength: editorCurrentContent?.length,
            contentChanged: currentPageContent !== editorCurrentContent,
            isEditMode
        }, FILE_DEBUG);

        if (currentPageContent !== editorCurrentContent) {
            // IMPORTANT: Don't overwrite editor content during edit mode
            // This prevents AI suggestions from being destroyed
            if (isEditMode && !isStreaming) {
                logger.debug('Skipping content update - editor is in edit mode', null, FILE_DEBUG);
                return;
            }

            if (isStreaming) {
                // Use debounced updates during streaming for better performance
                debouncedUpdateContent(currentPageContent);
            } else {
                // Immediate update when not streaming
                if (editorRef.current) {
                    editorRef.current.setContentFromMarkdown(currentPageContent);
                    setEditorCurrentContent(currentPageContent);
                }
            }

            // After first content update, mark as no longer initial load
            if (isInitialLoadRef.current) {
                logger.debug('About to clear isInitialLoadRef', { isStreaming }, FILE_DEBUG);
                if (!isStreaming) {
                    isInitialLoadRef.current = false;
                } else {
                    setTimeout(() => {
                        isInitialLoadRef.current = false;
                    }, 0);
                }
            }
        }
    }, [content, editorCurrentContent, isStreaming, isEditMode, debouncedUpdateContent, lifecycleState]);

    // Cleanup debounce timeout on unmount
    useEffect(() => {
        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div className="h-screen bg-[var(--surface-primary)] flex flex-col">
            {/* Top Navigation Bar */}
            <Navigation
                showSearchBar={true}
                searchBarProps={{
                    placeholder: "Search...",
                    maxLength: 100,
                    initialValue: prompt,
                    onSearch: handleSearchSubmit,
                    disabled: isPageLoading || (isStreaming && !streamCompleted && !error)
                }}
            />

            {/* Progress Bar - Gold accent */}
            {isPageLoading && (
                <div data-testid="loading-indicator" className="w-full bg-[var(--surface-elevated)]">
                    <div className="h-1 bg-gradient-to-r from-[var(--accent-gold)] to-[var(--accent-copper)] animate-pulse" style={{ width: '100%' }}></div>
                </div>
            )}

            <main className="flex-1 overflow-hidden">
                <div className="flex h-full">
                    {/* Main Content Area */}
                    <div className="flex-1 px-4 py-8">
                        {error && (
                            <div data-testid="error-message" className="max-w-2xl mx-auto mb-8 p-4 bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] text-[var(--destructive)] rounded-r-page shadow-warm">
                                <span className="font-serif">{error}</span>
                            </div>
                        )}


                        <div className="w-full max-w-4xl mx-auto h-full">
                        {/* Matches View */}
                        {showMatches && (
                            <div 
                                className="h-full overflow-y-auto"
                                style={{ 
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: 'rgba(156, 163, 175, 0.5) transparent'
                                }}
                            >
                                <style jsx>{`
                                    div::-webkit-scrollbar {
                                        width: 8px;
                                    }
                                    div::-webkit-scrollbar-track {
                                        background: transparent;
                                    }
                                    div::-webkit-scrollbar-thumb {
                                        background: rgba(156, 163, 175, 0.5);
                                        border-radius: 4px;
                                    }
                                    div::-webkit-scrollbar-thumb:hover {
                                        background: rgba(156, 163, 175, 0.7);
                                    }
                                    div::-webkit-scrollbar-thumb:active {
                                        background: rgba(156, 163, 175, 0.9);
                                    }
                                `}</style>
                                <div className="mt-2">
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between">
                                            <h1 className="text-3xl font-display font-bold text-[var(--text-primary)] leading-tight">
                                                Related
                                            </h1>
                                            <button
                                                onClick={() => setShowMatches(false)}
                                                className="text-sm font-sans text-[var(--accent-gold)] hover:text-[var(--accent-copper)] font-medium transition-colors gold-underline"
                                            >
                                                ← Back
                                            </button>
                                        </div>
                                        <div className="title-flourish mt-4"></div>
                                    </div>
                                    <div className="space-y-4 border border-[var(--border-default)] rounded-book p-4 bg-[var(--surface-secondary)] shadow-warm">
                                        {matches && matches.length > 0 ? (
                                            matches.map((match, index) => (
                                                <div
                                                    key={index}
                                                    className="p-4 bg-[var(--surface-elevated)] rounded-page shadow-page hover:shadow-warm transition-all duration-200 border border-[var(--border-default)] hover:-translate-y-0.5 cursor-pointer"
                                                    onClick={() => loadExplanation(match.explanation_id, false, userid)}
                                                >
                                                    <div className="mb-2 flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] rounded-page">
                                                                {(match.ranking.similarity * 100).toFixed(0)}% match
                                                            </span>
                                                            {match.ranking.diversity_score !== null && (
                                                                <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-copper)]/10 text-[var(--accent-copper)] rounded-page">
                                                                    {(match.ranking.diversity_score * 100).toFixed(0)}% unique
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-xs font-sans text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors">
                                                            View →
                                                        </span>
                                                    </div>
                                                    <h3 className="font-display font-semibold text-[var(--text-primary)] mb-2">
                                                        {match.current_title || match.text}
                                                    </h3>
                                                    <p className="font-serif text-[var(--text-secondary)] text-sm line-clamp-3">
                                                        {match.current_content || match.text}
                                                    </p>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="font-serif text-[var(--text-muted)] text-center py-8">
                                                No related explanations found.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Generated Output View (Default) */}
                        {!showMatches && (explanationTitle || content) && (!isPageLoading) && (
                            <div className="h-full flex flex-col">
                                {/* Explanation Title with View All Matches Link */}
                                {explanationTitle && !isPageLoading && (
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between min-h-[2.5rem]">
                                            <div className="flex items-center gap-3">
                                                {explanationStatus === ExplanationStatus.Draft && (
                                                    <span className="px-3 py-1 text-sm font-sans font-bold uppercase tracking-wide bg-[var(--accent-blue)] text-white rounded-page">
                                                        Draft
                                                    </span>
                                                )}
                                                <h1 data-testid="explanation-title" className="text-3xl font-display font-bold text-[var(--text-primary)] leading-tight">
                                                    {explanationTitle}
                                                </h1>
                                            </div>
                                            {matches && matches.length > 0 && (
                                                <button
                                                    onClick={() => setShowMatches(true)}
                                                    className="text-sm font-sans text-[var(--accent-gold)] hover:text-[var(--accent-copper)] font-medium transition-colors gold-underline"
                                                >
                                                    View related ({matches.length})
                                                </button>
                                            )}
                                        </div>
                                        <div className="title-flourish mt-4"></div>
                                    </div>
                                )}

                                {!isTagsModified(tagState) && !isPageLoading && (
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                    {/* Action buttons - left side */}
                                    <div className="flex flex-wrap gap-2">
                                        {(explanationTitle || content) && (
                                            <div className="relative inline-flex" ref={regenerateDropdownRef}>
                                                <div className="inline-flex items-center rounded-page bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] shadow-warm transition-all duration-200 hover:shadow-warm-md disabled:cursor-not-allowed disabled:opacity-50 h-9 leading-none">
                                                    <button
                                                        type="button"
                                                        data-testid="rewrite-button"
                                                        disabled={isPageLoading || isStreaming}
                                                        onClick={async () => {
                                                            const userInput = prompt.trim() || explanationTitle;
                                                            if (!userInput) {
                                                                dispatchLifecycle({ type: 'ERROR', error: 'No input available for rewriting. Please try again.' });
                                                                return;
                                                            }
                                                            logger.debug('Rewrite button clicked', {
                                                                userInput,
                                                                explanationId,
                                                                explanationVector: explanationVector ? {
                                                                    hasValues: !!explanationVector.values,
                                                                    valuesType: typeof explanationVector.values,
                                                                    isArray: Array.isArray(explanationVector.values),
                                                                    valuesLength: explanationVector.values?.length
                                                                } : null,
                                                                userInputType: UserInputType.Rewrite
                                                            }, FILE_DEBUG);
                                                            await handleUserAction(userInput, UserInputType.Rewrite, mode, userid, [], explanationId, explanationVector);
                                                        }}
                                                        className="px-4 py-2 text-sm font-sans font-medium text-[var(--text-on-primary)] hover:opacity-90 transition-colors rounded-l-page disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Rewrite
                                                    </button>
                                                    <button
                                                        type="button"
                                                        data-testid="rewrite-dropdown-toggle"
                                                        disabled={isPageLoading || isStreaming}
                                                        onClick={() => {
                                                            if (tagState.mode === 'normal' && tagState.showRegenerateDropdown) {
                                                                dispatchTagAction({ type: 'EXIT_TO_NORMAL' });
                                                            } else {
                                                                dispatchTagAction({ type: 'TOGGLE_DROPDOWN' });
                                                            }
                                                        }}
                                                        className="px-2 py-2 text-[var(--text-on-primary)] hover:opacity-90 transition-colors rounded-r-page border-l border-[var(--text-on-primary)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                {tagState.mode === 'normal' && tagState.showRegenerateDropdown && (
                                                    <div className="absolute top-full left-0 mt-1 w-48 bg-[var(--surface-secondary)] rounded-page shadow-warm-lg border border-[var(--border-default)] z-10">
                                                        <div className="py-1">
                                                            <button
                                                                data-testid="rewrite-with-tags"
                                                                disabled={isPageLoading || isStreaming}
                                                                onClick={async () => {
                                                                    await initializeTempTagsForRewriteWithTags();
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Rewrite with tags
                                                            </button>
                                                            <button
                                                                data-testid="edit-with-tags"
                                                                disabled={isPageLoading || isStreaming}
                                                                onClick={() => {
                                                                    dispatchTagAction({ type: 'ENTER_EDIT_MODE' });
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Edit with tags
                                                            </button>
                                                            <div className="border-t border-[var(--border-default)] my-1"></div>
                                                            <button
                                                                data-testid="rewrite-with-feedback"
                                                                disabled={isPageLoading || isStreaming}
                                                                onClick={handleOpenFeedbackPanel}
                                                                className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Rewrite with feedback
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving || !explanationTitle || !content || userSaved || isStreaming}
                                            data-testid="save-to-library"
                                            className="inline-flex items-center justify-center rounded-page bg-[var(--surface-secondary)] border border-[var(--border-default)] px-4 py-2 text-sm font-sans font-medium text-[var(--text-secondary)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] disabled:cursor-not-allowed disabled:opacity-50 h-9"
                                        >
                                            {isSaving ? 'Saving...' : userSaved ? 'Saved ✓' : 'Save'}
                                        </button>
                                        {(hasUnsavedChanges || explanationStatus === ExplanationStatus.Draft) && (
                                            <button
                                                onClick={handleSaveOrPublishChanges}
                                                disabled={isSavingChanges || (explanationStatus !== ExplanationStatus.Draft && !hasUnsavedChanges) || isStreaming}
                                                data-testid="publish-button"
                                                className="inline-flex items-center justify-center rounded-page bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] px-4 py-2 text-sm font-sans font-medium text-[var(--text-on-primary)] shadow-warm transition-all duration-200 hover:shadow-warm-md disabled:cursor-not-allowed disabled:opacity-50 h-9"
                                            >
                                                {isSavingChanges ? 'Publishing...' : 'Publish'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                            disabled={isStreaming}
                                            data-testid="format-toggle-button"
                                            className="inline-flex items-center justify-center rounded-page bg-[var(--surface-secondary)] border border-[var(--border-default)] px-4 py-2 text-sm font-sans font-medium text-[var(--text-secondary)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] disabled:cursor-not-allowed disabled:opacity-50 h-9"
                                        >
                                            {isMarkdownMode ? 'Plain Text' : 'Formatted'}
                                        </button>
                                        <button
                                            onClick={handleEditModeToggle}
                                            disabled={isStreaming}
                                            data-testid="edit-button"
                                            className="inline-flex items-center justify-center rounded-page bg-[var(--surface-secondary)] border border-[var(--border-default)] px-4 py-2 text-sm font-sans font-medium text-[var(--text-secondary)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] disabled:cursor-not-allowed disabled:opacity-50 h-9"
                                        >
                                            {isEditMode ? 'Done' : 'Edit'}
                                        </button>
                                    </div>

                                    {/* Mode dropdown - right side */}
                                    <div className="flex items-center gap-2">
                                        <label htmlFor="mode-select" className="text-xs font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                            Mode:
                                        </label>
                                        <select
                                            id="mode-select"
                                            value={mode}
                                            onChange={(e) => {
                                                setMode(e.target.value as MatchMode);
                                            }}
                                            disabled={isStreaming}
                                            data-testid="mode-select"
                                            className="rounded-page border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1.5 text-sm font-sans text-[var(--text-secondary)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)] disabled:cursor-not-allowed disabled:opacity-50 h-9"
                                        >
                                            <option value={MatchMode.Normal}>Normal</option>
                                            <option value={MatchMode.SkipMatch}>Skip Match</option>
                                            <option value={MatchMode.ForceMatch}>Force Match</option>
                                        </select>
                                    </div>
                                </div>
                                )}
                                
                                {/* Tags/Feedback section */}
                                <div className="mb-2">
                                    {showFeedbackPanel ? (
                                        <FeedbackPanel
                                            tagState={tagState}
                                            dispatchTagAction={dispatchTagAction}
                                            sources={sources}
                                            onSourcesChange={setSources}
                                            onApply={handleFeedbackPanelApply}
                                            onReset={handleFeedbackPanelReset}
                                            explanationId={explanationId}
                                            isStreaming={isStreaming}
                                            className="mb-2"
                                        />
                                    ) : (
                                        <TagBar
                                            tagState={tagState}
                                            dispatch={dispatchTagAction}
                                            className="mb-2"
                                            explanationId={explanationId}
                                            onTagClick={(tag) => {
                                                // Handle tag clicks here - you can implement search, filtering, etc.
                                                logger.debug('Tag clicked', { tag }, FILE_DEBUG);
                                                // Example: could trigger a search for explanations with this tag
                                                // or navigate to a tag-specific page
                                            }}
                                            tagBarApplyClickHandler={handleTagBarApplyClick}
                                            isStreaming={isStreaming}
                                        />
                                    )}
                                </div>
                                {/* Debug logging */}
                                {(() => {
                                    logger.debug('TagBar/FeedbackPanel props', {
                                        showFeedbackPanel,
                                        tagState,
                                        explanationId,
                                        sourcesCount: sources.length
                                    }, FILE_DEBUG);
                                    return null;
                                })()}
                                
                                {/* Scrollable Content Area */}
                                <div
                                    className="flex-1 overflow-y-auto"
                                    style={{
                                        height: 'calc(100vh - 300px)',
                                        scrollbarWidth: 'thin',
                                        scrollbarColor: 'rgba(156, 163, 175, 0.5) transparent'
                                    }}
                                >
                                    <style jsx>{`
                                        div::-webkit-scrollbar {
                                            width: 8px;
                                        }
                                        div::-webkit-scrollbar-track {
                                            background: transparent;
                                        }
                                        div::-webkit-scrollbar-thumb {
                                            background: rgba(156, 163, 175, 0.5);
                                            border-radius: 4px;
                                        }
                                        div::-webkit-scrollbar-thumb:hover {
                                            background: rgba(156, 163, 175, 0.7);
                                        }
                                        div::-webkit-scrollbar-thumb:active {
                                            background: rgba(156, 163, 175, 0.9);
                                        }
                                    `}</style>
                                    <div data-testid="explanation-content" className="scholar-card p-6">
                                        {(streamCompleted || (!isStreaming && content)) && <div data-testid="stream-complete" className="hidden" />}
                                        {isStreaming && !content ? (
                                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                                <div className="ink-dots"></div>
                                                <p className="text-sm font-serif text-[var(--text-muted)]">Writing...</p>
                                            </div>
                                        ) : isMarkdownMode ? (
                                            <>
                                                <LexicalEditor
                                                    ref={editorRef}
                                                    placeholder="Content will appear here..."
                                                    className="w-full"
                                                    initialContent={formattedExplanation}
                                                    isMarkdownMode={true}
                                                    isEditMode={isEditMode && !isStreaming}
                                                    showEditorState={false}
                                                    showTreeView={false}
                                                    showToolbar={true}
                                                    hideEditingUI={isStreaming}
                                                    onContentChange={handleEditorContentChange}
                                                    isStreaming={isStreaming}
                                                    textRevealEffect={textRevealEffect}
                                                    sources={bibliographySources}
                                                />
                                                <Bibliography sources={bibliographySources} />
                                            </>
                                        ) : (
                                            <pre className="whitespace-pre-wrap text-sm font-mono text-[var(--text-secondary)] leading-relaxed">
                                                {formattedExplanation}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        </div>
                    </div>

                    {/* Gap between main content and AI panel */}
                    <div className="w-8"></div>

                    {/* Detached AI Suggestions Panel */}
                    <div className="w-96 py-8 pr-4">
                        <AISuggestionsPanel
                            isVisible={!isStreaming}
                            currentContent={content}
                            editorRef={editorRef}
                            onContentChange={(newContent) => {
                                logger.debug('AISuggestionsPanel onContentChange called', {
                                    contentLength: newContent?.length || 0,
                                    hasEditorRef: !!editorRef.current
                                }, FILE_DEBUG);

                                setContent(newContent);

                                // CRITICAL: Directly update the editor with the new content
                                if (editorRef.current) {
                                    logger.debug('Updating editor with new content from AI suggestions', null, FILE_DEBUG);
                                    // Update both internal state and editor content
                                    setEditorCurrentContent(newContent);
                                    editorRef.current.setContentFromMarkdown(newContent);
                                } else {
                                    logger.error('editorRef.current is null - cannot update editor');
                                }
                            }}
                            onEnterEditMode={() => {
                                logger.debug('Entering edit mode via AI suggestions', null, FILE_DEBUG);
                                dispatchLifecycle({ type: 'ENTER_EDIT_MODE' });
                            }}
                            sessionData={explanationId && explanationTitle ? {
                                explanation_id: explanationId,
                                explanation_title: explanationTitle
                            } : undefined}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
}

export default function ResultsPage() {
    return (
        <Suspense fallback={
            <div className="h-screen bg-[var(--surface-primary)] flex flex-col items-center justify-center gap-4">
                <div className="ink-dots"></div>
                <p className="text-sm font-serif text-[var(--text-muted)]">Loading...</p>
            </div>
        }>
            <ResultsPageContent />
        </Suspense>
    );
} 