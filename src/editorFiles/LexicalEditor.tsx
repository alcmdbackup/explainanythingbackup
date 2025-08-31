'use client';

import { $getRoot, $getSelection, $createParagraphNode, $createTextNode } from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';

// Import custom DiffTagNode
import { DiffTagNode } from './DiffTagNode';

/**
 * Replace the editor content entirely from an HTML string.
 * 
 * • Parses HTML string using DOMParser and converts to Lexical nodes
 * • Clears current editor content and appends new nodes
 * • Sets cursor position to start or end of content
 * • Calls: $generateNodesFromDOM, $getRoot, editor.update
 * • Used by: LexicalEditor component to update content from diff HTML
 */
export function setEditorFromHTML(editor: any, html: string, opts?: {
  placeCursor?: "start" | "end";   // where to put the caret after import
  clearHistory?: boolean;          // clear undo stack after import (default true)
}) {
  const { placeCursor = "end", clearHistory = true } = opts ?? {};

  // Apply in a single update so it's one undo step
  editor.update(() => {
    // 1) Parse HTML (sanitize first if the source is untrusted!)
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 2) Convert DOM -> Lexical nodes using importDOM mappings from registered nodes
    const nodes = $generateNodesFromDOM(editor, doc);

    // 3) Update the editor content
    const root = $getRoot();
    root.clear();
    
    // Process nodes and group consecutive inline nodes into paragraphs
    const processedNodes = [];
    let currentParagraph = null;
    
    for (const node of nodes) {
      if (node.getType() === 'text' || (node.getType() === 'diff-tag' && node.isInline())) {
        // Create paragraph if we don't have one
        if (!currentParagraph) {
          currentParagraph = $createParagraphNode();
        }
        currentParagraph.append(node);
      } else {
        // If we have a paragraph with content, add it to processed nodes
        if (currentParagraph && currentParagraph.getChildrenSize() > 0) {
          processedNodes.push(currentParagraph);
          currentParagraph = null;
        }
        // Add the non-inline node
        processedNodes.push(node);
      }
    }
    
    // Don't forget the last paragraph if it has content
    if (currentParagraph && currentParagraph.getChildrenSize() > 0) {
      processedNodes.push(currentParagraph);
    }
    
    root.append(...processedNodes);

    // Optional: set the selection
    if (placeCursor === "start") root.selectStart();
    else root.selectEnd();
  });

  // Note: clearHistory functionality removed since @lexical/history is not installed
}

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

/**
 * Reference interface for LexicalEditor component
 * 
 * • Provides methods to control the editor from parent components
 * • setContentFromHTML: Updates editor content using HTML string
 * • Used by: Editor test pages to update editor with diff HTML
 */
export interface LexicalEditorRef {
  setContentFromHTML: (html: string) => void;
}

const LexicalEditor = forwardRef<LexicalEditorRef, LexicalEditorProps>(({ 
  placeholder = "Enter some text...", 
  className = "",
  initialContent = "",
  onContentChange,
  showEditorState = true
}, ref) => {
  const [editorStateJson, setEditorStateJson] = useState<string>('');
  const [editor, setEditor] = useState<any>(null);

  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError,
    nodes: [DiffTagNode],
  };

  // Expose the setContentFromHTML function via ref
  useImperativeHandle(ref, () => ({
    setContentFromHTML: (html: string) => {
      if (editor) {
        setEditorFromHTML(editor, html);
      }
    }
  }), [editor]);

  return (
    <div className={className}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin setEditor={setEditor} />
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
});

// Plugin to capture the editor instance
function EditorRefPlugin({ setEditor }: { setEditor: (editor: any) => void }) {
  const [editor] = useLexicalComposerContext();
  
  useEffect(() => {
    setEditor(editor);
  }, [editor, setEditor]);
  
  return null;
}

export default LexicalEditor;
