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

// Import markdown functionality
import { 
  $convertFromMarkdownString, 
  $convertToMarkdownString, 
  registerMarkdownShortcuts,
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  LINK
} from '@lexical/markdown';

// Import markdown nodes
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table';

// Import custom DiffTagNode
import { DiffTagNode } from './DiffTagNode';

// Define custom transformers array with only the ones we need
const MARKDOWN_TRANSFORMERS = [
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  LINK
];

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
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, "text/html");

    // 2) Convert DOM -> Lexical nodes using importDOM mappings from registered nodes
    const nodes = $generateNodesFromDOM(editor, dom);

    // 3) Replace the whole document
    const root = $getRoot();
    root.clear();
    root.append(...nodes);

    // Optional: set the selection
    if (placeCursor === "start") root.selectStart();
    else root.selectEnd();
  }, { discrete: true });

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

/**
 * Plugin for setting initial content in the editor
 * 
 * • Sets initial content when component mounts or initialContent changes
 * • Converts markdown to rich text when in markdown mode
 * • Sets plain text when not in markdown mode
 * • Does not re-run when isMarkdownMode changes to preserve user edits
 * • Calls: $convertFromMarkdownString, $getRoot, $createParagraphNode, $createTextNode
 * • Used by: LexicalEditor to initialize content without overwriting user edits
 */
function InitialContentPlugin({ 
  initialContent,
  isMarkdownMode
}: { 
  initialContent: string;
  isMarkdownMode: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (initialContent) {
      if (isMarkdownMode) {
        editor.update(() => {
          $convertFromMarkdownString(initialContent, MARKDOWN_TRANSFORMERS);
        });
      } else {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode().append($createTextNode(initialContent)));
        });
      }
    }
  }, [editor, initialContent]); // Removed isMarkdownMode from dependencies

  return null;
}

// Custom plugin for tracking content changes and editor state
function ContentChangePlugin({ 
  onContentChange,
  onEditorStateChange,
  isMarkdownMode = false
}: { 
  onContentChange?: (content: string) => void;
  onEditorStateChange?: (editorStateJson: string) => void;
  isMarkdownMode?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  const handleChange = useCallback(() => {
    if (onContentChange) {
      const editorState = editor.getEditorState();
      let content: string;
      
      if (isMarkdownMode) {
        // Get content as markdown when in markdown mode
        content = editorState.read(() => $convertToMarkdownString(MARKDOWN_TRANSFORMERS));
      } else {
        // Get content as plain text when not in markdown mode
        content = editorState.read(() => $getRoot().getTextContent());
      }
      
      onContentChange(content);
    }
    
    if (onEditorStateChange) {
      const editorState = editor.getEditorState();
      const editorStateJson = JSON.stringify(editorState.toJSON(), null, 2);
      onEditorStateChange(editorStateJson);
    }
  }, [editor, onContentChange, onEditorStateChange, isMarkdownMode]);

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
  isMarkdownMode?: boolean;
}

/**
 * Reference interface for LexicalEditor component
 * 
 * • Provides methods to control the editor from parent components
 * • setContentFromHTML: Updates editor content using HTML string
 * • setContentFromMarkdown: Updates editor content using markdown string
 * • setContentFromText: Updates editor content using plain text string
 * • getContentAsMarkdown: Gets current content as markdown string
 * • Used by: Editor test pages to update editor with diff HTML and markdown
 */
export interface LexicalEditorRef {
  setContentFromHTML: (html: string) => void;
  setContentFromMarkdown: (markdown: string) => void;
  setContentFromText: (text: string) => void;
  getContentAsMarkdown: () => string;
}

const LexicalEditor = forwardRef<LexicalEditorRef, LexicalEditorProps>(({ 
  placeholder = "Enter some text...", 
  className = "",
  initialContent = "",
  onContentChange,
  showEditorState = true,
  isMarkdownMode = false
}, ref) => {
  const [editorStateJson, setEditorStateJson] = useState<string>('');
  const [editor, setEditor] = useState<any>(null);

  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError,
    nodes: [
      DiffTagNode,
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      TableNode,
      TableCellNode,
      TableRowNode
    ],
  };

  // Expose the editor functions via ref
  useImperativeHandle(ref, () => ({
    setContentFromHTML: (html: string) => {
      if (editor) {
        setEditorFromHTML(editor, html);
      }
    },
    setContentFromMarkdown: (markdown: string) => {
      if (editor) {
        editor.update(() => {
          $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS);
        });
      }
    },
    setContentFromText: (text: string) => {
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          
          // Use Lexical's built-in pattern: convert text to markdown with no transformers
          // This creates proper paragraph structure without any formatting
          const emptyTransformers: any[] = [];
          $convertFromMarkdownString(text, emptyTransformers);
        });
      }
    },
    getContentAsMarkdown: () => {
      if (editor) {
        let markdown = '';
        editor.update(() => {
          markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
        });
        return markdown;
      }
      return '';
    }
  }), [editor]);

  return (
    <div className={className}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin setEditor={setEditor} />
        <InitialContentPlugin initialContent={initialContent} isMarkdownMode={isMarkdownMode} />
        <ContentChangePlugin 
          onContentChange={onContentChange} 
          onEditorStateChange={setEditorStateJson}
          isMarkdownMode={isMarkdownMode}
        />
        <MarkdownShortcutsPlugin isEnabled={isMarkdownMode} />
        <SuggestionsPlugin />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="lexical-editor min-h-[200px] p-4 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white prose dark:prose-invert max-w-none"
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

// Plugin to register markdown shortcuts
function MarkdownShortcutsPlugin({ isEnabled }: { isEnabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  
  useEffect(() => {
    if (isEnabled) {
      const removeMarkdownShortcuts = registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS);
      return removeMarkdownShortcuts;
    }
  }, [editor, isEnabled]);
  
  return null;
}

export default LexicalEditor;
