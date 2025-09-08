'use client';

import { $getRoot } from 'lexical';
import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { TreeView } from '@lexical/react/LexicalTreeView';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';

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
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';

// Import custom DiffTagNode and CriticMarkup transformer
import { DiffTagNode } from './DiffTagNode';
import { CRITIC_MARKUP, DIFF_TAG_ELEMENT, preprocessCriticMarkup } from './diffUtils';
import ToolbarPlugin from './ToolbarPlugin';

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
  LINK,
  CRITIC_MARKUP,
];

/**
 * Custom markdown export function that handles DiffTagNodes
 * 
 * • Converts Lexical nodes to markdown string with CriticMarkup support
 * • Manually traverses the node tree to handle DiffTagNodes
 * • Converts DiffTagNodes to CriticMarkup syntax during traversal
 * • Falls back to standard markdown conversion for other nodes
 * • Used by: LexicalEditor to export content with diff annotations
 */
export function $convertToMarkdownWithCriticMarkup(transformers: any[]): string {
  console.log("🔄 $convertToMarkdownWithCriticMarkup called");
  
  // Get the root node
  const root = $getRoot();
  
  // Recursively traverse the node tree and build markdown
  function traverseNode(node: any): string {
    console.log("🔍 Traversing node type:", node.getType());
    
    if (node.getType() === 'diff-tag') {
      console.log("✅ Found DiffTagNode, calling exportMarkdown()");
      const result = node.exportMarkdown();
      console.log("🎯 DiffTagNode export result:", JSON.stringify(result));
      return result;
    }
    
    // For other nodes, get their text content
    if (node.getType() === 'text') {
      return node.getTextContent();
    }
    
    // For element nodes, traverse their children
    if (node.getChildren) {
      const children = node.getChildren();
      let result = '';
      
      children.forEach((child: any) => {
        result += traverseNode(child);
      });
      
      // Add appropriate markdown formatting based on node type
      switch (node.getType()) {
        case 'heading':
          const level = node.getTag();
          const headingLevel = level ? level.replace('h', '') : '1';
          return `${'#'.repeat(parseInt(headingLevel))} ${result}\n\n`;
        case 'paragraph':
          return `${result}\n\n`;
        case 'list':
          return `${result}\n`;
        case 'listitem':
          return `- ${result}\n`;
        default:
          return result;
      }
    }
    
    return '';
  }
  
  // Start traversal from root
  const markdown = traverseNode(root);
  console.log("📤 Final markdown result:", JSON.stringify(markdown));
  
  return markdown;
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
 * • Calls: $convertFromMarkdownString, $getRoot
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
          $convertFromMarkdownString(initialContent, undefined);
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
        content = editorState.read(() => $convertToMarkdownWithCriticMarkup(MARKDOWN_TRANSFORMERS));
      } else {
        // Get content as plain text when in plain text mode
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

interface LexicalEditorProps {
  placeholder?: string;
  className?: string;
  initialContent?: string;
  onContentChange?: (content: string) => void;
  showEditorState?: boolean;
  isMarkdownMode?: boolean;
  showTreeView?: boolean;
  showToolbar?: boolean;
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
  isMarkdownMode = false,
  showTreeView = true,
  showToolbar = true
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
      TableRowNode,
      HorizontalRuleNode
    ],
  };

  // Expose the editor functions via ref
  useImperativeHandle(ref, () => ({
    setContentFromMarkdown: (markdown: string) => {
      if (editor) {
        editor.update(() => {
          // Preprocess markdown to normalize multiline CriticMarkup
          const preprocessedMarkdown = preprocessCriticMarkup(markdown);
          $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS);
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
          markdown = $convertToMarkdownWithCriticMarkup(MARKDOWN_TRANSFORMERS);
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
        {showToolbar && <ToolbarPlugin isMarkdownMode={isMarkdownMode} />}
        <MarkdownShortcutsPlugin isEnabled={isMarkdownMode} />
        {isMarkdownMode && <MarkdownShortcutPlugin />}
        {isMarkdownMode ? (
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
        ) : (
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className="lexical-editor min-h-[200px] p-4 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
              />
            }
            placeholder={
              <div className="absolute top-4 left-4 text-gray-400 dark:text-gray-500 pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        )}
        <HistoryPlugin />
        <AutoFocusPlugin />
        {showTreeView && <TreeViewPlugin />}
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


/**
 * TreeView plugin for debugging and visualizing editor state
 * 
 * • Provides visual representation of the editor's node tree structure
 * • Includes time travel functionality to navigate through editor history
 * • Uses TreeView component from @lexical/react/LexicalTreeView
 * • Styled with Tailwind classes for consistent appearance
 * • Used by: LexicalEditor for debugging and development purposes
 */
function TreeViewPlugin() {
  const [editor] = useLexicalComposerContext();
  
  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Editor Tree View
      </h3>
      <TreeView
        viewClassName="tree-view-output max-h-96 overflow-auto border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 p-4 font-mono text-sm"
        treeTypeButtonClassName="debug-treetype-button px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        timeTravelPanelClassName="debug-timetravel-panel mt-4 p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
        timeTravelButtonClassName="debug-timetravel-button px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
        timeTravelPanelSliderClassName="debug-timetravel-panel-slider w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
        timeTravelPanelButtonClassName="debug-timetravel-panel-button px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        editor={editor}
      />
    </div>
  );
}


export default LexicalEditor;
