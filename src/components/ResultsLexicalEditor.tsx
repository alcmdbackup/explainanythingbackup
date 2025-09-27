'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import LexicalEditor, { LexicalEditorRef, EditModeToggle } from '../editorFiles/lexicalEditor/LexicalEditor';
import AISuggestionsPanel from '../editorFiles/lexicalEditor/AISuggestionsPanel';

interface ResultsLexicalEditorProps {
  content: string;
  isEditMode: boolean;
  onEditModeToggle?: () => void;
  onContentChange?: (content: string) => void;
  isStreaming?: boolean;
  className?: string;
  showAISuggestions?: boolean;
}

export interface ResultsLexicalEditorRef {
  updateContent: (content: string) => void;
  getContent: () => string;
  setReadOnly: (readOnly: boolean) => void;
  toggleAISuggestions: () => void;
  isAISuggestionsVisible: () => boolean;
}

const ResultsLexicalEditor = forwardRef<ResultsLexicalEditorRef, ResultsLexicalEditorProps>(({
  content,
  isEditMode,
  onEditModeToggle,
  onContentChange,
  isStreaming = false,
  className = "",
  showAISuggestions = false
}, ref) => {
  const editorRef = useRef<LexicalEditorRef>(null);
  const [currentContent, setCurrentContent] = useState(content);
  const [internalEditMode, setInternalEditMode] = useState(isEditMode);
  const [isSuggestionsVisible, setIsSuggestionsVisible] = useState(showAISuggestions);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamingUpdateRef = useRef<string>('');

  // Lock editor during streaming to prevent conflicts
  useEffect(() => {
    if (isStreaming && editorRef.current) {
      editorRef.current.setEditMode(false);
    } else if (!isStreaming && editorRef.current) {
      editorRef.current.setEditMode(internalEditMode);
    }
  }, [isStreaming, internalEditMode]);

  // Debounced update function for streaming content
  const debouncedUpdateContent = useCallback((newContent: string) => {
    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set a new debounce timeout
    debounceTimeoutRef.current = setTimeout(() => {
      if (editorRef.current && newContent !== lastStreamingUpdateRef.current) {
        try {
          editorRef.current.setContentFromMarkdown(newContent);
          lastStreamingUpdateRef.current = newContent;
          setCurrentContent(newContent);
        } catch (error) {
          console.error('Error updating editor content during streaming:', error);
        }
      }
    }, isStreaming ? 100 : 0); // Use 100ms debounce for streaming, immediate for non-streaming
  }, [isStreaming]);

  // Update editor content when content prop changes (streaming updates)
  useEffect(() => {
    if (content !== currentContent) {
      if (isStreaming) {
        // Use debounced updates during streaming for better performance
        debouncedUpdateContent(content);
      } else {
        // Immediate update when not streaming
        if (editorRef.current) {
          editorRef.current.setContentFromMarkdown(content);
          setCurrentContent(content);
        }
      }
    }
  }, [content, currentContent, isStreaming, debouncedUpdateContent]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Sync edit mode with prop changes
  useEffect(() => {
    setInternalEditMode(isEditMode);
    if (editorRef.current && !isStreaming) {
      editorRef.current.setEditMode(isEditMode);
    }
  }, [isEditMode, isStreaming]);

  // Handle edit mode toggle
  const handleEditModeToggle = () => {
    const newEditMode = !internalEditMode;
    setInternalEditMode(newEditMode);
    if (editorRef.current && !isStreaming) {
      editorRef.current.setEditMode(newEditMode);
    }
    onEditModeToggle?.();
  };

  // Toggle AI suggestions panel
  const toggleAISuggestions = useCallback(() => {
    setIsSuggestionsVisible(prev => !prev);
  }, []);

  // Close AI suggestions panel
  const closeAISuggestions = useCallback(() => {
    setIsSuggestionsVisible(false);
  }, []);

  // Handle content changes from editor and AI suggestions
  const handleContentChange = useCallback((newContent: string) => {
    setCurrentContent(newContent);
    onContentChange?.(newContent);
  }, [onContentChange]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    updateContent: (newContent: string) => {
      if (editorRef.current) {
        editorRef.current.setContentFromMarkdown(newContent);
        setCurrentContent(newContent);
      }
    },
    getContent: () => {
      return editorRef.current?.getContentAsMarkdown() || '';
    },
    setReadOnly: (readOnly: boolean) => {
      if (editorRef.current) {
        editorRef.current.setEditMode(!readOnly);
      }
    },
    toggleAISuggestions,
    isAISuggestionsVisible: () => isSuggestionsVisible
  }), [toggleAISuggestions, isSuggestionsVisible]);

  return (
    <div className={`editor-layout flex h-full ${className}`}>
      {/* Main Content Area */}
      <div className={`main-content flex-1 ${isSuggestionsVisible ? 'pr-0' : ''}`}>
        {/* Control Bar */}
        <div className="mb-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            {/* AI Suggestions Toggle Button */}
            <button
              onClick={toggleAISuggestions}
              className={`inline-flex items-center px-3 py-2 border rounded-md shadow-sm text-sm font-medium transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                isSuggestionsVisible
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}
              aria-pressed={isSuggestionsVisible}
            >
              <svg className={`-ml-1 mr-2 h-4 w-4 ${isSuggestionsVisible ? 'text-white' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {isSuggestionsVisible ? 'Hide AI Suggestions' : 'Show AI Suggestions'}
            </button>

            {isSuggestionsVisible && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                AI suggestions panel is open
              </span>
            )}
          </div>

          {/* Edit Mode Toggle */}
          <EditModeToggle
            isEditMode={internalEditMode && !isStreaming}
            onToggle={handleEditModeToggle}
          />
        </div>

        {/* Streaming Indicator */}
        {isStreaming && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              <span className="text-sm text-blue-800 dark:text-blue-200">
                Content is being updated... Editor is locked during streaming.
              </span>
            </div>
          </div>
        )}

        {/* Lexical Editor */}
        <LexicalEditor
          ref={editorRef}
          placeholder="Content will appear here..."
          className="w-full"
          initialContent={content}
          isMarkdownMode={true}
          isEditMode={internalEditMode && !isStreaming}
          showEditorState={false}
          showTreeView={false}
          showToolbar={true}
          hideEditingUI={isStreaming}
          onContentChange={handleContentChange}
        />
      </div>

      {/* AI Suggestions Panel */}
      {isSuggestionsVisible && (
        <div className="suggestions-panel">
          <AISuggestionsPanel
            isVisible={isSuggestionsVisible}
            onClose={closeAISuggestions}
            currentContent={currentContent}
            editorRef={editorRef}
            onContentChange={handleContentChange}
          />
        </div>
      )}
    </div>
  );
});

ResultsLexicalEditor.displayName = 'ResultsLexicalEditor';

export default ResultsLexicalEditor;