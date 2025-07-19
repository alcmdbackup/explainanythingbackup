'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { generateExplanation, saveUserQuery, getExplanationByIdAction, saveExplanationToLibraryAction, isExplanationSavedByUserAction, getUserQueryByIdAction } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { matchWithCurrentContentType, MatchMode, UserInputType, explanationBaseType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import Navigation from '@/components/Navigation';
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
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'output' | 'matches'>('output');
    const [explanationId, setExplanationId] = useState<number | null>(null);
    const [userSaved, setUserSaved] = useState(false);
    const [userid, setUserid] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);

    const isFirstRun = useRef(true);

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
        
        console.log('initializeMode debug:', {
            urlMode,
            savedMode,
            currentMode: mode,
            matchModeValues: Object.values(MatchMode),
            urlModeValid: urlMode && Object.values(MatchMode).includes(urlMode),
            savedModeValid: savedMode && Object.values(MatchMode).includes(savedMode)
        });
        
        // Priority: URL > localStorage > default
        let initialMode = MatchMode.Normal;
        if (urlMode && Object.values(MatchMode).includes(urlMode)) {
            initialMode = urlMode;
            console.log('Using URL mode:', initialMode);
        } else if (savedMode && Object.values(MatchMode).includes(savedMode)) {
            initialMode = savedMode;
            console.log('Using saved mode:', initialMode);
        } else {
            console.log('Using default mode:', initialMode);
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
     * 
     * Used by: useEffect (initial page load), handleSubmit (when match found), View buttons in matches tab
     * Calls: getExplanationByIdAction, checkUserSaved
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
            setActiveTab('output');

            // Check if this explanation is saved by the user
            await checkUserSaved(explanation.id);

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
     * Generates explanation using user provided query or title from link
     * 
     * • Calls generateExplanation with the search query and current systemSavedId
     * • Handles both new explanations and existing matches
     * • Updates UI state with explanation data and matches
     * • Saves user query to database for new explanations
     * • Manages loading states and error handling
     * • Accepts optional userid parameter to override state variable
     * 
     * Used by: useEffect (initial query), Regenerate button, direct function calls
     * Calls: generateExplanation, loadExplanation, saveUserQuery
     */
    const handleUserAction = async (userInput: string, userInputType: UserInputType, matchMode: MatchMode = MatchMode.Normal, overrideUserid?: string | null) => {
        logger.debug('handleUserAction called', { userInput, matchMode, prompt, systemSavedId }, FILE_DEBUG);
        if (!userInput.trim()) return;
        
        const effectiveUserid = overrideUserid !== undefined ? overrideUserid : userid;
        
        if (!effectiveUserid) {
            setError('User not authenticated. Please log in to generate explanations.');
            return;
        }
        
        setIsLoading(true);
        setError(null);
        setMatches([]);
        setExplanationData(null);
        setContent('');
        setExplanationTitle('');
        
        const { data, error, originalUserInput, matches, match_found, explanationId, userQueryId } = await generateExplanation(
            userInput, 
            systemSavedId, 
            matchMode,
            effectiveUserid,
            userInputType
        );

        logger.debug('generateExplanation result:', { data, error, originalUserInput, explanationId, userQueryId }, FILE_DEBUG);
        
        // Clear systemSavedId after the API call
        setSystemSavedId(null);
        
        if (error) {
            setError(error.message);
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
        console.log('handleSave called with:', { explanationId, userSaved, isSaving });
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

    const formattedExplanation = explanationTitle && content ? `# ${explanationTitle}\n\n${content}` : '';

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
                await handleUserAction(standaloneTitle, UserInputType.TitleFromLink, mode);
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
            await handleUserAction(query, UserInputType.Query, mode);
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
            setIsLoading(false);
        }
        // If we have matches loaded but no content, and we're not generating, turn off loading
        else if (matches.length > 0 && !error && prompt && !explanationTitle && !content) {
            setIsLoading(false);
        }
        // If there's an error, turn off loading to show error state
        else if (error) {
            setIsLoading(false);
        }
    }, [explanationTitle, content, matches, error, prompt, explanationId, userSaved]);

    useEffect(() => {
        //Prevent this from double running in dev due to React strict mode
        //This breaks several things including search from top nav, maybe accept for now
        /*if (isFirstRun.current) {
            isFirstRun.current = false; // Mark as mounted
            return; // Skip running on mount
        }*/

        const processParams = async () => {
            setIsLoading(true);

            // Process mode first as an independent step
            const initialMode = initializeMode(router, searchParams);
            console.log('processParams mode check:', { initialMode, currentMode: mode, willUpdate: initialMode !== mode });
            if (initialMode !== mode) {
                console.log('Updating mode from', mode, 'to', initialMode);
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
                handleUserAction(title, UserInputType.TitleFromLink, initialMode, effectiveUserid);
                // Loading state will be managed automatically by content-watching useEffect
            } else if (query) {
                logger.debug('useEffect: handleUserAction called with query', { query }, FILE_DEBUG);
                handleUserAction(query, UserInputType.Query, initialMode, effectiveUserid);
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
        console.log('Saving mode to localStorage:', mode);
        localStorage.setItem('explanation-mode', mode);
        
        // Verify it was actually saved
        const verifyStored = localStorage.getItem('explanation-mode');
        console.log('Verified localStorage contains:', verifyStored);
    }, [mode]);



    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Top Navigation Bar */}
            <Navigation 
                showSearchBar={true}
                searchBarProps={{
                    placeholder: "Search any topic...",
                    maxLength: 100,
                    initialValue: prompt,
                    onSearch: handleSearchSubmit,
                    disabled: isLoading
                }}
            />

            {/* Progress Bar */}
            {isLoading && (
                <div className="w-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-1 bg-blue-600 animate-pulse" style={{ width: '100%' }}></div>
                </div>
            )}

            <main className="container mx-auto px-4 py-8 max-w-7xl">
                {error && (
                    <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md shadow-sm">
                        {error}
                    </div>
                )}
                
                {/* Tabs */}
                <div className="w-full max-w-4xl mx-auto">
                    <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
                        <button
                            className={`px-6 py-2 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors ${activeTab === 'output' ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
                            onClick={() => setActiveTab('output')}
                        >
                            Generated Output
                        </button>
                        <button
                            className={`ml-4 px-6 py-2 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors ${activeTab === 'matches' ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'}`}
                            onClick={() => setActiveTab('matches')}
                        >
                            Matches
                        </button>
                    </div>
                    {/* Tab Content */}
                    {activeTab === 'output' && (
                        (explanationTitle || content) && (!isLoading) && (
                            <div className="mt-2">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                    {/* Action buttons - left side */}
                                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                        {(explanationTitle || content) && (
                                            <button
                                                type="button"
                                                disabled={isLoading}
                                                onClick={() => handleUserAction(explanationTitle, UserInputType.TitleFromRegenerate, mode)}
                                                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                            >
                                                <span className="leading-none">Regenerate</span>
                                            </button>
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
                                                console.log('Dropdown changed from', mode, 'to', e.target.value);
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
                                <div className="p-6 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/20 dark:border-gray-700/50 dark:shadow-xl dark:shadow-black/30">
                                    {isMarkdownMode ? (
                                        <article className="prose prose-lg dark:prose-invert max-w-none prose-headings:my-6 prose-h1:text-3xl prose-h1:font-bold prose-h1:text-gray-900 dark:prose-h1:text-white prose-p:my-4 prose-ul:my-4 prose-li:my-2 prose-pre:my-4 prose-blockquote:my-4 prose-code:bg-gray-100 dark:prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                                components={{
                                                    p: (props: React.PropsWithChildren<{}>) => (
                                                        <div className="my-4 text-gray-700 dark:text-gray-300 leading-relaxed">{props.children}</div>
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
                        )
                    )}
                    {activeTab === 'matches' && (
                        <div className="mt-2">
                            <div className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm dark:shadow-lg dark:shadow-black/20">
                                {matches && matches.length > 0 ? (
                                    matches.map((match, index) => (
                                        <div 
                                            key={index}
                                            className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 border border-gray-100 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
                                        >
                                            <div className="mb-2 flex items-center justify-between">
                                                <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                    Similarity: {(match.ranking.similarity * 100).toFixed(1)}%
                                                </span>
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
                    )}
                </div>
            </main>
        </div>
    );
} 