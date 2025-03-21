'use client';

import { useState } from 'react';
import { generateAIResponse } from '@/actions/actions';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default function Home() {
    const [prompt, setPrompt] = useState('');
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        
        const { data, error } = await generateAIResponse(prompt);
        
        if (error) {
            setError(error);
        } else {
            setResponse(data!);
        }
        
        setIsLoading(false);
    };

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
                
                <div className="w-full max-w-2xl mx-auto p-4">
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
                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Generating...' : 'Generate'}
                        </button>
                    </form>

                    {error && (
                        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
                            {error}
                        </div>
                    )}

                    {response && (
                        <div className="mt-6">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                    Response:
                                </h3>
                                <button
                                    onClick={() => setIsMarkdownMode(!isMarkdownMode)}
                                    className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                >
                                    {isMarkdownMode ? 'Show Plain Text' : 'Show Markdown'}
                                </button>
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
                                            {response}
                                        </ReactMarkdown>
                                    </article>
                                ) : (
                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                                        {response}
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
