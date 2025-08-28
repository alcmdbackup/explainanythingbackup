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

// Custom plugin for tracking content changes and editor state
function ContentChangePlugin({ 
  onContentChange,
  onEditorStateChange
}: { 
  onContentChange?: (content: string) => void;
  onEditorStateChange?: (editorStateJson: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  const handleChange = useCallback(() => {
    if (onContentChange) {
      const editorState = editor.getEditorState();
      const content = editorState.read(() => $getRoot().getTextContent());
      onContentChange(content);
    }
    
    if (onEditorStateChange) {
      const editorState = editor.getEditorState();
      const editorStateJson = JSON.stringify(editorState.toJSON(), null, 2);
      onEditorStateChange(editorStateJson);
    }
  }, [editor, onContentChange, onEditorStateChange]);

  return <OnChangePlugin onChange={handleChange} />;
}

// Component to display editor state as JSON
function EditorStateDisplay({ editorStateJson }: { editorStateJson: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Editor State (JSON)
      </h3>
      <textarea
        value={editorStateJson}
        readOnly
        className="w-full h-64 p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm resize-none"
        placeholder="Editor state will appear here..."
      />
    </div>
  );
}

// Custom plugin for AI suggestions (inert for now)
function SuggestionsPlugin() {
  return (
    <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        AI Edit Suggestions
      </h3>
      <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
        AI suggestions are currently disabled.
      </p>
      <button
        disabled={true}
        className="px-4 py-2 bg-gray-400 text-white font-medium rounded-md cursor-not-allowed"
      >
        Get AI Suggestions (Disabled)
      </button>
    </div>
  );
}

interface LexicalEditorProps {
  placeholder?: string;
  className?: string;
  initialContent?: string;
  onContentChange?: (content: string) => void;
  showEditorState?: boolean;
}

export default function LexicalEditor({ 
  placeholder = "Enter some text...", 
  className = "",
  initialContent = "",
  onContentChange,
  showEditorState = true
}: LexicalEditorProps) {
  const [editorStateJson, setEditorStateJson] = useState<string>('');

  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError,
  };

  return (
    <div className={className}>
      <LexicalComposer initialConfig={initialConfig}>
        <InitialContentPlugin initialContent={initialContent} />
        <ContentChangePlugin 
          onContentChange={onContentChange} 
          onEditorStateChange={setEditorStateJson}
        />
        <SuggestionsPlugin />
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
      
      {showEditorState && (
        <EditorStateDisplay editorStateJson={editorStateJson} />
      )}
    </div>
  );
}
