'use client';

import LexicalEditor from '../../editorFiles/LexicalEditor';
import { getEditorSuggestionsAction } from '@/actions/actions';
import { useState } from 'react';
import { type PatchChangeType } from '@/editorFiles/editorSchemas';

export default function EditorTestPage() {
    const [suggestions, setSuggestions] = useState<PatchChangeType[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentContent, setCurrentContent] = useState<string>('');

    // Default content about Albert Einstein
    const defaultContent = `Albert Einstein was a German-born theoretical physicist who developed the theory of relativity, one of the two pillars of modern physics. Born on March 14, 1879, in Ulm, Germany, Einstein's revolutionary work fundamentally changed our understanding of space, time, and the universe itself.

Einstein's most famous equation, E = mc², demonstrates the equivalence of mass and energy, showing that a small amount of mass can be converted into a tremendous amount of energy. This insight laid the groundwork for nuclear power and fundamentally altered our understanding of the physical world.

The theory of relativity, which Einstein developed in two parts, completely transformed physics. His special theory of relativity, published in 1905, showed that time and space are not absolute but relative to the observer's motion. This theory introduced the concept that the speed of light is constant for all observers, regardless of their relative motion.

In 1915, Einstein published his general theory of relativity, which described gravity not as a force but as a curvature of spacetime caused by mass and energy. This theory predicted phenomena such as gravitational waves and black holes, which have since been confirmed by modern observations.

Einstein's work extended beyond physics into philosophy, particularly in his views on determinism and free will. He famously said, "God does not play dice with the universe," expressing his belief in a deterministic universe governed by precise laws rather than probability.

Throughout his life, Einstein was also a passionate advocate for peace and civil rights. He spoke out against war and nationalism, and his fame gave him a platform to address social and political issues. His letter to President Roosevelt about the potential for nuclear weapons led to the Manhattan Project, though Einstein himself was not involved in the development of the atomic bomb.

Einstein's legacy continues to influence modern physics, with his theories forming the foundation for much of our current understanding of the universe. His work on quantum mechanics, while often in disagreement with other physicists of his time, helped shape the field and continues to inspire new generations of scientists.

The impact of Einstein's discoveries extends far beyond the scientific community. His theories have practical applications in technologies we use every day, from GPS systems that must account for relativistic effects to medical imaging techniques that rely on our understanding of matter and energy.`;

    /**
     * Test function to get AI suggestions for sample content
     * • Calls server action with sample text to test LLM integration
     * • Updates state with suggestions and logs to console
     * • Used by: Test button for verifying AI suggestions functionality
     * • Calls: getEditorSuggestionsAction
     */
    const handleTestSuggestions = async () => {
        setIsLoading(true);
        try {
            const result = await getEditorSuggestionsAction(currentContent, "Improve the writing style and add more details about his contributions");
            
            if (result.success && result.data) {
                setSuggestions(result.data);
                console.log('Test AI Edit Suggestions:', result.data);
            } else {
                console.error('Failed to get test suggestions:', result.error);
                alert('Failed to get test suggestions. Please try again.');
            }
        } catch (error) {
            console.error('Error getting test suggestions:', error);
            alert('Error getting test suggestions. Please try again.');
        } finally {
            setIsLoading(false);
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
                    </div>
                </div>

                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Test AI Suggestions Button */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
                                Test AI Edit Suggestions
                            </h3>
                            <p className="text-blue-800 dark:text-blue-200 text-sm mb-4">
                                Click the button below to test the AI-powered edit suggestions with the current content in the editor.
                            </p>
                            <button
                                onClick={handleTestSuggestions}
                                disabled={isLoading}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-md transition-colors duration-200 flex items-center space-x-2"
                            >
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span>Getting Suggestions...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                        </svg>
                                        <span>Test AI Suggestions</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Test Suggestions Display */}
                    {suggestions && suggestions.length > 0 && (
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                            <div className="p-6">
                                <h3 className="text-lg font-semibold text-green-800 dark:text-green-200 mb-3">
                                    Test AI Suggestions ({suggestions.length})
                                </h3>
                                <div className="space-y-3">
                                    {suggestions.map((suggestion, index) => (
                                        <div key={suggestion.id || index} className="text-sm text-green-700 dark:text-green-300 p-3 bg-green-100 dark:bg-green-800/30 rounded-md">
                                            <div className="font-medium mb-1">
                                                {suggestion.kind.charAt(0).toUpperCase() + suggestion.kind.slice(1)}: {suggestion.summary}
                                            </div>
                                            {suggestion.newText && (
                                                <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                                                    <strong>New text:</strong> "{suggestion.newText}"
                                                </div>
                                            )}
                                            <div className="text-xs text-green-500 dark:text-green-400 mt-1">
                                                <strong>Position:</strong> {suggestion.startG}-{suggestion.endG}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Main Editor */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                        <div className="p-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Rich Text Editor
                            </label>
                            <LexicalEditor
                                placeholder="Start writing your story about Albert Einstein or any other topic..."
                                className="w-full"
                                initialContent={defaultContent}
                                onContentChange={setCurrentContent}
                            />
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
                                    highly customizable and performant.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
