import { useRef, useEffect, useState, useCallback } from 'react';
import { LexicalEditorRef } from '../editorFiles/lexicalEditor/LexicalEditor';

interface UseStreamingEditorProps {
  content: string;
  isEditMode: boolean;
  isStreaming?: boolean;
  onContentChange?: (content: string) => void;
}

/**
 * Hook to manage LexicalEditor with streaming support
 *
 * Provides:
 * - Debounced content updates during streaming
 * - Edit mode filtering to prevent callbacks during initial load
 * - Smart content synchronization
 * - Protection against overwriting user edits
 */
export function useStreamingEditor({
  content,
  isEditMode,
  isStreaming = false,
  onContentChange
}: UseStreamingEditorProps) {
  const editorRef = useRef<LexicalEditorRef>(null);
  const [currentContent, setCurrentContent] = useState(content);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamingUpdateRef = useRef<string>('');
  const isInitialLoadRef = useRef<boolean>(true);
  const isMountedRef = useRef<boolean>(false);

  // Mark as mounted after first render to avoid race conditions
  useEffect(() => {
    isMountedRef.current = true;
  }, []);

  // Lock editor during streaming to prevent conflicts
  useEffect(() => {
    if (isStreaming && editorRef.current) {
      editorRef.current.setEditMode(false);
    } else if (!isStreaming && editorRef.current) {
      editorRef.current.setEditMode(isEditMode);
    }
  }, [isStreaming, isEditMode]);

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
    console.log('🔍 isMountedRef.current:', isMountedRef.current);

    // Skip content updates until after component has mounted
    if (!isMountedRef.current) {
      console.log('⚠️ Skipping content update - component not yet mounted');
      return;
    }

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
  }, [content, currentContent, isStreaming, isEditMode, debouncedUpdateContent]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Handle content changes from editor
  const handleContentChange = useCallback((newContent: string) => {
    console.log('🔄 useStreamingEditor.handleContentChange called');
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
  }, [isEditMode, onContentChange]);

  return {
    editorRef,
    handleContentChange
  };
}
