'use client';

import { useState, useEffect } from 'react';
import { generateAIResponse, saveSearch } from '@/actions/actions';
import { getRecentSearches } from '@/lib/services/searchService';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Search } from '@/types/database';
import { logger } from '@/lib/utilities';

export default function Home() {
    const [prompt, setPrompt] = useState('');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [recentSearches, setRecentSearches] = useState<Search[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadRecentSearches();
    }, []);

    const loadRecentSearches = async () => {
        try {
            const searches = await getRecentSearches(5);
            setRecentSearches(searches);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load recent searches';
            logger.error('Failed to load recent searches:', { error: errorMessage });
            setError(errorMessage);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        
        const { data, error } = await generateAIResponse(prompt);
        
        if (error) {
            setError(error.message);
        } else if (!data?.title || !data?.content) {
            setError('Invalid response: Missing title or content');
        } else {
            setTitle(data.title);
            setContent(data.content);
            // Reload recent searches after new response
            await loadRecentSearches();
        }
        
        setIsLoading(false);
    };

    const handleSave = async () => {
        if (!prompt || !title || !content) return;
        
        setIsSaving(true);
        const { success, error } = await saveSearch(prompt, {
            user_query: prompt,
            title: title,
            content: content
        });
        
        if (error) {
            setError(error);
        } else {
            // Reload recent searches after successful save
            await loadRecentSearches();
        }
        
        setIsSaving(false);
    };

    // Format the response for display
    const formattedResponse = title && content ? `# ${title}\n\n${content}` : '';

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                        AI Text Generator
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300">
                        Enter your prompt below and let AI generate a response for you
                    </p>
                </div>
                
                <div className="flex flex-col md:flex-row justify-center items-start gap-8 max-w-6xl mx-auto">
                    <div className="w-full md:w-2/3 max-w-2xl">
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
                                disabled={isLoading}
                                className={`w-full px-4 py-2 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    title || content ? 'bg-blue-700 hover:bg-blue-800' : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                            >
                                {isLoading ? 'Generating...' : title || content ? 'Regenerate' : 'Generate'}
                            </button>
                        </form>

                        {error && (
                            <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
                                {error}
                            </div>
                        )}

                        {(title || content) && (
                            <div className="mt-6">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Response:
                                    </h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving || !title || !content}
                                            className="px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isSaving ? 'Saving...' : 'Save Response'}
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
                                                {formattedResponse}
                                            </ReactMarkdown>
                                        </article>
                                    ) : (
                                        <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                                            {formattedResponse}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-full md:w-1/3 max-w-sm">
                        <div className="sticky top-8">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                                Saved Searches
                            </h3>
                            <div className="space-y-4">
                                {recentSearches.map((search) => (
                                    <div 
                                        key={search.id} 
                                        className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md"
                                    >
                                        <p className="font-medium text-gray-700 dark:text-gray-300">
                                            Query: {search.user_query}
                                        </p>
                                        <div className="mt-2 text-gray-600 dark:text-gray-400">
                                            <p>
                                                Title: {search.title}
                                            </p>
                                            <p className="mt-1">
                                                Content: {search.content.slice(0, 100)}
                                                {search.content.length > 100 && '...'}
                                            </p>
                                            {search.content.length > 100 && (
                                                <button 
                                                    onClick={() => window.alert(`${search.title}\n\n${search.content}`)} 
                                                    className="mt-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                >
                                                    Show full response
                                                </button>
                                            )}
                                        </div>
                                        <p className="mt-2 text-sm text-gray-500">
                                            {new Date(search.timestamp).toLocaleString()}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
