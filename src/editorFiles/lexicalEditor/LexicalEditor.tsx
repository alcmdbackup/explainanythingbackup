'use client';

import { $getRoot} from 'lexical';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
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
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';

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
import { AutoLinkNode } from '@lexical/link';
import { OverflowNode } from '@lexical/overflow';
import { MarkNode } from '@lexical/mark';

// Import custom DiffTagNodeInline and CriticMarkup transformer
import { DiffTagNodeInline, DiffTagNodeBlock, DiffUpdateContainerInline } from './DiffTagNode';
import { StandaloneTitleLinkNode } from './StandaloneTitleLinkNode';
import { preprocessCriticMarkup, replaceDiffTagNodesAndExportMarkdown, removeTrailingBreaksFromTextNodes, replaceBrTagsWithNewlines, MARKDOWN_TRANSFORMERS, exportMarkdownReadOnly } from './importExportUtils';
import ToolbarPlugin from './ToolbarPlugin';
import DiffTagHoverPlugin from './DiffTagHoverPlugin';





// Theme configuration for the editor - matching results page styling
const theme = {
  paragraph: 'mt-1 mb-4 text-gray-700 dark:text-gray-300 leading-relaxed',
  heading: {
    h1: 'text-3xl font-bold text-gray-900 dark:text-white mb-4 mt-0 leading-tight',
    h2: 'text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-3 mt-6 leading-tight',
    h3: 'text-xl font-medium text-gray-800 dark:text-gray-100 mb-2 mt-5 leading-tight',
    h4: 'text-lg font-medium text-gray-800 dark:text-gray-100 mb-2 mt-4 leading-tight',
    h5: 'text-base font-medium text-gray-800 dark:text-gray-100 mb-1 mt-3 leading-tight',
    h6: 'text-sm font-medium text-gray-800 dark:text-gray-100 mb-1 mt-2 leading-tight',
  },
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
  },
  list: {
    ul: 'my-4 space-y-2 list-disc list-inside text-gray-700 dark:text-gray-300',
    ol: 'my-4 space-y-2 list-decimal list-inside text-gray-700 dark:text-gray-300',
    listitem: 'my-1 leading-relaxed',
  },
  link: 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer transition-colors',
  code: 'bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200',
  codeblock: 'bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto my-4',
  quote: 'border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600 dark:text-gray-400',
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
    console.log('🔄 LexicalEditor ContentChangePlugin.handleChange called');

    if (onEditorStateChange) {
      const editorState = editor.getEditorState();
      const editorStateJson = JSON.stringify(editorState.toJSON(), null, 2);
      onEditorStateChange(editorStateJson);
    }

    if (onContentChange) {
      console.log('📝 LexicalEditor extracting content via exportMarkdownReadOnly');
      // Get current content as markdown and call the content change callback
      let currentContent = '';
      editor.getEditorState().read(() => {
        currentContent = exportMarkdownReadOnly();
      });
      console.log('📝 LexicalEditor calling onContentChange with content length:', currentContent.length);
      onContentChange(currentContent);
    } else {
      console.log('❌ LexicalEditor: No onContentChange callback provided');
    }
  }, [editor, onContentChange, onEditorStateChange, isMarkdownMode]);

  return <OnChangePlugin onChange={handleChange} />;
}

// Plugin for managing display/edit mode state
function DisplayModePlugin({ isEditMode }: { isEditMode: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(isEditMode);
    if (!isEditMode) {
      editor.blur();
    }
  }, [editor, isEditMode]);

  return null;
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
  isEditMode?: boolean;
  onEditModeToggle?: () => void;
  hideEditingUI?: boolean;
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
  setEditMode: (isEditMode: boolean) => void;
  getEditMode: () => boolean;
  focus: () => void;
}

const LexicalEditor = forwardRef<LexicalEditorRef, LexicalEditorProps>(({
  placeholder = "Enter some text...",
  className = "",
  initialContent = "",
  onContentChange,
  showEditorState = true,
  isMarkdownMode = false,
  showTreeView = true,
  showToolbar = true,
  isEditMode = true,
  onEditModeToggle,
  hideEditingUI = false
}, ref) => {
  const [editorStateJson, setEditorStateJson] = useState<string>('');
  const [editor, setEditor] = useState<any>(null);
  const [internalMarkdownMode, setInternalMarkdownMode] = useState<boolean>(isMarkdownMode);
  const [internalEditMode, setInternalEditMode] = useState<boolean>(isEditMode);
  const [pendingOperations, setPendingOperations] = useState<Array<(editor: any) => void>>([]);

  // Sync internal state with prop changes
  useEffect(() => {
    setInternalMarkdownMode(isMarkdownMode);
  }, [isMarkdownMode]);

  useEffect(() => {
    setInternalEditMode(isEditMode);
  }, [isEditMode]);

  // Process pending operations when editor becomes ready
  useEffect(() => {
    if (editor && pendingOperations.length > 0) {
      console.log('📝 LexicalEditor: Processing queued operations, count:', pendingOperations.length);
      pendingOperations.forEach(operation => operation(editor));
      setPendingOperations([]);
    }
  }, [editor, pendingOperations]);

  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError,
    nodes: [
      DiffTagNodeBlock,
      DiffTagNodeInline,
      DiffUpdateContainerInline,
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      StandaloneTitleLinkNode,
      AutoLinkNode,
      TableNode,
      TableCellNode,
      TableRowNode,
      HorizontalRuleNode,
      OverflowNode,
      MarkNode
    ],
  };

  // Expose the editor functions via ref
  useImperativeHandle(ref, () => ({
    setContentFromMarkdown: (markdown: string) => {
      console.log('📝 LexicalEditor.setContentFromMarkdown called', {
        markdownLength: markdown?.length || 0,
        hasEditor: !!editor,
        markdownPreview: markdown?.substring(0, 200),
        hasCriticMarkup: markdown?.includes('{++') || markdown?.includes('{--') || markdown?.includes('{~~')
      });

      // DIAGNOSTIC: Test regex matching on raw markdown
      if (markdown) {
        const criticMarkupRegex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
        const matches = Array.from(markdown.matchAll(criticMarkupRegex));
        console.log('📝 DIAGNOSTIC: Raw markdown CriticMarkup matches:', {
          matchCount: matches.length,
          firstThreeMatches: matches.slice(0, 3).map(m => m[0].substring(0, 50))
        });
      }

      if (editor) {
        editor.update(() => {
          // Preprocess markdown to normalize multiline CriticMarkup
          console.log('📝 LexicalEditor: Preprocessing CriticMarkup...');
          const preprocessedMarkdown = preprocessCriticMarkup(markdown);
          console.log('📝 LexicalEditor: Preprocessed markdown', {
            preprocessedLength: preprocessedMarkdown?.length || 0,
            preprocessedPreview: preprocessedMarkdown?.substring(0, 200)
          });

          // DIAGNOSTIC: Test regex matching on preprocessed markdown
          const criticMarkupRegex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
          const matchesAfterPreprocess = Array.from(preprocessedMarkdown.matchAll(criticMarkupRegex));
          console.log('📝 DIAGNOSTIC: Preprocessed markdown CriticMarkup matches:', {
            matchCount: matchesAfterPreprocess.length,
            firstThreeMatches: matchesAfterPreprocess.slice(0, 3).map(m => m[0].substring(0, 50))
          });

          console.log('📝 LexicalEditor: Converting markdown to Lexical nodes...');
          $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS);
          console.log('📝 LexicalEditor: Markdown conversion completed');

          // Clean up trailing <br> tags from heading and paragraph text nodes as Lexical and Markdown stringify both add trailing BRs
          //removeTrailingBreaksFromTextNodes(); --> DEPRECATED
          console.log('📝 LexicalEditor: Replacing <br> tags with newlines...');
          replaceBrTagsWithNewlines();
          console.log('📝 LexicalEditor: setContentFromMarkdown completed successfully');
        });
      } else {
        console.log('📝 LexicalEditor: editor is null, queueing operation');
        setPendingOperations(prev => [...prev, (editorInstance) => {
          editorInstance.update(() => {
            // Preprocess markdown to normalize multiline CriticMarkup
            console.log('📝 LexicalEditor: [QUEUED] Preprocessing CriticMarkup...');
            const preprocessedMarkdown = preprocessCriticMarkup(markdown);
            console.log('📝 LexicalEditor: [QUEUED] Preprocessed markdown', {
              preprocessedLength: preprocessedMarkdown?.length || 0,
              preprocessedPreview: preprocessedMarkdown?.substring(0, 200)
            });

            // DIAGNOSTIC: Test regex matching on preprocessed markdown
            const criticMarkupRegex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
            const matchesAfterPreprocess = Array.from(preprocessedMarkdown.matchAll(criticMarkupRegex));
            console.log('📝 DIAGNOSTIC: [QUEUED] Preprocessed markdown CriticMarkup matches:', {
              matchCount: matchesAfterPreprocess.length,
              firstThreeMatches: matchesAfterPreprocess.slice(0, 3).map(m => m[0].substring(0, 50))
            });

            console.log('📝 LexicalEditor: [QUEUED] Converting markdown to Lexical nodes...');
            $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS);
            console.log('📝 LexicalEditor: [QUEUED] Markdown conversion completed');

            // Clean up trailing <br> tags from heading and paragraph text nodes as Lexical and Markdown stringify both add trailing BRs
            //removeTrailingBreaksFromTextNodes(); --> DEPRECATED
            console.log('📝 LexicalEditor: [QUEUED] Replacing <br> tags with newlines...');
            replaceBrTagsWithNewlines();
            console.log('📝 LexicalEditor: [QUEUED] setContentFromMarkdown completed successfully');
          });
        }]);
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
    },
    setEditMode: (newEditMode: boolean) => {
      setInternalEditMode(newEditMode);
      if (editor) {
        editor.setEditable(newEditMode);
        if (newEditMode) {
          editor.focus();
        } else {
          editor.blur();
        }
      }
    },
    getEditMode: () => {
      return internalEditMode;
    },
    focus: () => {
      if (editor) {
        editor.focus();
      }
    }
  }), [editor, internalMarkdownMode, internalEditMode]);

  return (
    <div className={className}>
      <style jsx>{`
        .lexical-display-mode {
          caret-color: transparent !important;
        }
        .lexical-display-mode .ContentEditable__root {
          cursor: default !important;
          outline: none !important;
        }
        .lexical-display-mode .ContentEditable__root:focus {
          outline: none !important;
          border: none !important;
        }
      `}</style>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin setEditor={setEditor} />
        <InitialContentPlugin initialContent={initialContent} isMarkdownMode={internalMarkdownMode} />
        <ContentChangePlugin 
          onContentChange={onContentChange} 
          onEditorStateChange={setEditorStateJson}
          isMarkdownMode={internalMarkdownMode}
        />
        <DisplayModePlugin isEditMode={internalEditMode} />
        {showToolbar && !hideEditingUI && internalEditMode && <ToolbarPlugin isMarkdownMode={internalMarkdownMode} />}
        <MarkdownShortcutsPlugin isEnabled={internalMarkdownMode} />
        {internalMarkdownMode && <MarkdownShortcutPlugin />}
        {internalMarkdownMode ? (
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={`lexical-editor min-h-[200px] p-4 text-gray-900 dark:text-white prose dark:prose-invert max-w-none ${
                  internalEditMode
                    ? "border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700"
                    : "border-none bg-transparent focus:outline-none lexical-display-mode"
                }`}
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
                className={`lexical-editor min-h-[200px] p-4 text-gray-900 dark:text-white font-mono text-sm ${
                  internalEditMode
                    ? "border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700"
                    : "border-none bg-transparent focus:outline-none lexical-display-mode"
                }`}
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
        <AutoLinkPlugin matchers={[]} />
        <ListPlugin />
        <TablePlugin />
        <CheckListPlugin />
        <DiffTagHoverPlugin />
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



// Edit mode toggle component
export function EditModeToggle({ isEditMode, onToggle }: { isEditMode: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:hover:bg-gray-600"
    >
      {isEditMode ? (
        <>
          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Done Editing
        </>
      ) : (
        <>
          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </>
      )}
    </button>
  );
}

export default LexicalEditor;
