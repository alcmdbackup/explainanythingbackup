'use client';

import { useState } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { RenderCriticMarkupFromMDAstDiff } from '@/editorFiles/markdownASTdiff/markdownASTdiff';

export default function DiffTestPage() {
    const [beforeContent, setBeforeContent] = useState('White was not only a two-time [NFL Defensive Player of the Year](/standalone-title?t=NFL%20Defensive%20Player%20of%20the%20Year%20Awards) but also a 13-time Pro Bowl selection.');
    const [afterContent, setAfterContent] = useState('White was a two-time [NFL Defensive Player of the Year](/standalone-title?t=NFL%20Defensive%20Player%20of%20the%20Year%20Awards) and was selected to the Pro Bowl 13 times.');
    const [criticMarkup, setCriticMarkup] = useState('');
    const [beforeAST, setBeforeAST] = useState('');
    const [afterAST, setAfterAST] = useState('');
    const [error, setError] = useState('');

    const computeDiff = () => {
        try {
            setError('');
            console.log('Computing diff...');
            console.log('Before:', beforeContent);
            console.log('After:', afterContent);

            // Parse markdown to AST
            const processor = unified().use(remarkParse);
            const beforeASTResult = processor.parse(beforeContent);
            const afterASTResult = processor.parse(afterContent);

            // Store AST for debugging
            setBeforeAST(JSON.stringify(beforeASTResult, null, 2));
            setAfterAST(JSON.stringify(afterASTResult, null, 2));

            console.log('Before AST:', beforeASTResult);
            console.log('After AST:', afterASTResult);

            // Generate CriticMarkup diff
            const markup = RenderCriticMarkupFromMDAstDiff(beforeASTResult, afterASTResult);
            setCriticMarkup(markup);

            console.log('Generated CriticMarkup:', markup);
        } catch (err) {
            console.error('Error computing diff:', err);
            setError(err instanceof Error ? err.message : 'Unknown error occurred');
        }
    };

    const loadPreset1 = () => {
        setBeforeContent('White was not only a two-time [NFL Defensive Player of the Year](/standalone-title?t=NFL%20Defensive%20Player%20of%20the%20Year%20Awards) but also a 13-time Pro Bowl selection.');
        setAfterContent('White was a two-time [NFL Defensive Player of the Year](/standalone-title?t=NFL%20Defensive%20Player%20of%20the%20Year%20Awards) and was selected to the Pro Bowl 13 times.');
    };

    const loadPreset2 = () => {
        setBeforeContent('The quick brown fox jumps over the lazy dog.');
        setAfterContent('The quick red fox jumps over the sleepy dog.');
    };

    const loadPreset3 = () => {
        setBeforeContent('## Heading 1\n\nThis is a paragraph with **bold** text.');
        setAfterContent('## Updated Heading\n\nThis is a paragraph with *italic* text and more content.');
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
                    Markdown Diff Test Tool
                </h1>

                <div className="mb-6 space-x-2">
                    <button
                        onClick={loadPreset1}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Load NFL Example
                    </button>
                    <button
                        onClick={loadPreset2}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                        Load Simple Example
                    </button>
                    <button
                        onClick={loadPreset3}
                        className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                    >
                        Load Markdown Example
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Before Content */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                            Before (Original)
                        </h2>
                        <textarea
                            value={beforeContent}
                            onChange={(e) => setBeforeContent(e.target.value)}
                            className="w-full h-32 p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono"
                            placeholder="Enter original markdown content..."
                        />
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            Length: {beforeContent.length} characters
                        </div>
                    </div>

                    {/* After Content */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                            After (Edited)
                        </h2>
                        <textarea
                            value={afterContent}
                            onChange={(e) => setAfterContent(e.target.value)}
                            className="w-full h-32 p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono"
                            placeholder="Enter edited markdown content..."
                        />
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            Length: {afterContent.length} characters
                        </div>
                    </div>
                </div>

                {/* Compute Button */}
                <div className="mb-6 text-center">
                    <button
                        onClick={computeDiff}
                        className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold"
                    >
                        Compute Markdown Diff
                    </button>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                        <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error:</h3>
                        <pre className="text-red-700 dark:text-red-300 text-sm whitespace-pre-wrap">{error}</pre>
                    </div>
                )}

                {/* CriticMarkup Result */}
                {criticMarkup && (
                    <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                            Generated CriticMarkup
                        </h2>
                        <div className="bg-gray-100 dark:bg-gray-700 rounded-md p-4 border">
                            <pre className="text-gray-900 dark:text-white text-sm whitespace-pre-wrap font-mono">
                                {criticMarkup}
                            </pre>
                        </div>
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            Generated markup length: {criticMarkup.length} characters
                        </div>
                    </div>
                )}

                {/* AST Debug Info */}
                {beforeAST && afterAST && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                                Before AST (Debug)
                            </h2>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-md p-4 border max-h-96 overflow-y-auto">
                                <pre className="text-gray-900 dark:text-white text-xs whitespace-pre-wrap font-mono">
                                    {beforeAST}
                                </pre>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                                After AST (Debug)
                            </h2>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-md p-4 border max-h-96 overflow-y-auto">
                                <pre className="text-gray-900 dark:text-white text-xs whitespace-pre-wrap font-mono">
                                    {afterAST}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}

                {/* Instructions */}
                <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-6">
                    <h3 className="text-blue-900 dark:text-blue-100 font-semibold mb-2">
                        How to Use
                    </h3>
                    <ul className="text-blue-800 dark:text-blue-200 text-sm space-y-1">
                        <li>• Use the preset buttons to load example content, or type your own</li>
                        <li>• Click "Compute Markdown Diff" to generate CriticMarkup</li>
                        <li>• View the generated CriticMarkup output and AST debug info</li>
                        <li>• Check the browser console for additional debug logs</li>
                        <li>• CriticMarkup syntax: {'{++addition++}'}, {'{--deletion--}'}, {'{~~old~>new~~}'}</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}