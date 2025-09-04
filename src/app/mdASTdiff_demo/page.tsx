'use client';

import { useState } from 'react';
import { logger } from '@/lib/client_utilities';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { diffMdast, renderCriticMarkup } from '@/editorFiles/markdownASTdiff/markdownASTdiff';

export default function MdASTdiffDemoPage() {
    const [beforeText, setBeforeText] = useState('');
    const [afterText, setAfterText] = useState('');
    const [diffOutput, setDiffOutput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Default example content
    const defaultBefore = `# Hello
- Two
- Three`;

    const defaultAfter = `# Hello world!
- Two (updated)
- Three
- Four`;

    const handleComputeDiff = async () => {
        if (!beforeText.trim() || !afterText.trim()) {
            setError('Please provide both "before" and "after" text');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Parse markdown strings into AST
            const beforeAST = unified().use(remarkParse).parse(beforeText);
            const afterAST = unified().use(remarkParse).parse(afterText);

            // Compute the diff using markdownASTdiff
            const diffOps = diffMdast(beforeAST, afterAST, { 
                textGranularity: 'word' 
            });

            // Generate CriticMarkup output
            const criticMarkup = renderCriticMarkup(beforeAST, afterAST, {
                textGranularity: 'word'
            });

            setDiffOutput(criticMarkup);
            logger.debug('Diff computed successfully', { 
                beforeLength: beforeText.length, 
                afterLength: afterText.length,
                diffOpsCount: diffOps.length
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to compute diff';
            setError(errorMessage);
            logger.error('Error computing diff', { error: errorMessage });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadExample = () => {
        setBeforeText(defaultBefore);
        setAfterText(defaultAfter);
        setDiffOutput('');
        setError(null);
    };

    const handleClear = () => {
        setBeforeText('');
        setAfterText('');
        setDiffOutput('');
        setError(null);
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Markdown AST Diff Demo
                    </h1>
                    <p className="text-gray-600">
                        Compare two markdown texts and see the diff overlaid on the original
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Before Text */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="px-4 py-3 border-b border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-900">Before</h2>
                        </div>
                        <div className="p-4">
                            <textarea
                                value={beforeText}
                                onChange={(e) => setBeforeText(e.target.value)}
                                placeholder="Enter your original markdown text here..."
                                className="w-full h-64 p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                    </div>

                    {/* After Text */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="px-4 py-3 border-b border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-900">After</h2>
                        </div>
                        <div className="p-4">
                            <textarea
                                value={afterText}
                                onChange={(e) => setAfterText(e.target.value)}
                                placeholder="Enter your modified markdown text here..."
                                className="w-full h-64 p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap gap-3 mb-6">
                    <button
                        onClick={handleComputeDiff}
                        disabled={isLoading || !beforeText.trim() || !afterText.trim()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                        {isLoading ? 'Computing...' : 'Compute Diff'}
                    </button>
                    
                    <button
                        onClick={handleLoadExample}
                        className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                    >
                        Load Example
                    </button>
                    
                    <button
                        onClick={handleClear}
                        className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                    >
                        Clear All
                    </button>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-sm font-medium text-red-800">Error</h3>
                                <div className="mt-2 text-sm text-red-700">{error}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Diff Output */}
                {diffOutput && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="px-4 py-3 border-b border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-900">Diff Output</h2>
                            <p className="text-sm text-gray-600 mt-1">
                                Shows the diff overlaid on the original text using CriticMarkup syntax
                            </p>
                        </div>
                        <div className="p-4">
                            <div className="bg-gray-50 rounded-md p-4 border">
                                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                                    {diffOutput}
                                </pre>
                            </div>
                            <div className="mt-4 text-sm text-gray-600">
                                <p><strong>Legend:</strong></p>
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                    <li><code className="bg-red-100 px-1 rounded">{'{--deleted text--}'}</code> - Text that was removed</li>
                                    <li><code className="bg-green-100 px-1 rounded">{'{++inserted text++}'}</code> - Text that was added</li>
                                    <li>Regular text - Unchanged content</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* Info Section */}
                <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">About This Demo</h3>
                    <div className="text-blue-800 space-y-2">
                        <p>
                            This demo uses the <code className="bg-blue-100 px-1 rounded">markdownASTdiff</code> library 
                            to compute intelligent differences between markdown documents.
                        </p>
                        <p>
                            The diff algorithm works at the AST (Abstract Syntax Tree) level, providing more accurate 
                            and meaningful diffs than simple text comparison.
                        </p>
                        <p>
                            <strong>Features:</strong>
                        </p>
                        <ul className="list-disc list-inside ml-4 space-y-1">
                            <li>Word-level and character-level text diffing</li>
                            <li>Intelligent node matching using LCS algorithm</li>
                            <li>CriticMarkup output for human-readable diffs</li>
                            <li>Support for all standard markdown elements</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
