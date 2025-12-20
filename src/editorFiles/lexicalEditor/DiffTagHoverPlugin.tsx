import { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { DiffTagNodeInline, DiffTagNodeBlock, $isDiffTagNodeInline, $isDiffTagNodeBlock, $isDiffUpdateContainerInline } from './DiffTagNode';
import DiffTagInlineControls from './DiffTagInlineControls';
import { $getNodeByKey } from 'lexical';

interface DiffTagState {
  element: HTMLElement;
  nodeKey: string;
  diffTag: 'ins' | 'del' | 'update';
}

export default function DiffTagHoverPlugin() {
  const [editor] = useLexicalComposerContext();
  const [activeDiffTags, setActiveDiffTags] = useState<Map<string, DiffTagState>>(new Map());

  // Scan for all diff tag elements in the editor
  const scanForDiffTags = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const newDiffTags = new Map<string, DiffTagState>();

    // Find all elements with data-diff-key attribute
    const diffElements = rootElement.querySelectorAll('[data-diff-key]');
    diffElements.forEach((element) => {
      const nodeKey = element.getAttribute('data-diff-key');
      const diffType = element.getAttribute('data-diff-type') as 'ins' | 'del' | 'update';

      if (nodeKey && diffType) {
        newDiffTags.set(nodeKey, {
          element: element as HTMLElement,
          nodeKey,
          diffTag: diffType
        });
      }
    });

    setActiveDiffTags(newDiffTags);
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

  const handleAccept = useCallback((nodeKey: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
        const tag = (node as DiffTagNodeInline | DiffTagNodeBlock).__tag;

        if (tag === 'ins') {
          // Accept insertion: keep content, remove diff tag
          const children = node.getChildren();
          children.forEach(child => {
            node.insertBefore(child);
          });
          node.remove();
        } else if (tag === 'del') {
          // Accept deletion: remove the entire node
          node.remove();
        } else if (tag === 'update') {
          // Accept update: keep the second child (after text), remove first child and diff tag
          const children = node.getChildren();
          if (children.length >= 2) {
            const afterContent = children[1];

            if ($isDiffUpdateContainerInline(afterContent)) {
              const containerChildren = afterContent.getChildren();
              containerChildren.forEach(child => {
                node.insertBefore(child);
              });
            } else {
              node.insertBefore(afterContent);
            }
          }
          node.remove();
        }
      }
    });
  }, [editor]);

  const handleReject = useCallback((nodeKey: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
        const tag = (node as DiffTagNodeInline | DiffTagNodeBlock).__tag;

        if (tag === 'ins') {
          // Reject insertion: remove the entire node
          node.remove();
        } else if (tag === 'del') {
          // Reject deletion: keep content, remove diff tag
          const children = node.getChildren();
          children.forEach(child => {
            node.insertBefore(child);
          });
          node.remove();
        } else if (tag === 'update') {
          // Reject update: keep the first child (before text), remove second child and diff tag
          const children = node.getChildren();
          if (children.length >= 1) {
            const beforeContent = children[0];

            if ($isDiffUpdateContainerInline(beforeContent)) {
              const containerChildren = beforeContent.getChildren();
              containerChildren.forEach(child => {
                node.insertBefore(child);
              });
            } else {
              node.insertBefore(beforeContent);
            }
          }
          node.remove();
        }
      }
    });
  }, [editor]);

  return (
    <>
      {Array.from(activeDiffTags.values()).map(({ element, nodeKey, diffTag }) => (
        <DiffTagInlineControls
          key={nodeKey}
          targetElement={element}
          nodeKey={nodeKey}
          diffTagType={diffTag}
          onAccept={() => handleAccept(nodeKey)}
          onReject={() => handleReject(nodeKey)}
        />
      ))}
    </>
  );
}
