'use client';

import LexicalEditor from '../../editorFiles/LexicalEditor';
import { useState } from 'react';

export default function EditorTestPage() {
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
                                    highly customizable and performant. It includes a disabled AI suggestions feature that can be 
                                    re-enabled in the future.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
