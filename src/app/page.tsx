'use client';

import { useState } from 'react';
import { generateAiExplanation, saveExplanation, saveUserQuery } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { type SourceType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/server_utilities';
import Link from 'next/link';

export default function Home() {
    const [prompt, setPrompt] = useState('');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [sources, setSources] = useState<SourceType[]>([]);
    const [savedId, setSavedId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSavedId(null);
        setSources([]);
        
        const { data, error } = await generateAiExplanation(prompt);
        
        if (error) {
            setError(error.message);
        } else if (!data?.title || !data?.content) {
            setError('Invalid explanation: Missing title or content');
        } else {
            setTitle(data.title);
            setContent(data.content);
            if (data.sources) {
                setSources(data.sources);
            }
            
            // Save user query with sources
            const { error: queryError } = await saveUserQuery(prompt, {
                title: data.title,
                content: data.content,
            });
            
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
        
        setIsLoading(false);
    };

    const handleSave = async () => {
        if (!prompt || !title || !content || savedId) return;
        
        setIsSaving(true);
        const { success, error, id } = await saveExplanation(prompt, {
            title: title,
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

    const formattedExplanation = title && content ? `# ${title}\n\n${content}` : '';

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
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
                
                <div className="max-w-2xl mx-auto">
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

                    {(title || content) && !isLoading && (
                        <div className="mt-6">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                    Explanation:
                                </h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving || !title || !content || savedId !== null || isLoading}
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
            </main>
        </div>
    );
}
