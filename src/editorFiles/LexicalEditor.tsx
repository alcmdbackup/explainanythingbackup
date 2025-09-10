'use client';

import { $getRoot, $isElementNode, $isTextNode, $createTextNode } from 'lexical';
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
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';

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
import { DiffTagNode, $isDiffTagNode } from './DiffTagNode';
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
  DIFF_TAG_ELEMENT,
];

/**
 * Custom markdown export function that handles DiffTagNodes by replacing them with text nodes
 * 
 * SIMPLIFIED APPROACH:
 * Instead of complex tree traversal, we replace diff-tag nodes with equivalent text nodes
 * containing their CriticMarkup representation, then use standard Lexical transformers.
 * This approach is simpler, more maintainable, and leverages Lexical's built-in functionality.
 * 
 * • Replaces diff-tag nodes with text nodes containing CriticMarkup syntax
 * • Manually traverses the tree to build markdown with CriticMarkup
 * • Uses standard transformers for other node types
 * • More efficient and maintainable than custom traversal
 * • Used by: LexicalEditor to export content with diff annotations
 */
export function $convertToMarkdownWithCriticMarkup(transformers: any[]): string {
  console.log("🔄 $convertToMarkdownWithCriticMarkup called with transformers:", transformers.length);
  console.log("🔍 Transformers:", transformers.map(t => t.type || 'unknown'));
  
  const root = $getRoot();
  let result = '';
  
  // Process each top-level child
  root.getChildren().forEach(child => {
    if ($isElementNode(child) && child.getType() === 'paragraph') {
      let paragraphText = '';
      
      // Process each child of the paragraph
      child.getChildren().forEach((grandchild: any) => {
        if (grandchild.getType() === 'diff-tag') {
          // This is a DiffTagNode - get its CriticMarkup representation
          console.log("🔍 Processing DiffTagNode:", grandchild.getKey());
          const criticMarkup = grandchild.exportMarkdown();
          paragraphText += criticMarkup;
          console.log("✅ DiffTagNode converted to CriticMarkup:", JSON.stringify(criticMarkup));
        } else {
          // For non-diff-tag nodes, preserve formatting using standard transformers
          if ($isTextNode(grandchild)) {
            // Handle text formatting (bold, italic, etc.)
            let text = grandchild.getTextContent();
            
            // Apply text formatting transformers
            const textFormatTransformers = transformers.filter(t => t.type === 'text-format');
            for (const transformer of textFormatTransformers) {
              if (transformer.format && transformer.format.length === 1) {
                const format = transformer.format[0];
                if (grandchild.hasFormat(format)) {
                  const tag = transformer.tag;
                  text = `${tag}${text}${tag}`;
                }
              }
            }
            
            paragraphText += text;
          } else {
            // For other node types, just get the text content
            paragraphText += grandchild.getTextContent();
          }
        }
      });
      
      result += paragraphText + '\n\n';
    } else {
      // For non-paragraph nodes, try to use the appropriate transformer
      let nodeResult = '';
      
      // Try to find a transformer for this node type
      const elementTransformers = transformers.filter(t => t.type === 'element' || t.type === 'multiline-element');
      
      for (const transformer of elementTransformers) {
        if (transformer.export) {
          // Try to match the node type with the transformer
          if (transformer.dependencies && transformer.dependencies.includes(child.getType())) {
            const transformerResult = transformer.export(child);
            if (transformerResult) {
              nodeResult = transformerResult;
              break;
            }
          }
        }
      }
      
      // If no transformer matched, fallback to text content
      if (!nodeResult) {
        nodeResult = child.getTextContent();
      }
      
      result += nodeResult + '\n\n';
    }
  });
  
  console.log("📤 Markdown result:", JSON.stringify(result));
  console.log("📊 Markdown length:", result.length);
  
  return result;
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
 * • getContentAsText: Gets current content as plain text string
 * • toggleMarkdownMode: Switches between markdown and plain text modes
 * • Used by: Editor test pages to update editor with diff HTML and markdown
 */
export interface LexicalEditorRef {
  setContentFromMarkdown: (markdown: string) => void;
  setContentFromText: (text: string) => void;
  getContentAsMarkdown: () => string;
  getContentAsText: () => string;
  toggleMarkdownMode: () => void;
  getMarkdownMode: () => boolean;
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
  const [internalMarkdownMode, setInternalMarkdownMode] = useState<boolean>(isMarkdownMode);

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
    },
    getContentAsText: () => {
      if (editor) {
        let text = '';
        editor.update(() => {
          text = $getRoot().getTextContent();
        });
        return text;
      }
      return '';
    },
    toggleMarkdownMode: () => {
      if (editor) {
        if (internalMarkdownMode) {
          // Switching from markdown to raw text mode
          // Get the current markdown content and store it
          let markdownContent = '';
          editor.update(() => {
            markdownContent = $convertToMarkdownWithCriticMarkup(MARKDOWN_TRANSFORMERS);
          });
          console.log('🔍 DEBUG: getContentAsMarkdown() returned:');
          console.log('📝 Content length:', markdownContent.length);
          console.log('📝 Content preview:', markdownContent.substring(0, 200) + (markdownContent.length > 200 ? '...' : ''));
          console.log('📝 Full content:', JSON.stringify(markdownContent));
          
          // Update the editor to show the raw markdown text
          editor.update(() => {
            const root = $getRoot();
            root.clear();
            const emptyTransformers: any[] = [];
            $convertFromMarkdownString(markdownContent, emptyTransformers);
          });
        } else {
          // Switching from raw text to markdown mode
          // Get the current text content from the editor (raw text, not markdown)
          let currentEditorText = '';
          editor.update(() => {
            currentEditorText = $getRoot().getTextContent();
          });
          console.log('🔍 DEBUG: Switching to markdown mode with current editor text:');
          console.log('📝 Content length:', currentEditorText.length);
          console.log('📝 Content preview:', currentEditorText.substring(0, 200) + (currentEditorText.length > 200 ? '...' : ''));
          console.log('📝 Full content:', JSON.stringify(currentEditorText));
          console.log('🔍 DEBUG: This should contain raw markdown syntax like **bold**');
          
          // Convert the raw text back to markdown
          editor.update(() => {
            const preprocessedMarkdown = preprocessCriticMarkup(currentEditorText);
            $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS);
          });
        }
        setInternalMarkdownMode(!internalMarkdownMode);
      }
    },
    getMarkdownMode: () => {
      return internalMarkdownMode;
    }
  }), [editor, internalMarkdownMode]);

  return (
    <div className={className}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin setEditor={setEditor} />
        <InitialContentPlugin initialContent={initialContent} isMarkdownMode={internalMarkdownMode} />
        <ContentChangePlugin 
          onContentChange={onContentChange} 
          onEditorStateChange={setEditorStateJson}
          isMarkdownMode={internalMarkdownMode}
        />
        {showToolbar && <ToolbarPlugin isMarkdownMode={internalMarkdownMode} />}
        <MarkdownShortcutsPlugin isEnabled={internalMarkdownMode} />
        {internalMarkdownMode && <MarkdownShortcutPlugin />}
        {internalMarkdownMode ? (
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
        <LinkPlugin />
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
