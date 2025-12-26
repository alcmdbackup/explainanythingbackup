import { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $nodesOfType } from 'lexical';
import { DiffTagNodeInline, DiffTagNodeBlock } from './DiffTagNode';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';

interface DiffTagHoverPluginProps {
  /** Callback when pending AI suggestions change (true = suggestions exist) */
  onPendingSuggestionsChange?: (hasPendingSuggestions: boolean) => void;
}

/**
 * Simplified DiffTagHoverPlugin using event delegation
 *
 * Instead of tracking nodes in React state and using portals, this plugin:
 * 1. Uses a single click event listener on the editor root (event delegation)
 * 2. Reads Lexical state directly to count pending suggestions
 * 3. No DOM querying, no RAF calls, no synchronization issues
 */
export default function DiffTagHoverPlugin({ onPendingSuggestionsChange }: DiffTagHoverPluginProps = {}) {
  const [editor] = useLexicalComposerContext();
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);

  // Count diff tag nodes directly from Lexical state
  const updatePendingCount = useCallback(() => {
    editor.getEditorState().read(() => {
      const inlineNodes = $nodesOfType(DiffTagNodeInline);
      const blockNodes = $nodesOfType(DiffTagNodeBlock);
      const count = inlineNodes.length + blockNodes.length;
      setHasPendingSuggestions(count > 0);
    });
  }, [editor]);

  // Notify parent when pending suggestions change
  useEffect(() => {
    onPendingSuggestionsChange?.(hasPendingSuggestions);
  }, [hasPendingSuggestions, onPendingSuggestionsChange]);

  useEffect(() => {
    // Initial count
    updatePendingCount();

    // Listen for editor updates to track pending suggestions count
    const removeUpdateListener = editor.registerUpdateListener(() => {
      updatePendingCount();
    });

    // Event delegation: single click handler on editor root
    const rootElement = editor.getRootElement();
    if (!rootElement) return removeUpdateListener;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if clicked element is an accept/reject button
      const action = target.getAttribute('data-action');
      const nodeKey = target.getAttribute('data-node-key');

      if (!action || !nodeKey) return;

      // Prevent default behavior and stop propagation
      event.preventDefault();
      event.stopPropagation();

      if (action === 'accept') {
        acceptDiffTag(editor, nodeKey);
      } else if (action === 'reject') {
        rejectDiffTag(editor, nodeKey);
      }
    };

    rootElement.addEventListener('click', handleClick);

    return () => {
      removeUpdateListener();
      rootElement.removeEventListener('click', handleClick);
    };
  }, [editor, updatePendingCount]);

  // No React rendering needed - buttons are rendered in DiffTagNode.createDOM()
  return null;
}
