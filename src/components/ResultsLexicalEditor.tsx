'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import LexicalEditor, { LexicalEditorRef, EditModeToggle } from '../editorFiles/lexicalEditor/LexicalEditor';

interface ResultsLexicalEditorProps {
  content: string;
  isEditMode: boolean;
  onEditModeToggle?: () => void;
  onContentChange?: (content: string) => void;
  isStreaming?: boolean;
  className?: string;
}

export interface ResultsLexicalEditorRef {
  updateContent: (content: string) => void;
  getContent: () => string;
  setReadOnly: (readOnly: boolean) => void;
}

const ResultsLexicalEditor = forwardRef<ResultsLexicalEditorRef, ResultsLexicalEditorProps>(({
  content,
  isEditMode,
  onEditModeToggle,
  onContentChange,
  isStreaming = false,
  className = ""
}, ref) => {
  const editorRef = useRef<LexicalEditorRef>(null);
  const [currentContent, setCurrentContent] = useState(content);
  const [internalEditMode, setInternalEditMode] = useState(isEditMode);

  // Lock editor during streaming to prevent conflicts
  useEffect(() => {
    if (isStreaming && editorRef.current) {
      editorRef.current.setEditMode(false);
    } else if (!isStreaming && editorRef.current) {
      editorRef.current.setEditMode(internalEditMode);
    }
  }, [isStreaming, internalEditMode]);

  // Update editor content when content prop changes (streaming updates)
  useEffect(() => {
    if (content !== currentContent && editorRef.current) {
      editorRef.current.setContentFromMarkdown(content);
      setCurrentContent(content);
    }
  }, [content, currentContent]);

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

  // Handle content changes from editor
  const handleContentChange = (newContent: string) => {
    setCurrentContent(newContent);
    onContentChange?.(newContent);
  };

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
    }
  }), []);

  return (
    <div className={className}>
      {/* Edit Mode Toggle */}
      <div className="mb-4 flex justify-end">
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
  );
});

ResultsLexicalEditor.displayName = 'ResultsLexicalEditor';

export default ResultsLexicalEditor;