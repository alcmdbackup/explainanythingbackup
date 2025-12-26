/**
 * StreamingSyncPlugin
 *
 * Lexical plugin that synchronizes streaming content from the reducer to the editor.
 * Replaces the scattered debounce logic previously in results/page.tsx.
 *
 * Behavior:
 * - During streaming: Debounces updates with 100ms delay
 * - When not streaming: Updates immediately
 * - Skips duplicate content to avoid unnecessary renders
 */

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  preprocessCriticMarkup,
  replaceBrTagsWithNewlines,
  MARKDOWN_TRANSFORMERS
} from './importExportUtils';

interface StreamingSyncPluginProps {
  content: string;
  isStreaming: boolean;
}

export function StreamingSyncPlugin({
  content,
  isStreaming
}: StreamingSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<string>('');

  useEffect(() => {
    // Skip if content unchanged
    if (content === lastContentRef.current) return;

    // Cancel pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    const updateEditor = () => {
      editor.update(() => {
        // Same logic as setContentFromMarkdown
        const preprocessedMarkdown = preprocessCriticMarkup(content);
        $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS);
        replaceBrTagsWithNewlines();
      });
      lastContentRef.current = content;
    };

    if (isStreaming) {
      // Debounce during streaming (100ms)
      debounceTimeoutRef.current = setTimeout(updateEditor, 100);
    } else {
      // Immediate update when not streaming
      updateEditor();
    }

    // Cleanup on unmount or before next effect
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, [content, isStreaming, editor]);

  return null;
}

export default StreamingSyncPlugin;
