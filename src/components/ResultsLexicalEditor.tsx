'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
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
    <LexicalEditor
      ref={editorRef}
      placeholder="Content will appear here..."
      className={className}
      initialContent={content}
      isMarkdownMode={true}
      isEditMode={internalEditMode && !isStreaming}
      showEditorState={false}
      showTreeView={false}
      showToolbar={true}
      hideEditingUI={isStreaming}
      onContentChange={handleContentChange}
    />
  );
});

ResultsLexicalEditor.displayName = 'ResultsLexicalEditor';

export default ResultsLexicalEditor;