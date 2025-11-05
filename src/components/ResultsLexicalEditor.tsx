'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import LexicalEditor, { LexicalEditorRef } from '../editorFiles/lexicalEditor/LexicalEditor';

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
  const isInitialLoadRef = useRef<boolean>(true);

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

          // After first content update, mark as no longer initial load
          if (isInitialLoadRef.current) {
            // For streaming, use setTimeout to avoid interfering with content callbacks
            setTimeout(() => {
              isInitialLoadRef.current = false;
            }, 0);
          }
        } catch (error) {
          console.error('Error updating editor content during streaming:', error);
        }
      }
    }, isStreaming ? 100 : 0); // Use 100ms debounce for streaming, immediate for non-streaming
  }, [isStreaming]);

  // Update editor content when content prop changes (streaming updates)
  useEffect(() => {
    console.log('🔄 useEffect triggered - content comparison');
    console.log('🔍 content length:', content?.length || 'undefined');
    console.log('🔍 currentContent length:', currentContent?.length || 'undefined');
    console.log('🔍 content !== currentContent:', content !== currentContent);
    console.log('🔍 isEditMode:', isEditMode);

    if (content !== currentContent) {
      // IMPORTANT: Don't overwrite editor content during edit mode
      // This prevents AI suggestions from being destroyed
      if (isEditMode && !isStreaming) {
        console.log('⚠️ Skipping content update - editor is in edit mode');
        return;
      }

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

      // After first content update, mark as no longer initial load
      if (isInitialLoadRef.current) {
        console.log('🏁 About to clear isInitialLoadRef, isStreaming:', isStreaming);
        // For non-streaming updates, mark immediately to avoid filtering real user edits
        if (!isStreaming) {
          console.log('🏁 Setting isInitialLoadRef.current = false immediately (non-streaming)');
          isInitialLoadRef.current = false;
        } else {
          console.log('🏁 Setting isInitialLoadRef.current = false via setTimeout (streaming)');
          // Use setTimeout for streaming to ensure this runs after the content change callback
          setTimeout(() => {
            console.log('🏁 setTimeout executed: setting isInitialLoadRef.current = false');
            isInitialLoadRef.current = false;
          }, 0);
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


  // Handle content changes from editor
  const handleContentChange = (newContent: string) => {
    console.log('🔄 ResultsLexicalEditor.handleContentChange called');
    console.log('📝 newContent type:', typeof newContent);
    console.log('📝 newContent length:', newContent?.length || 'undefined');
    console.log('🎛️ isEditMode:', isEditMode);
    console.log('🏁 isInitialLoadRef.current:', isInitialLoadRef.current);
    console.log('🔗 onContentChange exists:', !!onContentChange);

    // Clear initial load flag on first user edit (when in edit mode)
    if (isEditMode && isInitialLoadRef.current) {
      console.log('🏁 Clearing isInitialLoadRef.current on user edit');
      isInitialLoadRef.current = false;
    }

    const shouldCall = isEditMode && !isInitialLoadRef.current;
    console.log('🤔 shouldCall parent:', shouldCall);

    // Only call onContentChange if user is in edit mode and this is not initial load
    if (shouldCall) {
      console.log('✅ About to call parent onContentChange');
      onContentChange?.(newContent);
      console.log('✅ Called parent onContentChange');
    } else {
      console.log('❌ NOT calling parent onContentChange because:');
      if (!isEditMode) console.log('  - Not in edit mode (isEditMode = false)');
      if (isInitialLoadRef.current) console.log('  - Still in initial load (isInitialLoadRef.current = true)');
    }
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    updateContent: (newContent: string) => {
      console.log('🔧 ResultsLexicalEditor.updateContent called', {
        contentLength: newContent?.length || 0,
        hasEditorRef: !!editorRef.current,
        currentContentLength: currentContent?.length || 0,
        isEditMode,
        isStreaming,
        contentPreview: newContent?.substring(0, 150)
      });

      if (editorRef.current) {
        console.log('🔧 ResultsLexicalEditor: Calling editorRef.current.setContentFromMarkdown');
        // Update currentContent FIRST to prevent useEffect from overwriting
        setCurrentContent(newContent);
        editorRef.current.setContentFromMarkdown(newContent);
        console.log('🔧 ResultsLexicalEditor: setContentFromMarkdown completed, currentContent updated');
      } else {
        console.error('🔧 ResultsLexicalEditor: editorRef.current is null');
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