'use client';

import { $getRoot, $getSelection, $createParagraphNode, $createTextNode } from 'lexical';
import { useState, useCallback, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { getEditorSuggestionsAction } from '@/actions/actions';
import { type PatchChangeType } from './editorSchemas';

// Theme configuration for the editor
const theme = {
  paragraph: 'mb-1',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
  },
};

// Error handler function
function onError(error: Error) {
  console.error(error);
}

// Custom plugin for setting initial content
function InitialContentPlugin({ 
  initialContent 
}: { 
  initialContent: string 
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (initialContent) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode().append($createTextNode(initialContent)));
      });
    }
  }, [editor, initialContent]);

  return null;
}

// Custom plugin for tracking content changes
function ContentChangePlugin({ 
  onContentChange 
}: { 
  onContentChange?: (content: string) => void 
}) {
  const [editor] = useLexicalComposerContext();

  const handleChange = useCallback(() => {
    if (onContentChange) {
      const editorState = editor.getEditorState();
      const content = editorState.read(() => $getRoot().getTextContent());
      onContentChange(content);
    }
  }, [editor, onContentChange]);

  return <OnChangePlugin onChange={handleChange} />;
}

// Custom plugin for AI suggestions
function SuggestionsPlugin({ 
  onGetSuggestions 
}: { 
  onGetSuggestions: (content: string) => Promise<void> 
}) {
  const [editor] = useLexicalComposerContext();
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PatchChangeType[] | null>(null);

  const handleGetSuggestions = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get the current editor content within the editor context
      const editorState = editor.getEditorState();
      const content = editorState.read(() => $getRoot().getTextContent());
      
      if (!content.trim()) {
        alert('Please enter some text in the editor first.');
        return;
      }

      await onGetSuggestions(content);
    } catch (error) {
      console.error('Error getting suggestions:', error);
      alert('Error getting suggestions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [editor, onGetSuggestions]);

  return (
    <div className="mb-4">
      <button
        onClick={handleGetSuggestions}
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
            <span>Get AI Suggestions</span>
          </>
        )}
      </button>
    </div>
  );
}

interface LexicalEditorProps {
  placeholder?: string;
  className?: string;
  initialContent?: string;
  onContentChange?: (content: string) => void;
}

export default function LexicalEditor({ 
  placeholder = "Enter some text...", 
  className = "",
  initialContent = "",
  onContentChange
}: LexicalEditorProps) {
  const [suggestions, setSuggestions] = useState<PatchChangeType[] | null>(null);

  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError,
  };

  /**
   * Gets AI-powered edit suggestions for the current editor content
   * • Calls server action to get LLM suggestions
   * • Updates state with suggestions and logs to console
   * • Used by: SuggestionsPlugin for AI-powered edit suggestions
   * • Calls: getEditorSuggestionsAction
   */
  const handleGetSuggestions = async (content: string) => {
    const result = await getEditorSuggestionsAction(content);
    
    if (result.success && result.data) {
      setSuggestions(result.data);
      console.log('AI Edit Suggestions:', result.data);
    } else {
      console.error('Failed to get suggestions:', result.error);
      alert('Failed to get suggestions. Please try again.');
    }
  };

  return (
    <div className={className}>
      {/* Suggestions Display */}
      {suggestions && suggestions.length > 0 && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2">
            AI Suggestions ({suggestions.length})
          </h3>
          <div className="space-y-2">
            {suggestions.map((suggestion, index) => (
              <div key={suggestion.id || index} className="text-sm text-green-700 dark:text-green-300">
                <span className="font-medium">{suggestion.kind}:</span> {suggestion.summary}
                {suggestion.newText && (
                  <div className="ml-4 text-xs text-green-600 dark:text-green-400">
                    New text: "{suggestion.newText}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <LexicalComposer initialConfig={initialConfig}>
        <InitialContentPlugin initialContent={initialContent} />
        <ContentChangePlugin onContentChange={onContentChange} />
        <SuggestionsPlugin onGetSuggestions={handleGetSuggestions} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-[200px] p-4 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          }
          placeholder={
            <div className="absolute top-4 left-4 text-gray-400 dark:text-gray-500 pointer-events-none">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <AutoFocusPlugin />
      </LexicalComposer>
    </div>
  );
}
