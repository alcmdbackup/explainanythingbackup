'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getExplanationByIdAction, saveExplanationToLibraryAction, isExplanationSavedByUserAction, getUserQueryByIdAction, createUserExplanationEventAction, getTagsForExplanationAction, getTempTagsForRewriteWithTagsAction, loadFromPineconeUsingExplanationIdAction } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { matchWithCurrentContentType, MatchMode, UserInputType, explanationBaseType, TagFullDbType, TagUIType, TagBarMode } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import Navigation from '@/components/Navigation';
import TagBar from '@/components/TagBar';
import { supabase_browser } from '@/lib/supabase';

const FILE_DEBUG = true;
const FORCE_REGENERATION_ON_NAV = false;

export default function ResultsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [prompt, setPrompt] = useState('');
    const [explanationTitle, setExplanationTitle] = useState('');
    const [content, setContent] = useState('');
    const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
    const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
    const [explanationData, setExplanationData] = useState<explanationBaseType | null>(null);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showMatches, setShowMatches] = useState(false);
    const [explanationId, setExplanationId] = useState<number | null>(null);
    const [userSaved, setUserSaved] = useState(false);
    const [userid, setUserid] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);
    const [tags, setTags] = useState<TagUIType[]>([]);
    const [tempTagsForRewriteWithTags, setTempTagsForRewriteWithTags] = useState<TagUIType[]>([]);
    const [originalTags, setOriginalTags] = useState<TagUIType[]>([]);
    const [showRegenerateDropdown, setShowRegenerateDropdown] = useState(false);
    const [modeOverride, setModeOverride] = useState<TagBarMode>(TagBarMode.Normal);
    const [isModified, setIsModified] = useState(false);
    const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);


    const isFirstRun = useRef(true);
    const regenerateDropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside and reset tags
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (regenerateDropdownRef.current && !regenerateDropdownRef.current.contains(event.target as Node)) {
                if (showRegenerateDropdown) {
                    setShowRegenerateDropdown(false);
                    // Reset tags to original state when closing dropdown
                    setTags(originalTags);
                    setTempTagsForRewriteWithTags([]);
                    setModeOverride(TagBarMode.Normal);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showRegenerateDropdown]);

    // Reset temp tags when modified state is reset
    useEffect(() => {
        if (modeOverride === TagBarMode.Normal && tempTagsForRewriteWithTags.length > 0) {
            setTempTagsForRewriteWithTags([]);
        }
    }, [modeOverride, tempTagsForRewriteWithTags.length]);

    /**
     * Determines if we're currently in rewrite with tags mode
     * 
     * • Returns true if tempTagsForRewriteWithTags has content
     * • Used to determine which tags to pass to TagBar and other components
     * • Provides a clean way to check rewrite mode without state tracking
     * 
     * Used by: TagBar component props, tag reset logic
     * Calls: None
     */
    const isInRewriteMode = () => tempTagsForRewriteWithTags.length > 0;

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
            setAuthError(`Authentication error: ${userError.message}`);
            setUserid(null);
            return null;
        }
        if (!userData?.user?.id) {
            setAuthError('No user data found - user may not be authenticated');
            setUserid(null);
            return null;
        }
        
        setUserid(userData.user.id);
        setAuthError(null);
        return userData.user.id;
    };

    /**
     * Initializes temporary tags for "rewrite with tags" functionality
     * 
     * • Fetches two preset tags from database: "medium" (ID 2) and "moderate" (ID 5)
     * • Converts database tags to TagUIType format with both active states set to true
     * • Uses getTempTagsForRewriteWithTagsAction to retrieve actual tag data
     * • Resets temporary tags to default state when called
     * 
     * Used by: "Rewrite with tags" button click handler
     * Calls: getTempTagsForRewriteWithTagsAction
     */
    const initializeTempTagsForRewriteWithTags = async () => {
        try {
            const result = await getTempTagsForRewriteWithTagsAction();
            if (result.success && result.data) {
                // Tags are already in the correct UI format with proper active states
                setTempTagsForRewriteWithTags(result.data);
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
    const initializeMode = (router: any, searchParams: URLSearchParams): MatchMode => {
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
     * Checks if the current explanation is saved by the user
     * 
     * • Validates that both explanationId and userid are available
     * • Calls isExplanationSavedByUserAction to check save status
     * • Updates userSaved state with the result
     * • Handles errors by setting userSaved to false
     * 
     * Used by: loadExplanation (when loading an explanation)
     * Calls: isExplanationSavedByUserAction
     */
    const checkUserSaved = async (targetExplanationId?: number) => {
        const idToCheck = targetExplanationId || explanationId;
        if (!idToCheck || !userid) return;
        try {
            const saved = await isExplanationSavedByUserAction(idToCheck, userid);
            setUserSaved(saved);
        } catch (err) {
            setUserSaved(false);
        }
    };

    /**
     * Loads an explanation by ID and updates the UI state
     * 
     * • Fetches explanation data from the database using getExplanationById
     * • Updates explanation title, content, and saved ID in component state
     * • Resets generation loading state to allow content display
     * • Enhances matches with current content if available
     * • Optionally clears the prompt based on clearPrompt parameter
     * • Resets tab to "Generated Output" to show the loaded content
     * • Fetches tags for the explanation
     * 
     * Used by: useEffect (initial page load), handleSubmit (when match found), View buttons in matches tab
     * Calls: getExplanationByIdAction, checkUserSaved, getTagsForExplanationAction
     */
    const loadExplanation = async (explanationId: number, clearPrompt: boolean, matches?: matchWithCurrentContentType[]) => {
        try {
            setError(null);
            const explanation = await getExplanationByIdAction(explanationId);
            
            if (!explanation) {
                setError('Explanation not found');
                return;
            }

            setExplanationTitle(explanation.explanation_title);
            setContent(explanation.content);
            setSystemSavedId(explanation.id);
            setExplanationId(explanation.id);
            if (matches) {
                setMatches(matches);
            }
            if (clearPrompt) {
                setPrompt('');
            }

            // Reset tab to "Generated Output" to show the loaded content
            // setActiveTab('output'); // This line is removed as per the new_code

            // Check if this explanation is saved by the user
            await checkUserSaved(explanation.id);

            // Reset temp tags when loading a new explanation
            setTempTagsForRewriteWithTags([]);

            // Fetch tags for the explanation
            const tagsResult = await getTagsForExplanationAction(explanation.id);
            if (tagsResult.success && tagsResult.data) {
                setTags(tagsResult.data);
                setOriginalTags(tagsResult.data); // Save original tags
            } else {
                logger.error('Failed to fetch tags for explanation:', { error: tagsResult.error });
                setTags([]);
                setOriginalTags([]);
            }

            // Load vector representation from Pinecone
            logger.debug('Attempting to load vector for explanation:', { 
                explanationId: explanation.id,
                explanationTitle: explanation.explanation_title 
            }, true);
            const vectorResult = await loadFromPineconeUsingExplanationIdAction(explanation.id);
            if (vectorResult.success) {
                if (vectorResult.data) {
                    // Ensure the vector data has the expected structure
                    let vectorData = vectorResult.data;
                    if (!vectorData.values && (vectorData as any).vector) {
                        vectorData = {
                            ...vectorData,
                            values: (vectorData as any).vector
                        };
                    }
                    
                    setExplanationVector(vectorData);
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
                        hasVector: 'vector' in (vectorData as any),
                        vectorType: typeof (vectorData as any).vector,
                        vectorLength: (vectorData as any).vector?.length || 0
                    }, true);
                } else {
                    // No vector found for this explanation (this is normal for older explanations)
                    setExplanationVector(null);
                    logger.debug('No vector found for explanation:', { 
                        found: false,
                        explanationId: explanation.id 
                    } ,true);
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

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load explanation';
            setError(errorMessage);
            logger.error('Failed to load explanation:', { error: errorMessage });
        }
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
            const userQuery = await getUserQueryByIdAction(userQueryId);
            
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
        logger.debug('handleUserAction called', { userInput, matchMode, prompt, systemSavedId, additionalRules }, FILE_DEBUG);
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
        setExplanationData(null);
        setContent('');
        setExplanationTitle('');
        setTags([]); // Reset tags when generating new explanation, but preserve temp tags for rewrite with tags
        setExplanationVector(null); // Reset vector when generating new explanation

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
            body: JSON.stringify(requestBody)
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
        let finalResult: any = null;
        let streamingContent = '';

        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'error') {
                            setError(data.error);
                            setIsPageLoading(false);
                            setIsStreaming(false);
                            setExplanationVector(null); // Reset vector on error

                            return;
                        }

                        if (data.type === 'streaming_start') {
                            setIsStreaming(true);
                        }

                        if (data.type === 'content') {
                            // Handle streaming content - update the UI in real-time
                            setContent(data.content);
                            // Ensure streaming state is true when receiving content
                            setIsStreaming(true);
                        }

                        if (data.type === 'streaming_end') {
                            setIsStreaming(false);
                        }

                        if (data.type === 'complete' && data.result) {
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
            return;
        }

        const { data, error, originalUserInput, matches, match_found, explanationId, userQueryId } = finalResult;

        logger.debug('API /returnExplanation result:', { data, error, originalUserInput, explanationId, userQueryId }, FILE_DEBUG);
        
        // Clear systemSavedId after the API call
        setSystemSavedId(null);
        

        
        if (error) {
            setError(error.message);
            setIsStreaming(false);
            setExplanationVector(null); // Reset vector on error
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
        console.log('modeOverride:', modeOverride);
        console.log('TagBarMode.RewriteWithTags:', TagBarMode.RewriteWithTags);
        console.log('prompt:', prompt);
        console.log('explanationTitle:', explanationTitle);
        console.log('userid:', userid);
        
        // Handle apply button click in rewrite or edit mode
        if (modeOverride === TagBarMode.RewriteWithTags) {
            console.log('Calling handleUserAction with RewriteWithTags');
            console.log('Current mode:', mode);
            // For rewrite with tags, use the current explanation title as input
            const inputForRewrite = explanationTitle || prompt;
            console.log('Using input for rewrite:', inputForRewrite);
            await handleUserAction(inputForRewrite, UserInputType.RewriteWithTags, mode, userid, tagDescriptions, null, null);
        } else if (modeOverride === TagBarMode.EditWithTags) {
            console.log('Calling handleUserAction with EditWithTags');
            console.log('Current mode:', mode);
            // For edit with tags, use the current explanation title as input
            const inputForEdit = explanationTitle || prompt;
            console.log('Using input for edit:', inputForEdit);
            await handleUserAction(inputForEdit, UserInputType.EditWithTags, mode, userid, tagDescriptions, null, null);
        } else {
            console.log('No matching mode found, modeOverride:', modeOverride);
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
            await saveExplanationToLibraryAction(explanationId, userid);
            setUserSaved(true);
        } catch (err: any) {
            setError(err.message || 'Failed to save explanation to library.');
        }
        setIsSaving(false);
    };

    const formattedExplanation = content ? content : '';

    /**
     * Handles clicks on custom standalone title links
     * 
     * • Detects clicks on links with "standalone-title:" prefix in href
     * • Extracts the actual standalone title from the href
     * • Either redirects to results page or calls handleUserAction based on FORCE_REGENERATION_ON_NAV setting
     * • Prevents default link behavior for these special links
     * 
     * Used by: Custom link component in ReactMarkdown
     * Calls: router.push, handleUserAction
     */
    const handleStandaloneTitleClick = async (href: string, event: React.MouseEvent) => {
        // Check if this is a standalone title link
        const isStandaloneLink = href.startsWith('/standalone-title?t=');
        
        if (isStandaloneLink) {
            event.preventDefault();
            
            // Extract the standalone title from the URL parameter
            const url = new URL(href, window.location.origin);
            const standaloneTitle = url.searchParams.get('t') || '';
            
            if (!standaloneTitle.trim()) return;
            
            if (FORCE_REGENERATION_ON_NAV) {
                // Redirect to results page with title parameter
                router.push(`/results?t=${encodeURIComponent(standaloneTitle)}`);
            } else {
                            // Call handleUserAction directly
            await handleUserAction(standaloneTitle, UserInputType.TitleFromLink, mode, userid, [], null, null);
            }
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
            setIsPageLoading(true);
            setIsStreaming(false); // Reset streaming state when processing new parameters
            
            // Immediately clear old content to prevent flash
            setExplanationTitle('');
            setContent('');
            setMatches([]);
            setError(null);
            setUserSaved(false);
            setExplanationId(null);
            setTags([]); // Reset tags when processing new parameters
            setExplanationVector(null); // Reset vector when processing new parameters

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
                        await loadExplanation(newExplanationIdFromUrl, true);
                        
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
    }, [searchParams]);
    //Comment - any time explanation id changes, the page should have already reloaded
    //No need to add to dependency array here

    // Save mode to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('explanation-mode', mode);
        
        // Verify it was actually saved
        const verifyStored = localStorage.getItem('explanation-mode');
    }, [mode]);

    // Handle clicking outside dropdown to close it
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (regenerateDropdownRef.current && !regenerateDropdownRef.current.contains(event.target as Node)) {
                setShowRegenerateDropdown(false);
            }
        };

        if (showRegenerateDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showRegenerateDropdown]);



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
                <div className="container mx-auto px-4 py-8 max-w-7xl h-full">
                    {error && (
                        <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md shadow-sm">
                            {error}
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
                                                            onClick={() => loadExplanation(match.explanation_id, false)}
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
                                {explanationTitle && !isPageLoading && !isStreaming && (
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between">
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
                                
                                {!isModified && !isPageLoading && !isStreaming && (
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
                                    {/* Action buttons - left side */}
                                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                        {(explanationTitle || content) && (
                                            <div className="relative inline-flex" ref={regenerateDropdownRef}>
                                                <div className="inline-flex items-center rounded-lg bg-blue-600 shadow-sm transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none">
                                                    <button
                                                        type="button"
                                                        disabled={isPageLoading}
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
                                                        className="px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors rounded-l-lg"
                                                    >
                                                        <span className="leading-none">Rewrite</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={isPageLoading}
                                                        onClick={() => {
                                                            if (showRegenerateDropdown) {
                                                                // Reset tags to original state when closing dropdown
                                                                setTags(originalTags);
                                                                setTempTagsForRewriteWithTags([]);
                                                            }
                                                            setShowRegenerateDropdown(!showRegenerateDropdown);
                                                        }}
                                                        className="px-2 py-2.5 text-white hover:bg-blue-700 transition-colors rounded-r-lg border-l border-blue-500"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                {showRegenerateDropdown && (
                                                    <div className="absolute top-full left-0 mt-1 w-48 bg-blue-600 rounded-md shadow-lg border border-blue-500 z-10">
                                                        <div className="py-1">
                                                            <button
                                                                onClick={async () => {
                                                                    setShowRegenerateDropdown(false);
                                                                    await initializeTempTagsForRewriteWithTags();
                                                                    setModeOverride(TagBarMode.RewriteWithTags);
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                                                            >
                                                                Rewrite with tags
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setShowRegenerateDropdown(false);
                                                                    setTags(originalTags); // Restore original tags for editing
                                                                    setModeOverride(TagBarMode.EditWithTags);
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
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
                                            disabled={isSaving || !explanationTitle || !content || userSaved}
                                            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                        >
                                            <span className="leading-none">{isSaving ? 'Saving...' : userSaved ? 'Saved' : 'Save'}</span>
                                        </button>
                                        <button
                                            onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                        >
                                            <span className="leading-none">{isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}</span>
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
                                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                        >
                                            <option value={MatchMode.Normal}>Normal</option>
                                            <option value={MatchMode.SkipMatch}>Skip Match</option>
                                            <option value={MatchMode.ForceMatch}>Force Match</option>
                                        </select>
                                    </div>
                                </div>
                                )}
                                
                                {/* Tags Bar - hidden during streaming */}
                                {!isStreaming && (
                                    <div className="mb-2">
                                        <TagBar 
                                            tags={isInRewriteMode() ? tempTagsForRewriteWithTags : tags} 
                                            setTags={isInRewriteMode() ? setTempTagsForRewriteWithTags : setTags}
                                            className="mb-2" 
                                            explanationId={explanationId}
                                            modeOverride={modeOverride}
                                            setModeOverride={setModeOverride}
                                            isModified={isModified}
                                            setIsModified={setIsModified}
                                            onTagClick={(tag) => {
                                                // Handle tag clicks here - you can implement search, filtering, etc.
                                                console.log('Tag clicked:', tag);
                                                // Example: could trigger a search for explanations with this tag
                                                // or navigate to a tag-specific page
                                            }}
                                            tagBarApplyClickHandler={handleTagBarApplyClick}
                                        />
                                    </div>
                                )}
                                {/* Debug logging */}
                                {(() => {
                                    console.log('TagBar props:', {
                                        isInRewriteMode: isInRewriteMode(),
                                        tempTagsForRewriteWithTags: tempTagsForRewriteWithTags,
                                        tags: tags,
                                        modeOverride: modeOverride,
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
                                    <div className="pt-2 pb-6 px-6 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/20 dark:border-gray-700/50 dark:shadow-xl dark:shadow-black/30">
                                        {isMarkdownMode ? (
                                            <article className="prose prose-lg dark:prose-invert max-w-none prose-headings:my-6 prose-h1:text-3xl prose-h1:font-bold prose-h1:text-gray-900 dark:prose-h1:text-white prose-p:my-4 prose-ul:my-4 prose-li:my-2 prose-pre:my-4 prose-blockquote:my-4 prose-code:bg-gray-100 dark:prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkMath]}
                                                    rehypePlugins={[rehypeKatex]}
                                                    components={{
                                                        p: (props: React.PropsWithChildren<{}>) => (
                                                            <div className="mt-1 mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">{props.children}</div>
                                                        ),
                                                        h1: (props: React.PropsWithChildren<{}>) => (
                                                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 mt-0 leading-tight">{props.children}</h1>
                                                        ),
                                                        h2: (props: React.PropsWithChildren<{}>) => (
                                                            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-3 mt-6 leading-tight">
                                                                {props.children}
                                                            </h2>
                                                        ),
                                                        h3: (props: React.PropsWithChildren<{}>) => (
                                                            <h3 className="text-xl font-medium text-gray-800 dark:text-gray-100 mb-2 mt-5 leading-tight">
                                                                {props.children}
                                                            </h3>
                                                        ),
                                                        ul: (props: React.PropsWithChildren<{}>) => (
                                                            <ul className="my-4 space-y-2 list-disc list-inside text-gray-700 dark:text-gray-300">{props.children}</ul>
                                                        ),
                                                        ol: (props: React.PropsWithChildren<{}>) => (
                                                            <ol className="my-4 space-y-2 list-decimal list-inside text-gray-700 dark:text-gray-300">{props.children}</ol>
                                                        ),
                                                        li: (props: React.PropsWithChildren<{}>) => (
                                                            <li className="my-1 leading-relaxed">{props.children}</li>
                                                        ),
                                                        code: (props: React.PropsWithChildren<{}>) => (
                                                            <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200">{props.children}</code>
                                                        ),
                                                        pre: (props: React.PropsWithChildren<{}>) => (
                                                            <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto my-4">{props.children}</pre>
                                                        ),
                                                        blockquote: (props: React.PropsWithChildren<{}>) => (
                                                            <blockquote className="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600 dark:text-gray-400">{props.children}</blockquote>
                                                        ),
                                                        a: (props: React.PropsWithChildren<{href?: string}>) => (
                                                            <a 
                                                                href={props.href}
                                                                onClick={(e) => props.href && handleStandaloneTitleClick(props.href, e)}
                                                                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer transition-colors"
                                                            >
                                                                {props.children}
                                                            </a>
                                                        )
                                                    }}
                                                >
                                                    {formattedExplanation}
                                                </ReactMarkdown>
                                            </article>
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
            </main>
        </div>
    );
} 