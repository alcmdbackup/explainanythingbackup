'use client';

import { useState, useEffect, useRef, useReducer } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { saveExplanationToLibraryAction, getUserQueryByIdAction, createUserExplanationEventAction, getTempTagsForRewriteWithTagsAction, saveOrPublishChanges } from '@/actions/actions';
import { matchWithCurrentContentType, MatchMode, UserInputType, explanationBaseType, TagUIType, TagBarMode, ExplanationStatus } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { clientPassRequestId } from '@/hooks/clientPassRequestId';
import Navigation from '@/components/Navigation';
import TagBar from '@/components/TagBar';
import ResultsLexicalEditor from '@/components/ResultsLexicalEditor';
import { ResultsLexicalEditorRef } from '@/components/ResultsLexicalEditor';
import AISuggestionsPanel from '@/components/AISuggestionsPanel';
import { supabase_browser } from '@/lib/supabase';
import { tagModeReducer, createInitialTagModeState, getCurrentTags, getTagBarMode, isTagsModified } from '@/reducers/tagModeReducer';
import { useExplanationLoader } from '@/hooks/useExplanationLoader';

const FILE_DEBUG = true;
const FORCE_REGENERATION_ON_NAV = false;

export default function ResultsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { withRequestId } = clientPassRequestId('anonymous');
    const [prompt, setPrompt] = useState('');
    const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showMatches, setShowMatches] = useState(false);
    const [userid, setUserid] = useState<string | null>(null);
    const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);
    const [tagState, dispatchTagAction] = useReducer(tagModeReducer, createInitialTagModeState());
    const [isEditMode, setIsEditMode] = useState(false);
    const [originalContent, setOriginalContent] = useState('');
    const [originalTitle, setOriginalTitle] = useState('');
    const [originalStatus, setOriginalStatus] = useState<ExplanationStatus | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSavingChanges, setIsSavingChanges] = useState(false);

    // Initialize explanation loader hook
    const {
        explanationId,
        explanationTitle,
        content,
        explanationStatus,
        explanationVector,
        systemSavedId,
        userSaved,
        isLoading: isLoadingExplanation,
        error: explanationError,
        setExplanationTitle,
        setContent,
        setExplanationStatus,
        setExplanationVector,
        setUserSaved,
        setError: setExplanationError,
        loadExplanation,
        clearSystemSavedId
    } = useExplanationLoader({
        onTagsLoad: (tags) => dispatchTagAction({ type: 'LOAD_TAGS', tags }),
        onMatchesLoad: (matches) => setMatches(matches),
        onClearPrompt: () => setPrompt(''),
        onSetOriginalValues: (content, title, status) => {
            setOriginalContent(content);
            setOriginalTitle(title);
            setOriginalStatus(status);
            setHasUnsavedChanges(false);
        }
    });


    const regenerateDropdownRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ResultsLexicalEditorRef>(null); // For AI suggestions panel

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
     * Fetches the current user's ID from authentication
     * 
     * • Retrieves user data from Supabase authentication
     * • Handles authentication errors and missing user data
     * • Updates component state with userid and auth error status
     * • Returns the userid for immediate use in other functions
     * 
     * Used by: useEffect (URL parameter processing)
     * Calls: supabase_browser.auth.getUser
     */
    const fetchUserid = async (): Promise<string | null> => {
        const { data: userData, error: userError } = await supabase_browser.auth.getUser();
        if (userError) {
            setUserid(null);
            return null;
        }
        if (!userData?.user?.id) {
            setUserid(null);
            return null;
        }

        setUserid(userData.user.id);
        return userData.user.id;
    };

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
                console.error('Failed to fetch temp tags for rewrite with tags:', result.error);
            }
        } catch (error) {
            console.error('Error initializing temp tags for rewrite with tags:', error);
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
            setError(null);
            const userQuery = await getUserQueryByIdAction(withRequestId({ id: userQueryId }));
            
            if (!userQuery) {
                setError('User query not found');
                return;
            }

            setPrompt(userQuery.user_query);
            setMatches(userQuery.matches || []);
            
            // Do not reset the active tab
            //setActiveTab('matches');

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load user query';
            setError(errorMessage);
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
    const handleUserAction = async (userInput: string, userInputType: UserInputType, matchMode: MatchMode, overrideUserid: string|null, additionalRules: string[], previousExplanationViewedId: number|null, previousExplanationViewedVector: { values: number[] } | null) => {
        logger.debug('handleUserAction called', { userInput, userInputType, matchMode, prompt, systemSavedId, additionalRules }, FILE_DEBUG);
        console.log('handleUserAction received matchMode:', matchMode);
        if (!userInput.trim()) return;
        
        const effectiveUserid = overrideUserid !== undefined ? overrideUserid : userid;
        
        if (!effectiveUserid) {
            setError('User not authenticated. Please log in to generate explanations.');
            return;
        }
        
        setIsPageLoading(true);
        setIsStreaming(false); // Reset streaming state
        setError(null);
        setMatches([]);
        setContent('');
        setExplanationTitle('');
        dispatchTagAction({ type: 'LOAD_TAGS', tags: [] }); // Reset tags when generating new explanation
        setExplanationVector(null); // Reset vector when generating new explanation
        setExplanationStatus(null); // Reset explanation status when generating new explanation

        // Add console debugging for tag rules
        if (additionalRules.length > 0) {
            console.log('Using additional rules for explanation generation:', additionalRules);
        }
        
        const requestBody = {
            userInput,
            savedId: systemSavedId,
            matchMode,
            userid: effectiveUserid,
            userInputType,
            additionalRules,
            existingContent: userInputType === UserInputType.EditWithTags ? formattedExplanation : undefined,
            previousExplanationViewedId,
            previousExplanationViewedVector
        };
        console.log('Sending request to API with matchMode:', matchMode, 'and body:', requestBody);
        
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

        const decoder = new TextDecoder();
        let finalResult: unknown = null;

        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;

            const chunk = decoder.decode(value);
            logger.debug('Client received chunk:', { chunkLength: chunk.length, chunk: chunk.substring(0, 200) }, FILE_DEBUG);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        console.log('Client received streaming data:', data);
                        logger.debug('Client received streaming data:', { data }, FILE_DEBUG);
                        
                        if (data.type === 'error') {
                            setError(data.error);
                            setIsPageLoading(false);
                            setIsStreaming(false);
                            setExplanationVector(null); // Reset vector on error
                            setExplanationStatus(null); // Reset status on error

                            return;
                        }

                        if (data.type === 'streaming_start') {
                            logger.debug('Client received streaming_start', { data }, FILE_DEBUG);
                            setIsStreaming(true);
                        }

                        if (data.type === 'content') {
                            // Handle streaming content - update the UI in real-time
                            logger.debug('Client received content', { contentLength: data.content?.length }, FILE_DEBUG);
                            setContent(data.content);
                            // Ensure streaming state is true when receiving content
                            setIsStreaming(true);
                        }

                        if (data.type === 'progress') {
                            // Handle progress events
                            console.log('Client received progress data:', data);
                            logger.debug('Received progress data:', { data }, FILE_DEBUG);
                            if (data.stage === 'title_generated' && data.title) {
                                setExplanationTitle(data.title);
                            }
                            if (data.stage === 'searching_matches' && data.title) {
                                setExplanationTitle(data.title);
                            }
                        }

                        if (data.type === 'streaming_end') {
                            logger.debug('Client received streaming_end', { data }, FILE_DEBUG);
                            // Do not set isStreaming to false at the end of streaming, keep the buttons disabled until page refreshes
                        }

                        if (data.type === 'complete' && data.result) {
                            logger.debug('Client received complete', { hasResult: !!data.result }, FILE_DEBUG);
                            finalResult = data.result;
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
            setError('No result received from server');
            setIsStreaming(false);
            setExplanationVector(null); // Reset vector on error
            setExplanationStatus(null); // Reset status on error
            return;
        }

        const { data, error, originalUserInput, explanationId, userQueryId } = finalResult as { data?: unknown; error?: { message: string }; originalUserInput?: string; explanationId?: number; userQueryId?: number };

        logger.debug('API /returnExplanation result:', { data, error, originalUserInput, explanationId, userQueryId }, FILE_DEBUG);

        // Clear systemSavedId after the API call
        clearSystemSavedId();
        

        
        if (error) {
            setError(error.message);
            setIsStreaming(false);
            setExplanationVector(null); // Reset vector on error
            setExplanationStatus(null); // Reset status on error
            // Loading state will be automatically managed by the content-watching useEffect
        } else {
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
        console.log('handleTagBarApplyClick called with tagDescriptions:', tagDescriptions);
        console.log('tagState.mode:', tagState.mode);
        console.log('prompt:', prompt);
        console.log('explanationTitle:', explanationTitle);
        console.log('userid:', userid);

        // Handle apply button click in rewrite or edit mode
        if (tagState.mode === 'rewriteWithTags') {
            console.log('Calling handleUserAction with RewriteWithTags');
            console.log('Current mode:', mode);
            // For rewrite with tags, use the current explanation title as input
            const inputForRewrite = explanationTitle || prompt;
            console.log('Using input for rewrite:', inputForRewrite);
            await handleUserAction(inputForRewrite, UserInputType.RewriteWithTags, mode, userid, tagDescriptions, null, null);
        } else if (tagState.mode === 'editWithTags') {
            console.log('Calling handleUserAction with EditWithTags');
            console.log('Current mode:', mode);
            // For edit with tags, use the current explanation title as input
            const inputForEdit = explanationTitle || prompt;
            console.log('Using input for edit:', inputForEdit);
            await handleUserAction(inputForEdit, UserInputType.EditWithTags, mode, userid, tagDescriptions, null, null);
        } else {
            console.log('No matching mode found, tagState.mode:', tagState.mode);
        }
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
        setError(null);
        try {
            logger.debug('Starting from handleSave', {}, true);
            await saveExplanationToLibraryAction(withRequestId({ explanationid: explanationId, userid }));
            setUserSaved(true);
        } catch (err) {
            setError((err as Error).message || 'Failed to save explanation to library.');
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
        if (!explanationId || (!hasUnsavedChanges && originalStatus !== ExplanationStatus.Draft) || isSavingChanges || !userid) return;

        setIsSavingChanges(true);
        setError(null);

        try {
            // Get current content from editor
            const currentContent = editorRef.current?.getContent() || content;

            // Always target Published status - consistent "Publish Changes" experience
            const targetStatus = ExplanationStatus.Published;

            const result = await saveOrPublishChanges(
                withRequestId({
                    explanationId,
                    newContent: currentContent,
                    newTitle: explanationTitle,
                    originalStatus: originalStatus!,
                    targetStatus
                })
            );

            if (result.success && result.id) {
                if (result.isNewExplanation) {
                    // For published articles: Navigate to the new published article
                    router.push(`/results?explanation_id=${result.id}`);
                } else {
                    // For draft articles: Force page reload
                    window.location.href = `/results?explanation_id=${result.id}`;
                }
            } else {
                setError(result.error?.message || 'Failed to publish changes');
            }
        } catch (err) {
            setError((err as Error).message || 'Failed to publish changes');
        }

        setIsSavingChanges(false);
    };

    const formattedExplanation = content ? content : '';

    /**
     * Handles edit mode toggle for Lexical editor
     */
    const handleEditModeToggle = () => {
        setIsEditMode(!isEditMode);
    };

    /**
     * Handles content changes from Lexical editor
     */
    const handleEditorContentChange = (newContent: string) => {
        console.log('🔄 handleEditorContentChange called');
        console.log('📝 newContent length:', newContent.length);
        console.log('📝 newContent preview:', newContent.substring(0, 100) + '...');
        console.log('📚 originalContent length:', originalContent.length);
        console.log('📚 originalContent preview:', originalContent.substring(0, 100) + '...');
        console.log('🏷️ explanationTitle:', explanationTitle);
        console.log('🏷️ originalTitle:', originalTitle);
        console.log('📊 originalStatus:', originalStatus);

         const hasChanges = newContent !== originalContent || explanationTitle !== originalTitle;
         console.log('🔍 Content changed:', newContent !== originalContent);
         console.log('🔍 Title changed:', explanationTitle !== originalTitle);
         console.log('✅ hasChanges:', hasChanges);

         setHasUnsavedChanges(hasChanges);

        // For published articles, show draft indicator when there are unsaved changes
         if (originalStatus === ExplanationStatus.Published && hasChanges) {
             console.log('🟡 Setting status to DRAFT (published article with changes)');
             setExplanationStatus(ExplanationStatus.Draft);
         } else if (!hasChanges) {
             console.log('🟢 Resetting status to original:', originalStatus);
             setExplanationStatus(originalStatus);
         } else {
             console.log('⚪ No status change (not published or other reason)');
         }

         console.log('📋 Final state - hasUnsavedChanges:', hasChanges);
         console.log('================================');
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
            await handleUserAction(query, UserInputType.Query, mode, userid, [], null, null);
        } else {
            router.push(`/results?q=${encodeURIComponent(query)}`);
        }
    };

    // Fetch userid once upfront
    useEffect(() => {
        fetchUserid();
    }, []);

    // Auto-manage loading state based on content availability and UI state
    useEffect(() => {
        // If we have explanation content loaded, turn off loading and ensure UI updates
        if ((explanationTitle || content) && !error) {
            setIsPageLoading(false);
            // Ensure streaming is off when content is fully loaded
            if (!isStreaming) {
                setIsStreaming(false);
            }
        }
        // If we have matches loaded but no content, and we're not generating, turn off loading
        else if (matches.length > 0 && !error && prompt && !explanationTitle && !content) {
            setIsPageLoading(false);
        }
        // If there's an error, turn off loading to show error state
        else if (error) {
            setIsPageLoading(false);
            setIsStreaming(false);
        }
    }, [explanationTitle, content, matches, error, prompt, explanationId, userSaved, isStreaming]);

    useEffect(() => {
        //Prevent this from double running in dev due to React strict mode
        //This breaks several things including search from top nav, maybe accept for now
        /*if (isFirstRun.current) {
            isFirstRun.current = false; // Mark as mounted
            return; // Skip running on mount
        }*/

        const processParams = async () => {
            // Initialize request ID for page load
            const pageLoadRequestId = `page-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            RequestIdContext.setClient({ requestId: pageLoadRequestId, userId: 'anonymous' });

            setIsPageLoading(true);
            setIsStreaming(false); // Reset streaming state when processing new parameters

            // Immediately clear old content to prevent flash
            setExplanationTitle('');
            setContent('');
            setMatches([]);
            setError(null);
            setUserSaved(false);
            dispatchTagAction({ type: 'LOAD_TAGS', tags: [] }); // Reset tags when processing new parameters
            setExplanationVector(null); // Reset vector when processing new parameters
            setExplanationStatus(null); // Reset explanation status when processing new parameters

            // Process mode first as an independent step
            const initialMode = initializeMode(router, searchParams);
            if (initialMode !== mode) {
                setMode(initialMode);
            }

            const urlExplanationId = searchParams.get('explanation_id');
            const urlUserQueryId = searchParams.get('userQueryId');
            const title = searchParams.get('t');
            const query = searchParams.get('q');

            const effectiveUserid = userid || await fetchUserid();
            
            if (query) {
                setPrompt(query);
            }
            
            // Handle title parameter first
            if (title) {
                logger.debug('useEffect: handleUserAction called with title', { title }, FILE_DEBUG);
                handleUserAction(title, UserInputType.TitleFromLink, initialMode, effectiveUserid, [], null, null);
                // Loading state will be managed automatically by content-watching useEffect
            } else if (query) {
                logger.debug('useEffect: handleUserAction called with query', { query }, FILE_DEBUG);
                handleUserAction(query, UserInputType.Query, initialMode, effectiveUserid, [], null, null);
                // Loading state will be managed automatically by content-watching useEffect
            } else {
                // Handle userQueryId parameter
                if (urlUserQueryId) {
                    const newUserQueryIdFromUrl = parseInt(urlUserQueryId);
                    
                    // Load user query data
                    await loadUserQuery(newUserQueryIdFromUrl);
                }
                
                // Only load explanation if it's different from the currently loaded one
                if (urlExplanationId) {
                    const newExplanationIdFromUrl = parseInt(urlExplanationId);

                    // Prevent loop: only load if this is a different explanation than currently loaded
                    if (newExplanationIdFromUrl !== explanationId) {
                        await loadExplanation(newExplanationIdFromUrl, true, effectiveUserid);

                        // Track explanation loaded event
                        if (effectiveUserid) {
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



    return (
        <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
            {/* Top Navigation Bar */}
            <Navigation 
                showSearchBar={true}
                searchBarProps={{
                    placeholder: "Search any topic...",
                    maxLength: 100,
                    initialValue: prompt,
                    onSearch: handleSearchSubmit,
                    disabled: isPageLoading || isStreaming
                }}
            />

            {/* Progress Bar */}
            {isPageLoading && (
                <div className="w-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-1 bg-blue-600 animate-pulse" style={{ width: '100%' }}></div>
                </div>
            )}

            <main className="flex-1 overflow-hidden">
                <div className="flex h-full">
                    {/* Main Content Area */}
                    <div className="flex-1 px-4 py-8">
                        {error && (
                            <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md shadow-sm">
                                {error}
                            </div>
                        )}

                        {/* Draft Status Banner */}
                        {explanationStatus === ExplanationStatus.Draft && (
                            <div className="max-w-2xl mx-auto mb-8 p-4 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-300 rounded-md shadow-sm">
                                <div className="flex items-center">
                                    <div className="ml-3">
                                        <p className="text-sm font-medium">
                                            {originalStatus === ExplanationStatus.Published && hasUnsavedChanges
                                                ? '✏️ Editing published article'
                                                : '📝 This is a draft article'
                                            }
                                        </p>
                                        <p className="text-xs mt-1">
                                            {originalStatus === ExplanationStatus.Published && hasUnsavedChanges
                                                ? 'Changes will create a new published version when published'
                                                : 'Click "Publish Changes" to publish this draft'
                                            }
                                        </p>
                                    </div>
                                </div>
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
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between">
                                            <h1 className="text-4xl font-bold text-gray-900 dark:text-white leading-tight">
                                                All Matches
                                            </h1>
                                            <button
                                                onClick={() => setShowMatches(false)}
                                                className="text-base text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                                            >
                                                ← Back
                                            </button>
                                        </div>
                                        <div className="mt-4 border-b-2 border-gray-300 dark:border-gray-600"></div>
                                    </div>
                                    <div className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm dark:shadow-lg dark:shadow-black/20">
                                        {matches && matches.length > 0 ? (
                                            matches.map((match, index) => (
                                                <div 
                                                    key={index}
                                                    className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 border border-gray-100 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
                                                >
                                                    <div className="mb-2 flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                                Similarity: {(match.ranking.similarity * 100).toFixed(1)}%
                                                            </span>
                                                            {match.ranking.diversity_score !== null && (
                                                                <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                                                                    Diversity: {(match.ranking.diversity_score * 100).toFixed(1)}%
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => loadExplanation(match.explanation_id, false, userid)}
                                                            className="text-sm text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 rounded"
                                                        >
                                                            View →
                                                        </button>
                                                    </div>
                                                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                                                        {match.current_title || match.text}
                                                    </h3>
                                                    <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-3">
                                                        {match.current_content || match.text}
                                                    </p>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400 text-center italic">
                                                No matches available yet. Generate an explanation to see related matches.
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
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between min-h-[2.5rem]">
                                            <h1 className="text-4xl font-bold text-gray-900 dark:text-white leading-tight">
                                                {explanationTitle}
                                            </h1>
                                            {matches && matches.length > 0 && (
                                                <button
                                                    onClick={() => setShowMatches(true)}
                                                    className="text-base text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                                                >
                                                    View all matches ({matches.length})
                                                </button>
                                            )}
                                        </div>
                                        <div className="mt-4 border-b-2 border-gray-300 dark:border-gray-600"></div>
                                    </div>
                                )}

                                {!isTagsModified(tagState) && !isPageLoading && (
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
                                    {/* Action buttons - left side */}
                                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                        {(explanationTitle || content) && (
                                            <div className="relative inline-flex" ref={regenerateDropdownRef}>
                                                <div className="inline-flex items-center rounded-lg bg-blue-600 shadow-sm transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none">
                                                    <button
                                                        type="button"
                                                        disabled={isPageLoading || isStreaming}
                                                        onClick={async () => {
                                                            // Main rewrite button - regenerate the article
                                                            // Use prompt if available, otherwise use explanation title
                                                            const userInput = prompt.trim() || explanationTitle;
                                                            if (!userInput) {
                                                                setError('No input available for rewriting. Please try again.');
                                                                return;
                                                            }
                                                            
                                                            // Add debug logging for rewrite operation
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
                                                        className="px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors rounded-l-lg disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        <span className="leading-none">Rewrite</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={isPageLoading || isStreaming}
                                                        onClick={() => {
                                                            if (tagState.mode === 'normal' && tagState.showRegenerateDropdown) {
                                                                // Close dropdown and reset to normal
                                                                dispatchTagAction({ type: 'EXIT_TO_NORMAL' });
                                                            } else {
                                                                // Toggle dropdown
                                                                dispatchTagAction({ type: 'TOGGLE_DROPDOWN' });
                                                            }
                                                        }}
                                                        className="px-2 py-2.5 text-white hover:bg-blue-700 transition-colors rounded-r-lg border-l border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                {tagState.mode === 'normal' && tagState.showRegenerateDropdown && (
                                                    <div className="absolute top-full left-0 mt-1 w-48 bg-blue-600 rounded-md shadow-lg border border-blue-500 z-10">
                                                        <div className="py-1">
                                                            <button
                                                                disabled={isPageLoading || isStreaming}
                                                                onClick={async () => {
                                                                    await initializeTempTagsForRewriteWithTags();
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Rewrite with tags
                                                            </button>
                                                            <button
                                                                disabled={isPageLoading || isStreaming}
                                                                onClick={() => {
                                                                    dispatchTagAction({ type: 'ENTER_EDIT_MODE' });
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Edit with tags
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving || !explanationTitle || !content || userSaved || isStreaming}
                                            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                        >
                                            <span className="leading-none">{isSaving ? 'Saving...' : userSaved ? 'Saved' : 'Save'}</span>
                                        </button>
                                        {/* Save/Publish Changes Button - shown when in edit mode with unsaved changes OR when viewing/editing a draft */}
                                        {((isEditMode && hasUnsavedChanges) || originalStatus === ExplanationStatus.Draft) && (
                                            <button
                                                onClick={handleSaveOrPublishChanges}
                                                disabled={isSavingChanges || (originalStatus !== ExplanationStatus.Draft && !hasUnsavedChanges) || isStreaming}
                                                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                            >
                                                <span className="leading-none">
                                                    {isSavingChanges
                                                        ? 'Publishing...'
                                                        : 'Publish Changes'
                                                    }
                                                </span>
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                            disabled={isStreaming}
                                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                        >
                                            <span className="leading-none">{isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}</span>
                                        </button>
                                        <button
                                            onClick={handleEditModeToggle}
                                            disabled={isStreaming}
                                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                        >
                                            <span className="leading-none">{isEditMode ? 'Done Editing' : 'Edit'}</span>
                                        </button>
                                    </div>
                                    
                                    {/* Mode dropdown - right side */}
                                    <div className="flex items-center gap-2">
                                        <label htmlFor="mode-select" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                            Mode:
                                        </label>
                                        <select
                                            id="mode-select"
                                            value={mode}
                                            onChange={(e) => {
                                                setMode(e.target.value as MatchMode);
                                            }}
                                            disabled={isStreaming}
                                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                        >
                                            <option value={MatchMode.Normal}>Normal</option>
                                            <option value={MatchMode.SkipMatch}>Skip Match</option>
                                            <option value={MatchMode.ForceMatch}>Force Match</option>
                                        </select>
                                    </div>
                                </div>
                                )}
                                
                                {/* Tags Bar - shown during streaming with only add tag button */}
                                <div className="mb-2">
                                    <TagBar
                                        tagState={tagState}
                                        dispatch={dispatchTagAction}
                                        className="mb-2"
                                        explanationId={explanationId}
                                        onTagClick={(tag) => {
                                            // Handle tag clicks here - you can implement search, filtering, etc.
                                            console.log('Tag clicked:', tag);
                                            // Example: could trigger a search for explanations with this tag
                                            // or navigate to a tag-specific page
                                        }}
                                        tagBarApplyClickHandler={handleTagBarApplyClick}
                                        isStreaming={isStreaming}
                                    />
                                </div>
                                {/* Debug logging */}
                                {(() => {
                                    console.log('TagBar props:', {
                                        tagState,
                                        explanationId: explanationId
                                    });
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
                                    <div className="pt-2 pb-6 px-6 bg-white/80 dark:bg-gray-800/80 rounded-xl shadow-lg border border-white/20 dark:border-gray-700/50 dark:shadow-xl dark:shadow-black/30">
                                        {isStreaming && !content ? (
                                            <div className="flex items-center justify-center py-12">
                                                <div className="flex space-x-1">
                                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                                </div>
                                            </div>
                                        ) : isMarkdownMode ? (
                                            <ResultsLexicalEditor
                                                ref={editorRef}
                                                content={formattedExplanation}
                                                isEditMode={isEditMode}
                                                onEditModeToggle={handleEditModeToggle}
                                                onContentChange={handleEditorContentChange}
                                                isStreaming={isStreaming}
                                                className="w-full"
                                            />
                                        ) : (
                                            <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-mono">
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
                            isVisible={true}
                            currentContent={content}
                            editorRef={editorRef}
                            onContentChange={(newContent) => {
                                setContent(newContent);
                                // Also call the existing handler if needed
                                // handleEditorContentChange(newContent);
                            }}
                            onEnterEditMode={() => setIsEditMode(true)}
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