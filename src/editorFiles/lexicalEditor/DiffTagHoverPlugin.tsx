import { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { DiffTagNodeInline, DiffTagNodeBlock } from './DiffTagNode';
import DiffTagInlineControls from './DiffTagInlineControls';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';

// Store only nodeKey -> diffType mapping (not element references which can become stale)
type DiffTagType = 'ins' | 'del' | 'update';

export default function DiffTagHoverPlugin() {
  const [editor] = useLexicalComposerContext();
  const [activeDiffKeys, setActiveDiffKeys] = useState<Map<string, DiffTagType>>(new Map());

  // Scan for all diff tag elements in the editor
  const scanForDiffTags = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const newDiffKeys = new Map<string, DiffTagType>();

    // Find all elements with data-diff-key attribute
    const diffElements = rootElement.querySelectorAll('[data-diff-key]');
    diffElements.forEach((element) => {
      const nodeKey = element.getAttribute('data-diff-key');
      const diffType = element.getAttribute('data-diff-type') as DiffTagType;

      if (nodeKey && diffType) {
        newDiffKeys.set(nodeKey, diffType);
      }
    });

    setActiveDiffKeys(newDiffKeys);
  }, [editor]);

  useEffect(() => {
    // Initial scan
    scanForDiffTags();

    // Register mutation listeners for both inline and block diff tags
    const removeMutationListener = editor.registerMutationListener(DiffTagNodeInline, () => {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(scanForDiffTags);
    });

    const removeBlockMutationListener = editor.registerMutationListener(DiffTagNodeBlock, () => {
      requestAnimationFrame(scanForDiffTags);
    });

    // Also listen to general editor updates for cleanup
    const removeUpdateListener = editor.registerUpdateListener(() => {
      requestAnimationFrame(scanForDiffTags);
    });

    return () => {
      removeMutationListener();
      removeBlockMutationListener();
      removeUpdateListener();
    };
  }, [editor, scanForDiffTags]);

  // Use the extracted accept/reject functions from diffTagMutations.ts
  const handleAccept = useCallback((nodeKey: string) => {
    acceptDiffTag(editor, nodeKey);
  }, [editor]);

  const handleReject = useCallback((nodeKey: string) => {
    rejectDiffTag(editor, nodeKey);
  }, [editor]);

  // Re-query elements fresh on each render to avoid stale references
  const rootElement = editor.getRootElement();

  return (
    <>
      {Array.from(activeDiffKeys.entries()).map(([nodeKey, diffTag]) => {
        // Query element fresh each time to avoid stale references
        const element = rootElement?.querySelector(`[data-diff-key="${nodeKey}"]`) as HTMLElement | null;
        if (!element) return null;

        return (
          <DiffTagInlineControls
            key={nodeKey}
            targetElement={element}
            nodeKey={nodeKey}
            diffTagType={diffTag}
            onAccept={() => handleAccept(nodeKey)}
            onReject={() => handleReject(nodeKey)}
          />
        );
      })}
    </>
  );
}
