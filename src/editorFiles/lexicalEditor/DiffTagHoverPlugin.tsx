import { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { DiffTagNodeInline, DiffTagNodeBlock, $isDiffTagNodeInline, $isDiffTagNodeBlock, $isDiffUpdateContainerInline } from './DiffTagNode';
import DiffTagHoverControls from './DiffTagHoverControls';
import { $getNodeByKey } from 'lexical';

interface HoverState {
  isVisible: boolean;
  targetElement: HTMLElement | null;
  nodeKey: string | null;
  diffTag: 'ins' | 'del' | 'update' | null;
}

export default function DiffTagHoverPlugin() {
  console.log('🏁 DiffTagHoverPlugin: Component initializing');
  const [editor] = useLexicalComposerContext();
  const [hoverState, setHoverState] = useState<HoverState>({
    isVisible: false,
    targetElement: null,
    nodeKey: null,
    diffTag: null
  });

  console.log('🏁 DiffTagHoverPlugin: Current hover state:', hoverState);

  useEffect(() => {
    console.log('🚀 DiffTagHoverPlugin: Starting to register mutation listeners');
    console.log('🚀 DiffTagHoverPlugin: Editor instance:', editor);
    const registeredElements = new WeakSet();

    // Log initial editor state
    editor.getEditorState().read(() => {
      const root = editor.getRootElement();
      console.log('🚀 DiffTagHoverPlugin: Root element:', root);
      console.log('🚀 DiffTagHoverPlugin: Editor state keys:', editor.getEditorState()._nodeMap.size);
    });

    const removeMutationListener = editor.registerMutationListener(DiffTagNodeInline, (mutations) => {
      console.log('🔍 DiffTagHoverPlugin: DiffTagNodeInline mutations detected:', mutations.size);
      console.log('🔍 DiffTagHoverPlugin: Mutation details:', Array.from(mutations.entries()));
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutations) {
          console.log('🔍 DiffTagHoverPlugin: Processing mutation for key:', key, 'type:', mutation);
          const element = editor.getElementByKey(key);
          console.log('🔍 DiffTagHoverPlugin: Element for key:', element);

          if ((mutation === 'created' || mutation === 'updated') &&
              element !== null &&
              !registeredElements.has(element)) {
            console.log('🎯 DiffTagHoverPlugin: Adding hover listeners to element', key, mutation);
            console.log('🎯 DiffTagHoverPlugin: Element details:', {
              tagName: element.tagName,
              className: element.className,
              textContent: element.textContent?.substring(0, 50)
            });
            registeredElements.add(element);

            // Add mouseenter event
            element.addEventListener('mouseenter', (event) => {
              console.log('🖱️ DiffTagHoverPlugin: Mouse entered diff tag element', key);
              console.log('🖱️ DiffTagHoverPlugin: Event target:', event.target);
              console.log('🖱️ DiffTagHoverPlugin: Current element:', event.currentTarget);

              // Get the diff tag type from the node
              editor.getEditorState().read(() => {
                const node = $getNodeByKey(key);
                console.log('🖱️ DiffTagHoverPlugin: Node for key:', node);
                console.log('🖱️ DiffTagHoverPlugin: Node type check - inline:', $isDiffTagNodeInline(node), 'block:', $isDiffTagNodeBlock(node));

                if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
                  const diffTag = (node as DiffTagNodeInline | DiffTagNodeBlock).__tag;
                  console.log('📝 DiffTagHoverPlugin: Setting hover state for', diffTag);
                  console.log('📝 DiffTagHoverPlugin: Previous hover state:', hoverState);

                  setHoverState({
                    isVisible: true,
                    targetElement: element,
                    nodeKey: key,
                    diffTag: diffTag
                  });

                  console.log('📝 DiffTagHoverPlugin: New hover state set');
                } else {
                  console.log('❌ DiffTagHoverPlugin: Node is not a diff tag node');
                }
              });
            });

            // Note: mouseleave will be handled by the DiffTagHoverControls component
          }
        }
      });
    });

    // Also register for block-level diff tags
    const removeBlockMutationListener = editor.registerMutationListener(DiffTagNodeBlock, (mutations) => {
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutations) {
          const element = editor.getElementByKey(key);
          if ((mutation === 'created' || mutation === 'updated') &&
              element !== null &&
              !registeredElements.has(element)) {
            console.log('🎯 DiffTagHoverPlugin: Adding hover listeners to element', key, mutation);
            registeredElements.add(element);

            // Add mouseenter event
            element.addEventListener('mouseenter', (event) => {
              console.log('🖱️ DiffTagHoverPlugin: Mouse entered diff tag element', key);
              console.log('🖱️ DiffTagHoverPlugin: Event target:', event.target);
              console.log('🖱️ DiffTagHoverPlugin: Current element:', event.currentTarget);

              // Get the diff tag type from the node
              editor.getEditorState().read(() => {
                const node = $getNodeByKey(key);
                console.log('🖱️ DiffTagHoverPlugin: Node for key:', node);
                console.log('🖱️ DiffTagHoverPlugin: Node type check - inline:', $isDiffTagNodeInline(node), 'block:', $isDiffTagNodeBlock(node));

                if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
                  const diffTag = (node as DiffTagNodeInline | DiffTagNodeBlock).__tag;
                  console.log('📝 DiffTagHoverPlugin: Setting hover state for', diffTag);
                  console.log('📝 DiffTagHoverPlugin: Previous hover state:', hoverState);

                  setHoverState({
                    isVisible: true,
                    targetElement: element,
                    nodeKey: key,
                    diffTag: diffTag
                  });

                  console.log('📝 DiffTagHoverPlugin: New hover state set');
                } else {
                  console.log('❌ DiffTagHoverPlugin: Node is not a diff tag node');
                }
              });
            });

            // Note: mouseleave will be handled by the DiffTagHoverControls component
          }
        }
      });
    });

    return () => {
      removeMutationListener();
      removeBlockMutationListener();
    };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAccept = () => {
    if (!hoverState.nodeKey) return;

    editor.update(() => {
      const node = $getNodeByKey(hoverState.nodeKey!);
      if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
        // For 'ins' nodes, keep the content and remove the diff tag
        // For 'del' nodes, remove the entire node and its content
        // For 'update' nodes, keep the second child (after content) and remove the first child (before content)

        if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'ins') {
          // Accept insertion: keep content, remove diff tag
          const children = node.getChildren();
          children.forEach(child => {
            node.insertBefore(child);
          });
          node.remove();
        } else if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'del') {
          // Accept deletion: remove the entire node
          node.remove();
        } else if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'update') {
          // Accept update: keep the second child (after text), remove first child and diff tag
          const children = node.getChildren();
          if (children.length >= 2) {
            const afterContent = children[1];

            // If afterContent is a DiffUpdateContainerInline, extract its children
            // and insert them directly before the diff tag node, then remove the container
            if ($isDiffUpdateContainerInline(afterContent)) {
              const containerChildren = afterContent.getChildren();
              containerChildren.forEach(child => {
                node.insertBefore(child);
              });
            } else {
              // Fallback: insert the afterContent as-is
              node.insertBefore(afterContent);
            }
          }
          node.remove();
        }
      }
    });

    setHoverState(prev => ({ ...prev, isVisible: false }));
  };

  const handleReject = () => {
    if (!hoverState.nodeKey) return;

    editor.update(() => {
      const node = $getNodeByKey(hoverState.nodeKey!);
      if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
        // For 'ins' nodes, remove the entire node
        // For 'del' nodes, keep the content and remove the diff tag
        // For 'update' nodes, keep the first child (before content) and remove the second child (after content)

        if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'ins') {
          // Reject insertion: remove the entire node
          node.remove();
        } else if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'del') {
          // Reject deletion: keep content, remove diff tag
          const children = node.getChildren();
          children.forEach(child => {
            node.insertBefore(child);
          });
          node.remove();
        } else if ((node as DiffTagNodeInline | DiffTagNodeBlock).__tag === 'update') {
          // Reject update: keep the first child (before text), remove second child and diff tag
          const children = node.getChildren();
          if (children.length >= 1) {
            const beforeContent = children[0];

            // If beforeContent is a DiffUpdateContainerInline, extract its children
            // and insert them directly before the diff tag node, then remove the container
            if ($isDiffUpdateContainerInline(beforeContent)) {
              const containerChildren = beforeContent.getChildren();
              containerChildren.forEach(child => {
                node.insertBefore(child);
              });
            } else {
              // Fallback: insert the beforeContent as-is
              node.insertBefore(beforeContent);
            }
          }
          node.remove();
        }
      }
    });

    setHoverState({ isVisible: false, targetElement: null, nodeKey: null, diffTag: null });
  };

  const handleClose = () => {
    setHoverState({ isVisible: false, targetElement: null, nodeKey: null, diffTag: null });
  };

  console.log('🎨 DiffTagHoverPlugin render:', {
    isVisible: hoverState.isVisible,
    hasTargetElement: !!hoverState.targetElement,
    diffTag: hoverState.diffTag,
    nodeKey: hoverState.nodeKey
  });

  return (
    <>
      {hoverState.isVisible && hoverState.targetElement && hoverState.diffTag && (
        <DiffTagHoverControls
          targetElement={hoverState.targetElement}
          diffTagType={hoverState.diffTag}
          onAccept={handleAccept}
          onReject={handleReject}
          onClose={handleClose}
        />
      )}
    </>
  );
}