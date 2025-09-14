'use client';

import { $getRoot, $isElementNode, $isTextNode, $createTextNode, $getSelection, $setSelection } from 'lexical';
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
import { CRITIC_MARKUP_IMPORT_TRANSFORMER, DIFF_TAG_EXPORT_TRANSFORMER, preprocessCriticMarkup } from './diffUtils';
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
  CRITIC_MARKUP_IMPORT_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
];

/**
 * Replaces DiffTagNodes with their CriticMarkup text representation
 * 
 * • Clears current selection to prevent "selection has been lost" errors
 * • Traverses the editor tree and replaces diff-tag nodes with text nodes containing CriticMarkup
 * • Preserves all other node types and formatting
 * • Used as a preprocessing step before using Lexical's built-in markdown export
 * • Called by: replaceDiffTagNodesAndExportMarkdown function
 */
export function replaceDiffTagNodes(): void {
  console.log("🔄 replaceDiffTagNodes called");
  
  // Clear the current selection to prevent "selection has been lost" errors
  // when replacing nodes that might be selected
  $setSelection(null);
  
  const root = $getRoot();
  
  // Recursively process all nodes
  function processNode(node: any): void {
    if ($isDiffTagNode(node)) {
      // This is a DiffTagNode - replace it with a text node containing CriticMarkup
      console.log("🔍 Processing DiffTagNode:", node.getKey());
      const criticMarkup = node.exportMarkdown();
      console.log("✅ DiffTagNode converted to CriticMarkup:", JSON.stringify(criticMarkup));
      
      // Create a new text node with the CriticMarkup content
      const textNode = $createTextNode(criticMarkup);
      
      // Replace the DiffTagNode with the text node
      node.replace(textNode);
    } else if ($isElementNode(node)) {
      // For element nodes, process their children
      node.getChildren().forEach(processNode);
    }
  }
  
  // Process all top-level children
  root.getChildren().forEach(processNode);
}

/**
 * Exports editor content as markdown with CriticMarkup for diff annotations
 * 
 * • First replaces all DiffTagNodes with their CriticMarkup text representation
 * • Then uses Lexical's built-in $convertToMarkdownString for full markdown export
 * • Leverages Lexical's native markdown transformers for proper formatting
 * • More reliable and maintainable than custom markdown generation
 * • Used by: LexicalEditor for markdown export with diff annotations
 */
export function replaceDiffTagNodesAndExportMarkdown(): string {
  console.log("🔄 replaceDiffTagNodesAndExportMarkdown called");
  
  // First, replace all DiffTagNodes with their CriticMarkup text
  replaceDiffTagNodes();
  
  // Then use Lexical's built-in markdown export
  const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
  
  console.log("📤 Markdown result:", JSON.stringify(markdown));
  console.log("📊 Markdown length:", markdown.length);
  
  return markdown;
}

/**
* REASON = markdown will add line breaks (as it should), but anytime Lexical finds a heading or paragraph is already implicitly adds line breaks
 * 
 * • Traverses the editor tree recursively to find heading and paragraph nodes
 * • Identifies text nodes within these elements and removes all trailing <br> tags
 * • Handles multiple consecutive <br> tags at the end (e.g., <br><br><br>)
 * • Uses regex pattern to match various <br> tag formats (self-closing, with attributes, etc.)
 * • Preserves all other content and formatting
 * • Used by: convertFromMarkdownString cleanup to remove unwanted trailing breaks
 */
export function removeTrailingBreaksFromTextNodes(): void {
  console.log("🧹 removeTrailingBreaksFromTextNodes called");
  
  const root = $getRoot();
  
  // Recursively process all nodes
  function processNode(node: any): void {
    if ($isElementNode(node)) {
      const nodeType = node.getType();
      
      // Check if this is a heading or paragraph node
      if (nodeType === 'heading' || nodeType === 'paragraph') {
        console.log(`🔍 Processing ${nodeType} node:`, node.getKey());
        
        // Get all text children of this node
        const children = node.getChildren();
        children.forEach((child: any) => {
          if ($isTextNode(child)) {
            const textContent = child.getTextContent();
            // Remove all trailing <br> tags (various formats: <br>, <br/>, <br />, with whitespace)
            // This handles multiple consecutive <br> tags at the end
            const cleanedText = textContent.replace(/(<br\s*\/?>\s*)+$/g, '');
            
            if (textContent !== cleanedText) {
              console.log(`🧹 Removed trailing <br> from text node:`, JSON.stringify(textContent), "->", JSON.stringify(cleanedText));
              child.setTextContent(cleanedText);
            }
          }
        });
      }
      
      // Recursively process all children
      node.getChildren().forEach(processNode);
    }
  }
  
  // Process all top-level children
  root.getChildren().forEach(processNode);
  console.log("✅ removeTrailingBreaksFromTextNodes completed");
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
          // Clean up trailing <br> tags from heading and paragraph text nodes
          removeTrailingBreaksFromTextNodes();
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
 * • setContentFromMarkdown: Updates editor content using markdown string
 * • getContentAsMarkdown: Gets current content as markdown string
 * • toggleMarkdownMode: Switches between markdown and plain text modes
 * • getMarkdownMode: Returns current markdown mode state
 * • Used by: Editor test pages to update editor with diff HTML and markdown
 */
export interface LexicalEditorRef {
  setContentFromMarkdown: (markdown: string) => void;
  getContentAsMarkdown: () => string;
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

  // Sync internal state with prop changes
  useEffect(() => {
    setInternalMarkdownMode(isMarkdownMode);
  }, [isMarkdownMode]);

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
          // Clean up trailing <br> tags from heading and paragraph text nodes
          removeTrailingBreaksFromTextNodes();
        });
      }
    },
    getContentAsMarkdown: () => {
      if (editor) {
        let markdown = '';
        editor.update(() => {
          markdown = replaceDiffTagNodesAndExportMarkdown();
        });
        return markdown;
      }
      return '';
    },
    toggleMarkdownMode: () => {
      if (editor) {
        if (internalMarkdownMode) {
          // Switching from markdown to raw text mode
          // Get the current markdown content using Lexical's export
          let markdownContent = '';
          editor.update(() => {
            markdownContent = replaceDiffTagNodesAndExportMarkdown();
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
            // Clean up trailing <br> tags from heading and paragraph text nodes
            removeTrailingBreaksFromTextNodes();
          });
        }
        // Note: Don't update internal state here - parent component handles that
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
