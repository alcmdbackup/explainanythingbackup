'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { generateAiExplanation, saveExplanationAndTopic, saveUserQuery } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { sourceWithCurrentContentType, type SourceType, UserQueryInsertType, ExplanationInsertType, MatchMode } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import Link from 'next/link';
import { getExplanationById } from '@/lib/services/explanations';
import { enhanceSourcesWithCurrentContent } from '@/actions/actions';
import type { Components } from 'react-markdown';

const FILE_DEBUG = true;

export default function Home() {
    const searchParams = useSearchParams();
    const [prompt, setPrompt] = useState('');
    const [explanationTitle, setExplanationTitle] = useState('');
    const [content, setContent] = useState('');
    const [sources, setSources] = useState<sourceWithCurrentContentType[]>([]);
    const [matches, setMatches] = useState<sourceWithCurrentContentType[]>([]);
    const [savedId, setSavedId] = useState<number | null>(null);
    const [explanationData, setExplanationData] = useState<UserQueryInsertType | null>(null);
    const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
    const [isLoadingPageFromExplanationId, setIsLoadingPageFromExplanationId] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isPromptModified, setIsPromptModified] = useState(false);
    const [activeTab, setActiveTab] = useState<'output' | 'matches'>('output');
    const [dropdownOpen, setDropdownOpen] = useState(false);

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
            setIsPromptModified(false);

            // If there are sources, enhance them with current content
            if (explanation.sources?.length) {
                logger.debug('Found sources in explanation:', { 
                    sourceCount: explanation.sources.length,
                    sources: explanation.sources 
                }, FILE_DEBUG);
                
                const enhancedSources = await enhanceSourcesWithCurrentContent(
                    explanation.sources.map(source => ({
                        metadata: {
                            explanation_id: source.explanation_id,
                            text: source.text
                        },
                        score: source.ranking.similarity
                    }))
                );
                
                logger.debug('Enhanced sources:', { 
                    enhancedSourceCount: enhancedSources.length,
                    enhancedSources 
                }, FILE_DEBUG);
                
                setSources(enhancedSources);
            } else {
                logger.debug('No sources found in explanation', {}, FILE_DEBUG);
                setSources([]);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load explanation';
            setError(errorMessage);
            logger.error('Failed to load explanation:', { error: errorMessage });
        }
    };

    useEffect(() => {
        const explanationId = searchParams.get('explanation_id');
        if (!explanationId) return;
        setIsLoadingPageFromExplanationId(true);
        loadExplanation(parseInt(explanationId), true);
        setIsLoadingPageFromExplanationId(false);
    }, [searchParams]);

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPrompt(e.target.value);
        if (explanationTitle || content) {
            setIsPromptModified(true);
        }
    };

    /**
     * handleSubmit
     * - Handles form submission for generating or matching explanations.
     * - Calls generateAiExplanation and processes its result.
     * - Updates state for prompt, matches, explanation data, errors, and loading flags.
     * - Handles saving user queries if a new explanation is generated.
     * - Used as the onSubmit handler for the main form and match mode buttons.
     */
    const handleSubmit = async (e: React.FormEvent, matchMode: MatchMode = MatchMode.Normal) => {
        e.preventDefault();
        setIsPromptModified(false);
        setIsGeneratingExplanation(true);
        setError(null);
        setSources([]);
        setMatches([]);
        setExplanationData(null);
        
        const { data, error, originalUserQuery } = await generateAiExplanation(
            prompt, 
            savedId, 
            matchMode
        );
        logger.debug('generateAiExplanation result:', { data, error, originalUserQuery }, FILE_DEBUG);
        
        // Clear savedId after the API call
        setSavedId(null);
        
        // Update the prompt with the original user query (if needed)
        if (originalUserQuery && originalUserQuery !== prompt) {
            setPrompt(originalUserQuery);
        }
        
        if (error) {
            setError(error.message);
        } else if (!data) {
            setError('No response received');
        } else if (data.match_found) {
            if (data.data.sources) {
                setMatches(data.data.sources);
            }
            await loadExplanation(data.data.explanation_id, false);
        } else {
            // New explanation generated - set the data
            const explanationData = data.data; // This contains the UserQueryInsertType data
            setExplanationData(explanationData);
            setExplanationTitle(explanationData.explanation_title);
            setContent(explanationData.content);
            
            if (explanationData.sources) {
                setMatches(explanationData.sources); // Only set matches
            }
            
            // Save user query with sources
            const { error: queryError } = await saveUserQuery(explanationData);
            
            if (queryError) {
                logger.error('Failed to save user query:', { error: queryError });
            }
        }
        
        setIsGeneratingExplanation(false);
    };

    const handleSave = async () => {
        if (!prompt || !explanationTitle || !content || savedId || !explanationData) return;
        
        setIsSaving(true);
        
        const { success, error, id } = await saveExplanationAndTopic(prompt, explanationData);
        
        if (error) {
            setError(error);
        } else {
            setSavedId(id);
        }
        
        setIsSaving(false);
    };

    const formattedExplanation = explanationTitle && content ? `# ${explanationTitle}\n\n${content}` : '';

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {isLoadingPageFromExplanationId ? (
                <div className="fixed inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600 dark:text-gray-300">Loading explanation...</p>
                    </div>
                </div>
            ) : (
                <main className="container mx-auto px-4 py-8 max-w-7xl">
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-semibold text-gray-900 dark:text-white mb-2 tracking-wide font-proxima">
                            Explain Anything
                        </h1>
                        <p className="text-base text-gray-600 dark:text-gray-300">
                            Learn about any topic
                        </p>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="w-full max-w-2xl">
                            <form onSubmit={(e) => handleSubmit(e, MatchMode.Normal)} className="space-y-4">
                                <div>
                                    <div className="flex items-start gap-2">
                                        <textarea
                                            id="prompt"
                                            value={prompt}
                                            onChange={handlePromptChange}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 dark:bg-gray-800 dark:border-gray-600 dark:text-white dark:shadow-lg dark:shadow-black/20 resize-none"
                                            rows={1}
                                            maxLength={150}
                                            placeholder="Type your prompt here..."
                                        />
                                        <div className="min-w-[140px]">
                                            <button
                                                type="button"
                                                disabled={isGeneratingExplanation || !prompt.trim()}
                                                onClick={(e) => handleSubmit(e as any, MatchMode.Normal)}
                                                className={`w-full h-full px-4 py-2 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ${
                                                    explanationTitle || content ? 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg' : 'bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md'
                                                } flex justify-center items-center`}
                                            >
                                                {isGeneratingExplanation ? 'Generating...' : 'Search Topic'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                            {error && (
                                <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md shadow-sm">
                                    {error}
                                </div>
                            )}
                        </div>
                        {/* Tabs */}
                        <div className="w-full max-w-4xl mt-8">
                            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4 justify-between items-center">
                                <div className="flex">
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
                                <Link 
                                    href="/explanations" 
                                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 rounded"
                                >
                                    View all explanations →
                                </Link>
                            </div>
                            {/* Tab Content */}
                            {activeTab === 'output' && (
                                (explanationTitle || content) && !isGeneratingExplanation && (
                                    <div className="mt-2">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex gap-2">
                                                {(explanationTitle || content) && !isGeneratingExplanation && (
                                                    <div className="relative min-w-[140px]">
                                                        <button
                                                            type="button"
                                                            disabled={isGeneratingExplanation || !prompt.trim()}
                                                            onClick={(e) => handleSubmit(e as any, MatchMode.Normal)}
                                                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 flex items-center justify-between w-full"
                                                        >
                                                            Regenerate
                                                            <svg className="ml-2 h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.293l3.71-4.06a.75.75 0 111.08 1.04l-4.25 4.65a.75.75 0 01-1.08 0l-4.25-4.65a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
                                                        </button>
                                                    </div>
                                                )}
                                                <button
                                                    onClick={handleSave}
                                                    disabled={isSaving || !explanationTitle || !content || savedId !== null || isGeneratingExplanation}
                                                    className="px-3 py-1 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                                                >
                                                    {isSaving ? 'Saving...' : savedId !== null ? 'Already Saved' : 'Save'}
                                                </button>
                                                <button
                                                    onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                                                >
                                                    {isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 dark:shadow-lg dark:shadow-black/20">
                                            {isMarkdownMode ? (
                                                <article className="prose dark:prose-invert max-w-none prose-headings:my-4 prose-ul:my-2 prose-li:my-1 prose-pre:my-2">
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkMath]}
                                                        rehypePlugins={[rehypeKatex]}
                                                        components={{
                                                            p: (props: React.PropsWithChildren<{}>) => (
                                                                <div className="my-2">{props.children}</div>
                                                            )
                                                        }}
                                                    >
                                                        {formattedExplanation}
                                                    </ReactMarkdown>
                                                </article>
                                            ) : (
                                                <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
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
                                                            onClick={() => loadExplanation(match.explanation_id, true)}
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
                    </div>
                </main>
            )}
        </div>
    );
}
