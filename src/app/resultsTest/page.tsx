'use client';

import { useState, useRef } from 'react';
import LexicalEditor, { LexicalEditorRef } from '@/editorFiles/lexicalEditor/LexicalEditor';

export default function ResultsTestPage() {
  const [isEditMode, setIsEditMode] = useState(false);
  const editorRef = useRef<LexicalEditorRef>(null);

  // Test content with CriticMarkup that should generate diff tags
  const testContent = `# Test Content with Diff Tags

This is a test to see if {++diff tag hover buttons++} work correctly.

Here's another test with {--deleted content--} that should show hover controls.

And here's a substitution: {~~old content~>new content~~} with hover functionality.

## More Examples

- List item with {++addition++}
- Another item with {--deletion--}
- Final item with {~~change~>updated~~} content

The buttons should appear to the right of each highlighted section when you hover over them.`;

  const handleEditModeToggle = () => {
    setIsEditMode(!isEditMode);
  };

  const handleContentChange = (newContent: string) => {
    console.log('Content changed:', newContent);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
          ResultsLexicalEditor Test
        </h1>

        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
          <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Instructions
          </h2>
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            Hover over the highlighted diff tag sections (blue background) in the editor below.
            You should see Accept/Reject buttons appear to the right of each highlighted section.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Editor with Diff Tags
            </h2>
            <button
              onClick={handleEditModeToggle}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                isEditMode
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {isEditMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
            </button>
          </div>

          <LexicalEditor
            ref={editorRef}
            initialContent={testContent}
            isEditMode={isEditMode}
            onEditModeToggle={handleEditModeToggle}
            onContentChange={handleContentChange}
            isMarkdownMode={true}
            showEditorState={false}
            showTreeView={false}
            showToolbar={true}
            hideEditingUI={false}
            className="w-full"
          />
        </div>

        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
            Expected Behavior
          </h3>
          <ul className="text-yellow-800 dark:text-yellow-200 text-sm space-y-1">
            <li>• Hover over text with blue highlighting (diff tags)</li>
            <li>• Accept/Reject buttons should appear to the right of the highlighted text</li>
            <li>• Buttons should follow the mouse and stay near the highlighted area</li>
            <li>• Clicking Accept should remove the diff tag and keep the content</li>
            <li>• Clicking Reject should remove the diff tag and its content</li>
          </ul>
        </div>

        <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Debug Info
          </h3>
          <p className="text-gray-700 dark:text-gray-300 text-sm">
            Current edit mode: <strong>{isEditMode ? 'Enabled' : 'Disabled'}</strong>
          </p>
          <p className="text-gray-700 dark:text-gray-300 text-sm">
            Content length: <strong>{testContent.length} characters</strong>
          </p>
        </div>
      </div>
    </div>
  );
}