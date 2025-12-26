/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { $getRoot, $isTextNode, $createTextNode, TextNode, LexicalNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { $isLinkNode } from '@lexical/link';
import { $isHeadingNode } from '@lexical/rich-text';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
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
  registerMarkdownShortcuts
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
import { StandaloneTitleLinkNode, $createStandaloneTitleLinkNode, $isStandaloneTitleLinkNode } from './StandaloneTitleLinkNode';
import { preprocessCriticMarkup, replaceDiffTagNodesAndExportMarkdown, removeTrailingBreaksFromTextNodes, replaceBrTagsWithNewlines, MARKDOWN_TRANSFORMERS, exportMarkdownReadOnly } from './importExportUtils';
import ToolbarPlugin from './ToolbarPlugin';
import DiffTagHoverPlugin from './DiffTagHoverPlugin';
import MutationQueuePlugin from './MutationQueuePlugin';
import { StreamingSyncPlugin } from './StreamingSyncPlugin';
import { TextRevealPlugin } from './TextRevealPlugin';
import { MutationOp } from '@/reducers/pageLifecycleReducer';
import { TextRevealEffect } from '@/lib/textRevealAnimations';
import { CitationPlugin } from './CitationPlugin';
import { getLinkDataForLexicalOverlayAction, type LexicalLinkOverlayData } from '@/actions/actions';

/**
 * Encodes a URL parameter for use in standalone title links
 * Duplicated from links.ts to avoid server-only import chain
 */
function encodeStandaloneTitleParam(title: string): string {
  let encoded = encodeURIComponent(title);
  // Additionally encode parentheses which break markdown link parsing
  encoded = encoded.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return encoded;
}





// Theme configuration for the editor - Midnight Scholar styling
const theme = {
  paragraph: 'mt-1 mb-4 leading-relaxed font-serif text-[var(--text-primary)]',
  heading: {
    h1: 'text-3xl font-display font-bold mb-4 mt-0 leading-tight text-[var(--text-primary)]',
    h2: 'text-2xl font-display font-semibold mb-3 mt-6 leading-tight text-[var(--text-primary)]',
    h3: 'text-xl font-display font-medium mb-2 mt-5 leading-tight text-[var(--text-primary)]',
    h4: 'text-lg font-display font-medium mb-2 mt-4 leading-tight text-[var(--text-primary)]',
    h5: 'text-base font-display font-medium mb-1 mt-3 leading-tight text-[var(--text-primary)]',
    h6: 'text-sm font-display font-medium mb-1 mt-2 leading-tight text-[var(--text-primary)]',
  },
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline decoration-[var(--accent-gold)]',
  },
  list: {
    ul: 'my-4 space-y-2 list-disc list-inside font-serif',
    ol: 'my-4 space-y-2 list-decimal list-inside font-serif',
    listitem: 'my-1 leading-relaxed marker:text-[var(--accent-gold)]',
  },
  link: 'text-[var(--accent-gold)] underline cursor-pointer transition-colors hover:text-[var(--accent-copper)]',
  code: 'px-1.5 py-0.5 rounded-page text-sm font-mono bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  codeblock: 'bg-[var(--surface-elevated)] p-4 rounded-book overflow-x-auto my-4 border border-[var(--border-default)] font-mono text-sm',
  quote: 'border-l-4 border-[var(--accent-gold)] pl-4 my-4 italic font-serif text-[var(--text-secondary)] bg-[var(--surface-elevated)]/50 py-2 rounded-r-page',
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
          // Clean up <br> tags from text nodes (including in diff tags)
          replaceBrTagsWithNewlines();
        });
      } else {
        editor.update(() => {
          $convertFromMarkdownString(initialContent, undefined);
        });
      }
    }
  }, [editor, initialContent, isMarkdownMode]);

  return null;
}

// Custom plugin for tracking content changes and editor state
function ContentChangePlugin({
  onContentChange,
  onEditorStateChange,
  isMarkdownMode: _isMarkdownMode = false
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
  }, [editor, onContentChange, onEditorStateChange]);

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

// Component to display editor state as JSON - Midnight Scholar styling
function EditorStateDisplay({ editorStateJson }: { editorStateJson: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
        Editor State (JSON)
      </h3>
      <textarea
        value={editorStateJson}
        readOnly
        className="w-full h-64 p-3 border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-mono text-sm resize-none shadow-page"
        placeholder="Editor state will appear here..."
      />
    </div>
  );
}

/**
 * Source data for citation interactivity
 */
interface CitationSource {
  index: number;
  title: string;
  domain: string;
  url: string;
  favicon_url?: string | null;
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
  isStreaming?: boolean;
  textRevealEffect?: TextRevealEffect;
  /** Sources for citation [n] interactivity */
  sources?: CitationSource[];
  /** Callback when pending AI suggestions change (true = suggestions exist) */
  onPendingSuggestionsChange?: (hasPendingSuggestions: boolean) => void;
  /** Mutation queue - pending mutations to process */
  pendingMutations?: MutationOp[];
  /** Mutation queue - currently processing mutation */
  processingMutation?: MutationOp | null;
  /** Mutation queue - callback when mutation starts */
  onStartMutation?: (id: string) => void;
  /** Mutation queue - callback when mutation completes */
  onCompleteMutation?: (id: string, newContent: string) => void;
  /** Mutation queue - callback when mutation fails */
  onFailMutation?: (id: string, error: string) => void;
  /** DiffTag - callback to queue accept/reject mutation */
  onQueueMutation?: (nodeKey: string, type: 'accept' | 'reject') => void;
  /** StreamingSync - content to sync to editor */
  syncContent?: string;
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
  applyLinkOverlay: (explanationId: number) => Promise<void>;
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
  onEditModeToggle: _onEditModeToggle,
  hideEditingUI = false,
  isStreaming = false,
  textRevealEffect = 'none',
  sources = [],
  onPendingSuggestionsChange,
  pendingMutations = [],
  processingMutation = null,
  onStartMutation,
  onCompleteMutation,
  onFailMutation,
  onQueueMutation,
  syncContent,
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
            // Clean up <br> tags from text nodes (including in diff tags)
            replaceBrTagsWithNewlines();
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
    },
    applyLinkOverlay: async (explanationId: number) => {
      if (!explanationId) {
        console.log('📝 LexicalEditor.applyLinkOverlay: No explanationId provided, skipping');
        return;
      }

      if (!editor) {
        console.log('📝 LexicalEditor.applyLinkOverlay: Editor not ready');
        return;
      }

      console.log('📝 LexicalEditor.applyLinkOverlay: Fetching link data for explanationId:', explanationId);

      // Fetch link data OUTSIDE editor.update()
      const linkData = await getLinkDataForLexicalOverlayAction({ explanationId });

      console.log('📝 LexicalEditor.applyLinkOverlay: Received link data', {
        headingLinks: linkData.headingLinks.length,
        whitelistTerms: linkData.whitelistTerms.length,
        overrides: linkData.overrides.length
      });

      // Build lookup maps for efficient access
      const headingLinkMap = new Map(
        linkData.headingLinks.map(h => [h.headingTextLower, h.standaloneTitle])
      );

      const overrideMap = new Map(
        linkData.overrides.map(o => [o.termLower, o])
      );

      // Sort terms by length (longest first) for proper matching
      const sortedTerms = [...linkData.whitelistTerms].sort(
        (a, b) => b.termLower.length - a.termLower.length
      );

      // All DOM mutations in ONE update call
      editor.update(() => {
        const matchedTerms = new Set<string>(); // First-occurrence tracking
        const nodes = $dfs($getRoot());

        // Helper: Check if node is inside a link
        const isInsideLinkNode = (node: LexicalNode): boolean => {
          let parent = node.getParent();
          while (parent !== null) {
            if ($isLinkNode(parent) || $isStandaloneTitleLinkNode(parent)) {
              return true;
            }
            parent = parent.getParent();
          }
          return false;
        };

        // Helper: Check word boundaries
        const isWordBoundary = (content: string, startIndex: number, endIndex: number): boolean => {
          const isBoundary = (char: string) => /[\s.,;:!?()\[\]{}'\"<>\/]/.test(char);
          const beforeOk = startIndex === 0 || isBoundary(content[startIndex - 1]);
          const afterOk = endIndex >= content.length || isBoundary(content[endIndex]);
          return beforeOk && afterOk;
        };

        // Helper: Wrap a match in a StandaloneTitleLinkNode
        const wrapMatchInLink = (textNode: TextNode, startIndex: number, endIndex: number, standaloneTitle: string): void => {
          const textLength = textNode.getTextContentSize();
          const url = `/standalone-title?t=${encodeStandaloneTitleParam(standaloneTitle)}`;

          if (startIndex === 0 && endIndex === textLength) {
            // Entire node - create clone, wrap in link, replace
            const clone = $createTextNode(textNode.getTextContent());
            clone.setFormat(textNode.getFormat());
            const linkNode = $createStandaloneTitleLinkNode(url);
            linkNode.append(clone);
            textNode.replace(linkNode);
          } else if (startIndex === 0) {
            // Match at start: splitText returns [match, after]
            const [match] = textNode.splitText(endIndex);
            const linkNode = $createStandaloneTitleLinkNode(url);
            linkNode.append(match);
            match.replace(linkNode);
          } else if (endIndex === textLength) {
            // Match at end: splitText returns [before, match]
            const parts = textNode.splitText(startIndex);
            const match = parts[1];
            const linkNode = $createStandaloneTitleLinkNode(url);
            linkNode.append(match);
            match.replace(linkNode);
          } else {
            // Match in middle: splitText returns [before, match, after]
            const parts = textNode.splitText(startIndex, endIndex);
            const match = parts[1];
            const linkNode = $createStandaloneTitleLinkNode(url);
            linkNode.append(match);
            match.replace(linkNode);
          }
        };

        // Process heading nodes first
        for (const { node } of nodes) {
          if ($isHeadingNode(node)) {
            const headingText = node.getTextContent().trim().toLowerCase();
            const standaloneTitle = headingLinkMap.get(headingText);

            if (standaloneTitle) {
              // Wrap all text children of the heading in a link
              const children = node.getChildren();
              for (const child of children) {
                if ($isTextNode(child) && !isInsideLinkNode(child)) {
                  const url = `/standalone-title?t=${encodeStandaloneTitleParam(standaloneTitle)}`;
                  const clone = $createTextNode(child.getTextContent());
                  clone.setFormat(child.getFormat());
                  const linkNode = $createStandaloneTitleLinkNode(url);
                  linkNode.append(clone);
                  child.replace(linkNode);
                }
              }
            }
          }
        }

        // Re-traverse for term matching (headings may have changed structure)
        const nodesForTerms = $dfs($getRoot());

        for (const { node } of nodesForTerms) {
          if (!$isTextNode(node) || isInsideLinkNode(node)) {
            continue;
          }

          const textContent = node.getTextContent();
          const textContentLower = textContent.toLowerCase();

          // Find all matches in this text node
          interface Match {
            startIndex: number;
            endIndex: number;
            standaloneTitle: string;
            termLower: string;
          }
          const matches: Match[] = [];

          for (const term of sortedTerms) {
            // Skip if already matched this term
            if (matchedTerms.has(term.termLower)) continue;

            // Check override
            const override = overrideMap.get(term.termLower);
            if (override?.type === 'disabled') {
              matchedTerms.add(term.termLower);
              continue;
            }

            // Find occurrence
            const index = textContentLower.indexOf(term.termLower);
            if (index === -1) continue;

            const endIndex = index + term.termLower.length;

            // Check word boundaries
            if (!isWordBoundary(textContent, index, endIndex)) continue;

            // Check for overlaps with existing matches
            const overlaps = matches.some(
              m => !(endIndex <= m.startIndex || index >= m.endIndex)
            );
            if (overlaps) continue;

            // Valid match
            const standaloneTitle = override?.type === 'custom_title' && override.customTitle
              ? override.customTitle
              : term.standaloneTitle;

            matches.push({
              startIndex: index,
              endIndex,
              standaloneTitle,
              termLower: term.termLower
            });

            matchedTerms.add(term.termLower);
          }

          // Process matches right-to-left to avoid index drift
          matches.sort((a, b) => b.startIndex - a.startIndex);

          let currentNode: TextNode | null = node;
          for (const match of matches) {
            if (currentNode) {
              wrapMatchInLink(currentNode, match.startIndex, match.endIndex, match.standaloneTitle);
              // After wrapping, currentNode is no longer valid for further operations
              // Each match should be processed on the original indices
              currentNode = null;
            }
          }
        }

        console.log('📝 LexicalEditor.applyLinkOverlay: Complete, matched terms:', matchedTerms.size);
      });
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
                className={`lexical-editor min-h-[200px] p-4 text-[var(--text-primary)] prose max-w-none ${
                  internalEditMode
                    ? "border border-[var(--border-default)] rounded-book focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)] bg-[var(--surface-secondary)] shadow-page"
                    : "border-none bg-transparent focus:outline-none lexical-display-mode"
                }`}
              />
            }
            placeholder={
              <div className="absolute top-4 left-4 text-[var(--text-muted)] font-serif italic pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        ) : (
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={`lexical-editor min-h-[200px] p-4 text-[var(--text-secondary)] font-mono text-sm ${
                  internalEditMode
                    ? "border border-[var(--border-default)] rounded-book focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)] bg-[var(--surface-secondary)] shadow-page"
                    : "border-none bg-transparent focus:outline-none lexical-display-mode"
                }`}
              />
            }
            placeholder={
              <div className="absolute top-4 left-4 text-[var(--text-muted)] font-mono pointer-events-none">
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
        <DiffTagHoverPlugin
          onPendingSuggestionsChange={onPendingSuggestionsChange}
          onQueueMutation={onQueueMutation}
          isProcessing={processingMutation !== null}
        />
        {(pendingMutations.length > 0 || processingMutation !== null) && onStartMutation && onCompleteMutation && onFailMutation && (
          <MutationQueuePlugin
            pendingMutations={pendingMutations}
            processingMutation={processingMutation}
            onStartMutation={onStartMutation}
            onCompleteMutation={onCompleteMutation}
            onFailMutation={onFailMutation}
          />
        )}
        {syncContent !== undefined && (
          <StreamingSyncPlugin
            content={syncContent}
            isStreaming={isStreaming}
          />
        )}
        <TextRevealPlugin isStreaming={isStreaming} animationEffect={textRevealEffect} />
        <CitationPlugin sources={sources} enabled={sources.length > 0} />
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
 * Midnight Scholar styling
 */
function TreeViewPlugin() {
  const [editor] = useLexicalComposerContext();

  return (
    <div className="mt-4">
      <h3 className="text-sm font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
        Editor Tree View
      </h3>
      <TreeView
        viewClassName="tree-view-output max-h-96 overflow-auto border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4 font-mono text-sm text-[var(--text-secondary)]"
        treeTypeButtonClassName="debug-treetype-button px-3 py-1 bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] rounded-page hover:shadow-warm transition-all"
        timeTravelPanelClassName="debug-timetravel-panel mt-4 p-3 border border-[var(--border-default)] rounded-book bg-[var(--surface-secondary)]"
        timeTravelButtonClassName="debug-timetravel-button px-3 py-1 bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] rounded-page hover:shadow-warm transition-all"
        timeTravelPanelSliderClassName="debug-timetravel-panel-slider w-full h-2 bg-[var(--surface-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--accent-gold)]"
        timeTravelPanelButtonClassName="debug-timetravel-panel-button px-2 py-1 text-xs bg-[var(--surface-elevated)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--accent-gold)]/10 hover:text-[var(--accent-gold)] transition-colors"
        editor={editor}
      />
    </div>
  );
}



// Edit mode toggle component - Midnight Scholar styling
export function EditModeToggle({ isEditMode, onToggle }: { isEditMode: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center px-4 py-2 border border-[var(--border-default)] rounded-page shadow-warm bg-[var(--surface-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] text-[var(--text-secondary)] font-sans text-sm font-medium transition-all duration-200 focus:ring-2 focus:ring-[var(--accent-gold)]/30"
    >
      {isEditMode ? (
        <>
          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Done
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

LexicalEditor.displayName = 'LexicalEditor';

export default LexicalEditor;
