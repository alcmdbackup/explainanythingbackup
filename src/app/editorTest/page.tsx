'use client';

import LexicalEditor, { LexicalEditorRef } from '../../editorFiles/LexicalEditor';
import { useState, useEffect, useRef } from 'react';
import { generateAISuggestionsAction, applyAISuggestionsAction } from '../../actions/actions';
import { logger } from '../../lib/client_utilities';
import { RenderCriticMarkupFromMDAstDiff } from '../../editorFiles/markdownASTdiff/markdownASTdiff';
import { CriticMarkupRenderer } from '../../components/CriticMarkupRenderer';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { 
    mergeAISuggestionOutput, 
    validateAISuggestionOutput,
    type AISuggestionOutput 
} from '../../editorFiles/aiSuggestion';

export default function EditorTestPage() {
    const [currentContent, setCurrentContent] = useState<string>('');
    const [aiSuggestions, setAiSuggestions] = useState<string>('');
    const [rawAIResponse, setRawAIResponse] = useState<string>('');
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);
    const [suggestionError, setSuggestionError] = useState<string>('');
    const [appliedEdits, setAppliedEdits] = useState<string>('');
    const [isApplyingEdits, setIsApplyingEdits] = useState<boolean>(false);
    const [applyError, setApplyError] = useState<string>('');
    const [isApplyingDiff, setIsApplyingDiff] = useState<boolean>(false);
    const [diffError, setDiffError] = useState<string>('');
    const [markdownASTDiffResult, setMarkdownASTDiffResult] = useState<string>('');
    const [isMarkdownMode, setIsMarkdownMode] = useState<boolean>(true);
    const editorRef = useRef<LexicalEditorRef>(null);

    // Default content about Albert Einstein
    const defaultContent = `# Albert Einstein: The Revolutionary Physicist

Albert Einstein was a German-born theoretical physicist who developed the theory of relativity, one of the two pillars of modern physics. Born on March 14, 1879, in Ulm, Germany, Einstein's revolutionary work fundamentally changed our understanding of space, time, and the universe itself.

## The Famous Equation

Einstein's most famous equation, **E = mc²**, demonstrates the equivalence of mass and energy, showing that a small amount of mass can be converted into a tremendous amount of energy. This insight laid the groundwork for nuclear power and fundamentally altered our understanding of the physical world.

## Legacy and Impact

Einstein's contributions to physics earned him the Nobel Prize in Physics in 1921, and his work continues to influence scientific research and technological development to this day.`;

    // Set initial content when component mounts
    useEffect(() => {
        setCurrentContent(defaultContent);
        console.log('Initial content set:', defaultContent.length, 'characters');
    }, []);

    // Handle markdown mode toggle
    const handleMarkdownToggle = () => {
        if (editorRef.current) {
            // Toggle the internal state first
            const newMarkdownMode = !isMarkdownMode;
            setIsMarkdownMode(newMarkdownMode);
            // Use the new toggle method from LexicalEditor
            editorRef.current.toggleMarkdownMode();
        }
    };

    // Handle AI suggestions
    const handleGetAISuggestions = async () => {
        if (!currentContent) {
            setSuggestionError('No content available. Please type something in the editor first.');
            return;
        }

        setIsLoadingSuggestions(true);
        setSuggestionError('');
        setAiSuggestions('');

        try {
            // Use the existing action to get AI suggestions
            const result = await generateAISuggestionsAction(
                currentContent,
                'test-user'
            );

            if (result.success && result.data) {
                // Store the raw response for debugging
                setRawAIResponse(result.data);

                // Validate the response against the schema
                const validationResult = validateAISuggestionOutput(result.data);
                
                if (validationResult.success) {
                    // Merge the structured output into a readable format
                    const mergedOutput = mergeAISuggestionOutput(validationResult.data);
                    setAiSuggestions(mergedOutput);
                    
                    logger.debug('AI suggestions received and validated', {
                        responseLength: result.data.length,
                        editsCount: validationResult.data.edits.length
                    });
                } else {
                    setSuggestionError(`AI response validation failed: ${validationResult.error.message}`);
                }
            } else {
                setSuggestionError(result.error?.message || 'Failed to generate AI suggestions');
            }
        } catch (error) {
            setSuggestionError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    // Handle applying AI suggestions
    const handleApplyAISuggestions = async () => {
        if (!aiSuggestions) {
            setApplyError('No AI suggestions available. Please generate suggestions first.');
            return;
        }

        if (!currentContent) {
            setApplyError('No original content available.');
            return;
        }

        setIsApplyingEdits(true);
        setApplyError('');
        setAppliedEdits('');

        try {
            // Use the existing action to apply AI suggestions
            const result = await applyAISuggestionsAction(
                aiSuggestions,
                currentContent,
                'test-user'
            );

            if (result.success && result.data) {
                setAppliedEdits(result.data);
                logger.debug('AI suggestions applied successfully', {
                    responseLength: result.data.length
                });
            } else {
                setApplyError(result.error?.message || 'Failed to apply AI suggestions');
            }
        } catch (error) {
            setApplyError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsApplyingEdits(false);
        }
    };

    // Handle applying 2-pass diff
    const handleApplyDiff = () => {
        if (!currentContent) {
            setDiffError('No original content available.');
            return;
        }

        if (!appliedEdits) {
            setDiffError('No applied edits available. Please apply AI suggestions first.');
            return;
        }

        setIsApplyingDiff(true);
        setDiffError('');
        setMarkdownASTDiffResult('');

        try {
            // Use markdown AST diff
            const processor = unified().use(remarkParse);
            const beforeAST = processor.parse(currentContent) as any;
            const afterAST = processor.parse(appliedEdits) as any;
            
            const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
            setMarkdownASTDiffResult(criticMarkup);
            
            // Print the markdown with CriticMarkup to console
            console.log('📝 Diff Applied - Markdown with CriticMarkup (AST Diff):');
            console.log(criticMarkup);
            
            logger.debug('Markdown AST diff applied successfully', {
                beforeLength: currentContent.length,
                afterLength: appliedEdits.length,
                criticMarkupLength: criticMarkup.length
            });
        } catch (error) {
            setDiffError(error instanceof Error ? error.message : 'An unexpected error occurred while applying diff');
        } finally {
            setIsApplyingDiff(false);
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                        Lexical Editor Test Page
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">
                        Test the Lexical rich text editor with the story of Albert Einstein
                    </p>
                    <div className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                        <p>Try typing in the editor below. You can use keyboard shortcuts like:</p>
                        <ul className="mt-2 space-y-1">
                            <li>• <strong>Ctrl+B</strong> or <strong>Cmd+B</strong> for bold text</li>
                            <li>• <strong>Ctrl+I</strong> or <strong>Cmd+I</strong> for italic text</li>
                            <li>• <strong>Ctrl+Z</strong> or <strong>Cmd+Z</strong> to undo</li>
                            <li>• <strong>Ctrl+Y</strong> or <strong>Cmd+Y</strong> to redo</li>
                        </ul>
                        {isMarkdownMode && (
                            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                                <p className="font-medium text-blue-900 dark:text-blue-100 mb-2">Markdown Mode Active</p>
                                <p className="text-blue-800 dark:text-blue-200 text-xs">
                                    You can use markdown syntax: <strong>**bold**</strong>, <em>*italic*</em>, <code>`code`</code>, 
                                    <code># heading</code>, <code>- list</code>, <code>{'>'} quote</code>
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Main Editor */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Rich Text Editor
                                </label>
                                <div className="flex items-center space-x-2">
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Raw Text</span>
                                    <button
                                        onClick={handleMarkdownToggle}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                            isMarkdownMode 
                                                ? 'bg-blue-600' 
                                                : 'bg-gray-200 dark:bg-gray-700'
                                        }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                isMarkdownMode ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Markdown</span>
                                </div>
                            </div>
                            <LexicalEditor
                                ref={editorRef}
                                placeholder="Start writing your story about Albert Einstein or any other topic..."
                                className="w-full"
                                initialContent={defaultContent}
                                isMarkdownMode={isMarkdownMode}
                                onContentChange={(content) => {
                                    console.log('Content changed:', content.length, 'characters');
                                    setCurrentContent(content);
                                }}
                            />
                        </div>
                    </div>

                    {/* AI Suggestions Panel */}
                    <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-100 mb-3">
                                AI Suggestions
                            </h3>
                            <div className="text-orange-800 dark:text-orange-200 text-sm space-y-4">
                                <p>
                                    Get AI-powered suggestions to improve your content. The AI will suggest edits with clear instructions.
                                </p>
                                
                                <div className="flex flex-wrap gap-2">
                                    <div className="text-xs text-orange-600 dark:text-orange-400 mb-2">
                                        Content length: {currentContent.length} characters | 
                                        Button disabled: {isLoadingSuggestions ? 'Yes (loading)' : 'No'}
                                    </div>
                                    <button
                                        onClick={handleGetAISuggestions}
                                        disabled={isLoadingSuggestions}
                                        className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                            isLoadingSuggestions
                                                ? 'bg-orange-300 text-white cursor-not-allowed'
                                                : 'bg-orange-600 hover:bg-orange-700 text-white'
                                        }`}
                                    >
                                        {isLoadingSuggestions ? 'Processing...' : 'Get AI Suggestions'}
                                    </button>
                                    <button
                                        onClick={handleApplyAISuggestions}
                                        disabled={!aiSuggestions || isApplyingEdits}
                                        className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                            !aiSuggestions || isApplyingEdits
                                                ? 'bg-gray-400 text-white cursor-not-allowed'
                                                : 'bg-green-600 hover:bg-green-700 text-white'
                                        }`}
                                    >
                                        {isApplyingEdits ? 'Applying...' : 'Apply AI Suggestions'}
                                    </button>
                                </div>

                                {suggestionError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {suggestionError}
                                        </p>
                                    </div>
                                )}

                                {rawAIResponse && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                                            Raw AI Response (JSON):
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-orange-300 dark:border-orange-600">
                                            <pre className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap font-mono">
                                                {rawAIResponse}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                {aiSuggestions && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                                            Merged AI Suggestions:
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-orange-300 dark:border-orange-600">
                                            <pre className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap font-mono">
                                                {aiSuggestions}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Edits Applied Panel */}
                    {appliedEdits && (
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                            <div className="p-6">
                                <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-3">
                                    Edits Applied
                                </h3>
                                <div className="text-green-800 dark:text-green-200 text-sm space-y-4">
                                    <p>
                                        The AI suggestions have been applied to your content. Here's the improved version:
                                    </p>
                                    
                                    {applyError && (
                                        <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                            <p className="text-red-800 dark:text-red-200 text-sm">
                                                Error: {applyError}
                                            </p>
                                        </div>
                                    )}

                                    <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-green-300 dark:border-green-600">
                                        <pre className="text-sm text-green-900 dark:text-green-100 whitespace-pre-wrap font-mono">
                                            {appliedEdits}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Diff Applied Panel */}
                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 mb-3">
                                Diff Applied
                            </h3>
                            <div className="text-purple-800 dark:text-purple-200 text-sm space-y-4">
                                <p>
                                    Apply a diff between the original content and the applied edits using markdown AST diff.
                                </p>
                                
                                
                                <div className="flex flex-wrap gap-2">
                                    <div className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                                        Original content: {currentContent.length} characters | 
                                        Applied edits: {appliedEdits.length} characters |
                                        Method: Markdown AST |
                                        Button disabled: {isApplyingDiff ? 'Yes (processing)' : 'No'}
                                    </div>
                                    <button
                                        onClick={handleApplyDiff}
                                        disabled={!currentContent || !appliedEdits || isApplyingDiff}
                                        className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                            !currentContent || !appliedEdits || isApplyingDiff
                                                ? 'bg-purple-300 text-white cursor-not-allowed'
                                                : 'bg-purple-600 hover:bg-purple-700 text-white'
                                        }`}
                                    >
                                        {isApplyingDiff ? 'Processing...' : 'Apply Diff'}
                                    </button>
                                </div>

                                {diffError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {diffError}
                                        </p>
                                    </div>
                                )}

                                {markdownASTDiffResult && (
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <h4 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                                                Raw Markdown (CriticMarkup):
                                            </h4>
                                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-purple-300 dark:border-purple-600">
                                                <pre className="text-sm text-purple-900 dark:text-purple-100 whitespace-pre-wrap font-mono">
                                                    {markdownASTDiffResult}
                                                </pre>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <h4 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                                                Rendered Diff (CriticMarkup):
                                            </h4>
                                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-purple-300 dark:border-purple-600">
                                                <CriticMarkupRenderer 
                                                    content={markdownASTDiffResult}
                                                    className="text-purple-900 dark:text-purple-100"
                                                />
                                            </div>
                                        </div>
                                        
                                        <div className="mt-4">
                                            <button
                                                onClick={() => {
                                                    if (editorRef.current && markdownASTDiffResult) {
                                                        editorRef.current.setContentFromMarkdown(markdownASTDiffResult);
                                                    }
                                                }}
                                                disabled={!markdownASTDiffResult}
                                                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                    !markdownASTDiffResult
                                                        ? 'bg-gray-400 text-white cursor-not-allowed'
                                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                                }`}
                                            >
                                                Update Editor with AST Diff Markdown
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Instructions Panel */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
                                About This Editor
                            </h3>
                            <div className="text-blue-800 dark:text-blue-200 text-sm space-y-2">
                                <p>
                                    This is a <strong>Lexical</strong> rich text editor - a modern, extensible text editor framework 
                                    developed by Meta (Facebook). It provides a robust foundation for building rich text editing experiences.
                                </p>
                                <p>
                                    The editor supports rich text formatting, undo/redo functionality, and is designed to be 
                                    highly customizable and performant. It now includes AI suggestions powered by GPT-4o-mini.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
