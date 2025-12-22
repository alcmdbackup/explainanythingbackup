/**
 * Extracted accept/reject logic for DiffTagNodes
 * Enables testing of editor mutations without component context
 */

import { LexicalEditor, $getNodeByKey } from 'lexical';
import {
  DiffTagNodeInline,
  DiffTagNodeBlock,
  $isDiffTagNodeInline,
  $isDiffTagNodeBlock,
  $isDiffUpdateContainerInline,
} from './DiffTagNode';

/**
 * Accept a diff tag node, applying its changes to the document
 *
 * - ins: Keep the inserted content, remove the diff wrapper
 * - del: Remove the entire node (accept the deletion)
 * - update: Keep the "after" content (second child), remove the rest
 */
export function acceptDiffTag(editor: LexicalEditor, nodeKey: string): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
      const tag = (node as DiffTagNodeInline | DiffTagNodeBlock).__tag;

      if (tag === 'ins') {
        // Accept insertion: keep content, remove diff tag
        const children = node.getChildren();
        children.forEach((child) => {
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
            containerChildren.forEach((child) => {
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
}

/**
 * Reject a diff tag node, reverting its changes
 *
 * - ins: Remove the entire node (reject the insertion)
 * - del: Keep the deleted content, remove the diff wrapper
 * - update: Keep the "before" content (first child), remove the rest
 */
export function rejectDiffTag(editor: LexicalEditor, nodeKey: string): void {
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
        children.forEach((child) => {
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
            containerChildren.forEach((child) => {
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
}
