'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { generateAiExplanation, saveExplanationAndTopic, saveUserQuery } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { matchWithCurrentContentType, UserQueryDataType, ExplanationInsertType, MatchMode } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import { getExplanationById } from '@/lib/services/explanations';
import { enhanceMatchesWithCurrentContent } from '@/lib/services/findMatches';
import Navigation from '@/components/Navigation';

const FILE_DEBUG = true;

export default function ResultsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [prompt, setPrompt] = useState('');
    const [explanationTitle, setExplanationTitle] = useState('');
    const [content, setContent] = useState('');
    const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
    const [savedId, setSavedId] = useState<number | null>(null);
    const [explanationData, setExplanationData] = useState<UserQueryDataType | null>(null);
    const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
    const [isLoadingPageFromExplanationId, setIsLoadingPageFromExplanationId] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'output' | 'matches'>('output');
    const [explanationId, setExplanationId] = useState<number | null>(null);

    const isFirstRun = useRef(true);

    /**
     * Loads an explanation by ID and updates the UI state
     * 
     * • Fetches explanation data from the database using getExplanationById
     * • Updates explanation title, content, and saved ID in component state
     * • Updates browser URL to reflect the current explanation being viewed
     * • Enhances matches with current content if available
     * • Optionally clears the prompt based on clearPrompt parameter
     * • Resets tab to "Generated Output" to show the loaded content
     * 
     * Used by: useEffect (initial page load), handleSubmit (when match found), View buttons in matches tab
     * Calls: getExplanationById, enhanceMatchesWithCurrentContent, router.push
     */
    const loadExplanation = async (explanationId: number, clearPrompt: boolean) => {
        try {
            setError(null);
            const explanation = await getExplanationById(explanationId);
            
            if (!explanation) {
                setError('Explanation not found');
                return;
            }

            setExplanationTitle(explanation.explanation_title);
            setContent(explanation.content);
            setSavedId(explanation.id);
            if (clearPrompt) {
                setPrompt('');
            }

            // Reset tab to "Generated Output" to show the loaded content
            setActiveTab('output');

            // Update the URL to reflect the current explanation being viewed
            router.push(`/results?explanation_id=${explanationId}`, { scroll: false });

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load explanation';
            setError(errorMessage);
            logger.error('Failed to load explanation:', { error: errorMessage });
        }
    };

    useEffect(() => {
        //Prevent this from double running in dev due to React strict mode
        if (isFirstRun.current) {
            isFirstRun.current = false; // Mark as mounted
            return; // Skip running on mount
        }

        const explanationId = searchParams.get('explanation_id');
        const query = searchParams.get('q');
        
        if (query) {
            setPrompt(query);
        }
        
        if (explanationId) {
            setIsLoadingPageFromExplanationId(true);
            loadExplanation(parseInt(explanationId), true);
            setIsLoadingPageFromExplanationId(false);
        } else if (query) {
            logger.debug('useEffect: handleSubmit called with query', { query }, FILE_DEBUG);
            handleSubmit(query);
        }
    }, [searchParams]);

    /**
     * Generates AI explanation for a query or regenerates existing explanation
     * 
     * • Calls generateAiExplanation with the search query and current savedId
     * • Handles both new explanations and existing matches
     * • Updates UI state with explanation data and matches
     * • Saves user query to database for new explanations
     * • Manages loading states and error handling
     * 
     * Used by: useEffect (initial query), Regenerate button, direct function calls
     * Calls: generateAiExplanation, loadExplanation, saveUserQuery
     */
    const handleSubmit = async (query?: string, matchMode: MatchMode = MatchMode.Normal) => {
        logger.debug('handleSubmit called', { query, matchMode, prompt, savedId }, FILE_DEBUG);
        const searchQuery = query || prompt;
        if (!searchQuery.trim()) return;
        
        setIsGeneratingExplanation(true);
        setError(null);
        setMatches([]);
        setExplanationData(null);
        
        const { data, error, originalUserQuery } = await generateAiExplanation(
            searchQuery, 
            savedId, 
            matchMode
        );
        logger.debug('generateAiExplanation result:', { data, error, originalUserQuery }, FILE_DEBUG);
        
        // Clear savedId after the API call
        setSavedId(null);
        
        // Update the prompt with the original user query (if needed)
        if (originalUserQuery && originalUserQuery !== searchQuery) {
            setPrompt(originalUserQuery);
        }
        
        if (error) {
            setError(error.message);
        } else if (!data) {
            setError('No response received');
        } else if (data.match_found) {
            await loadExplanation(data.data.explanation_id, false);
            // Save user query for match_found case
            if (explanationData && data.data.explanation_id != null) {
                const { error: userQueryError } = await saveUserQuery(explanationData, data.data.explanation_id);
                if (userQueryError) {
                    logger.error('Failed to save user query:', { error: userQueryError });
                }
            }
        } else {
            // New explanation generated - set the data
            const explanationData = data.data; // This contains the UserQueryDataType data
            setExplanationData(explanationData);
            setExplanationTitle(explanationData.explanation_title);
            setContent(explanationData.content);
            
            if (explanationData.matches) {
                setMatches(explanationData.matches); // Only set matches
            }
            
            // Save user query with matches
            const { error: explanationTopicError, id: newExplanationId } = await saveExplanationAndTopic(prompt, explanationData);
            if (explanationTopicError) {
                logger.error('Failed to save explanation and topic:', { error: explanationTopicError });
            } else {
                setExplanationId(newExplanationId);
            }
            
            if (newExplanationId == null) {
                setError('Failed to save explanation: missing explanation ID.');
                setIsGeneratingExplanation(false);
                return;
            }
            
            const { error: userQueryError } = await saveUserQuery(explanationData, newExplanationId);
            if (userQueryError) {
                logger.error('Failed to save user query:', { error: userQueryError });
            }
        }
        
        setIsGeneratingExplanation(false);
    };

    /**
     * Saves the current explanation and topic to the database
     * 
     * • Validates required data (prompt, title, content, explanationData)
     * • Calls saveExplanationAndTopic to persist data
     * • Updates savedId state on successful save
     * • Handles error states and loading indicators
     * 
     * Used by: Save button in the UI
     * Calls: saveExplanationAndTopic
     */
    const handleSave = async () => {
        if (!prompt || !explanationTitle || !content || savedId || !explanationData) return;
        
        setIsSaving(true);
        
        const { success, error, id } = await saveExplanationAndTopic(prompt, explanationData);
        
        if (error) {
            setError(error.message);
        } else {
            setSavedId(id);
        }
        
        setIsSaving(false);
    };

    const formattedExplanation = explanationTitle && content ? `# ${explanationTitle}\n\n${content}` : '';

    /**
     * Handles search form submission and navigates to results page
     * 
     * • Validates search query is not empty
     * • Navigates to results page with query parameter
     * • Triggers new explanation generation on page load
     * 
     * Used by: SearchBar component in navigation
     * Calls: router.push
     */
    const handleSearchSubmit = (query: string) => {
        if (!query.trim()) return;
        router.push(`/results?q=${encodeURIComponent(query)}`);
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Top Navigation Bar */}
            <Navigation 
                showSearchBar={true}
                searchBarProps={{
                    placeholder: "Search any topic...",
                    maxLength: 100,
                    initialValue: prompt,
                    onSearch: handleSearchSubmit
                }}
            />

            {/* Progress Bar */}
            {(isGeneratingExplanation || isLoadingPageFromExplanationId) && (
                <div className="w-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-1 bg-blue-600 animate-pulse" style={{ width: '100%' }}></div>
                </div>
            )}

            {isLoadingPageFromExplanationId ? (
                <div className="fixed inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600 dark:text-gray-300">Loading explanation...</p>
                    </div>
                </div>
            ) : (
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
                            (explanationTitle || content) && !isGeneratingExplanation && (
                                <div className="mt-2">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                        {/* Action buttons - right-aligned on desktop, full-width on mobile */}
                                        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                            {(explanationTitle || content) && !isGeneratingExplanation && (
                                                <button
                                                    type="button"
                                                    disabled={isGeneratingExplanation || !prompt.trim()}
                                                    onClick={() => handleSubmit()}
                                                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                                >
                                                    <span className="leading-none">Regenerate</span>
                                                </button>
                                            )}
                                            <button
                                                onClick={handleSave}
                                                disabled={isSaving || !explanationTitle || !content || savedId !== null || isGeneratingExplanation}
                                                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 h-10 leading-none"
                                            >
                                                <span className="leading-none">{isSaving ? 'Saving...' : savedId !== null ? 'Saved' : 'Save'}</span>
                                            </button>
                                            <button
                                                onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 h-10 leading-none"
                                            >
                                                <span className="leading-none">{isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}</span>
                                            </button>
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
                                                            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-3 mt-6 leading-tight">{props.children}</h2>
                                                        ),
                                                        h3: (props: React.PropsWithChildren<{}>) => (
                                                            <h3 className="text-xl font-medium text-gray-800 dark:text-gray-100 mb-2 mt-5 leading-tight">{props.children}</h3>
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
            )}
        </div>
    );
} 