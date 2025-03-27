'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { generateAiExplanation, saveExplanation, saveUserQuery } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { sourceWithCurrentContentType, type SourceType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';
import Link from 'next/link';
import { getExplanationById } from '@/lib/services/explanations';
import { enhanceSourcesWithCurrentContent } from '@/actions/actions';

const FILE_DEBUG = true;

export default function Home() {
    const searchParams = useSearchParams();
    const [prompt, setPrompt] = useState('');
    const [explanationTitle, setExplanationTitle] = useState('');
    const [content, setContent] = useState('');
    const [sources, setSources] = useState<sourceWithCurrentContentType[]>([]);
    const [savedId, setSavedId] = useState<number | null>(null);
    const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
    const [isLoadingPageFromExplanationId, setIsLoadingPageFromExplanationId] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const loadExplanation = async (explanationId: number) => {
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
            setPrompt('');

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
        loadExplanation(parseInt(explanationId));
        setIsLoadingPageFromExplanationId(false);
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsGeneratingExplanation(true);
        setError(null);
        setSavedId(null);
        setSources([]);
        
        const { data, error } = await generateAiExplanation(prompt);
        
        if (error) {
            setError(error.message);
        } else if (!data?.explanation_title || !data?.content) {
            setError('Invalid explanation: Missing title or content');
        } else {
            setExplanationTitle(data.explanation_title);
            setContent(data.content);
            if (data.sources) {
                setSources(data.sources);
            }
            
            // Save user query with sources
            const { error: queryError } = await saveUserQuery(data);
            
            // Display sources if available
            if (data.sources?.length) {
                const sourcesSection = '\n\n## Related Sources\n' + 
                    data.sources.map(source => 
                        `- **Similarity: ${(source.ranking.similarity * 100).toFixed(1)}%**\n  ${source.text}`
                    ).join('\n\n');
                
                setContent(data.content + sourcesSection);
            }
            
            if (queryError) {
                logger.error('Failed to save user query:', { error: queryError });
            }
        }
        
        setIsGeneratingExplanation(false);
    };

    const handleSave = async () => {
        if (!prompt || !explanationTitle || !content || savedId) return;
        
        setIsSaving(true);
        const { success, error, id } = await saveExplanation(prompt, {
            explanation_title: explanationTitle,
            content: content,
            sources: sources
        });
        
        if (error) {
            setError(error);
        } else {
            setSavedId(id);
        }
        
        setIsSaving(false);
    };

    const formattedExplanation = explanationTitle && content ? `# ${explanationTitle}\n\n${content}` : '';

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            {isLoadingPageFromExplanationId ? (
                <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-gray-900">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600 dark:text-gray-300">Loading explanation...</p>
                    </div>
                </div>
            ) : (
                <main className="container mx-auto px-4 py-8 max-w-7xl">
                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                            AI Text Generator
                        </h1>
                        <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">
                            Enter your prompt below and let AI generate an explanation for you
                        </p>
                        <Link 
                            href="/explanations" 
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                            View all explanations →
                        </Link>
                    </div>
                    
                    <div className="flex gap-8 justify-center">
                        <div className="w-full max-w-2xl">
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Enter your prompt
                                    </label>
                                    <textarea
                                        id="prompt"
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        rows={4}
                                        placeholder="Type your prompt here..."
                                    />
                                </div>
                                
                                <button
                                    type="submit"
                                    disabled={isGeneratingExplanation || !prompt.trim()}
                                    className={`w-full px-4 py-2 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                                        explanationTitle || content ? 'bg-blue-700 hover:bg-blue-800' : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                >
                                    {isGeneratingExplanation ? 'Generating...' : explanationTitle || content ? 'Regenerate' : 'Generate'}
                                </button>
                            </form>

                            {error && (
                                <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
                                    {error}
                                </div>
                            )}

                            {(explanationTitle || content) && !isGeneratingExplanation && (
                                <div className="mt-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                            Explanation:
                                        </h3>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleSave}
                                                disabled={isSaving || !explanationTitle || !content || savedId !== null || isGeneratingExplanation}
                                                className="px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                {isSaving ? 'Saving...' : savedId !== null ? 'Already Saved' : 'Save'}
                                            </button>
                                            <button
                                                onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                {isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md">
                                        {isMarkdownMode ? (
                                            <article className="prose dark:prose-invert max-w-none prose-headings:my-4 prose-ul:my-2 prose-li:my-1 prose-pre:my-2">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkMath]}
                                                    rehypePlugins={[rehypeKatex]}
                                                    components={{
                                                        p: ({node, children}) => (
                                                            <div className="my-2">{children}</div>
                                                        ),
                                                        inlineMath: ({node, children}) => (
                                                            <InlineMath math={String(children).replace(/\$/g, '')} />
                                                        ),
                                                        math: ({node, children}) => (
                                                            <BlockMath math={String(children)} />
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
                            )}
                        </div>

                        {/* Sources Panel */}
                        <div className="w-96">
                            <div className="sticky top-8">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    Sources
                                </h2>
                                <div className="space-y-4">
                                    {sources && sources.length > 0 ? (
                                        sources.map((source, index) => (
                                            <div 
                                                key={index}
                                                className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow"
                                            >
                                                <div className="mb-2 flex items-center justify-between">
                                                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                        Similarity: {(source.ranking.similarity * 100).toFixed(1)}%
                                                    </span>
                                                    <button 
                                                        onClick={() => loadExplanation(source.explanation_id)}
                                                        className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                                    >
                                                        View →
                                                    </button>
                                                </div>
                                                <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                                                    {source.current_title || source.text}
                                                </h3>
                                                <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-3">
                                                    {source.current_content || source.text}
                                                </p>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400 text-center italic">
                                            No sources available yet. Generate an explanation to see related sources.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
}
