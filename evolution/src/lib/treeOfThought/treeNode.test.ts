// Unit tests for tree construction and traversal utilities.

import { createRootNode, createChildNode, getAncestors, getPath, getBestLeaf, pruneSubtree, getNode, addNode } from './treeNode';
import type { TreeNode, TreeState, RevisionAction } from './types';

const editAction: RevisionAction = { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' };
const structAction: RevisionAction = { type: 'structural_transform', description: 'Restructure' };
const creativeAction: RevisionAction = { type: 'creative', description: 'Rethink engagement' };

describe('treeNode utilities', () => {
  describe('createRootNode', () => {
    it('creates root with depth 0 and no parent', () => {
      const { node, state } = createRootNode('variant-1');
      expect(node.depth).toBe(0);
      expect(node.parentNodeId).toBeNull();
      expect(node.variantId).toBe('variant-1');
      expect(node.pruned).toBe(false);
      expect(node.childNodeIds).toEqual([]);
      expect(state.rootNodeId).toBe(node.id);
      expect(state.nodes[node.id]).toBe(node);
    });

    it('generates unique IDs across calls', () => {
      const r1 = createRootNode('v1');
      const r2 = createRootNode('v2');
      expect(r1.node.id).not.toBe(r2.node.id);
    });
  });

  describe('createChildNode', () => {
    it('creates child with correct depth and parent reference', () => {
      const { node: root, state } = createRootNode('root-v');
      const child = createChildNode(root.id, 'child-v', editAction, state);
      expect(child.depth).toBe(1);
      expect(child.parentNodeId).toBe(root.id);
      expect(child.variantId).toBe('child-v');
      expect(child.revisionAction).toEqual(editAction);
      expect(root.childNodeIds).toContain(child.id);
    });

    it('creates grandchild at depth 2', () => {
      const { node: root, state } = createRootNode('root-v');
      const child = createChildNode(root.id, 'child-v', editAction, state);
      const grandchild = createChildNode(child.id, 'grand-v', structAction, state);
      expect(grandchild.depth).toBe(2);
      expect(grandchild.parentNodeId).toBe(child.id);
    });

    it('throws when parent not found', () => {
      const { state } = createRootNode('root-v');
      expect(() => createChildNode('nonexistent', 'v', editAction, state)).toThrow('Parent node nonexistent not found');
    });

    it('registers child in tree state', () => {
      const { node: root, state } = createRootNode('root-v');
      const child = createChildNode(root.id, 'child-v', editAction, state);
      expect(state.nodes[child.id]).toBe(child);
    });
  });

  describe('getNode and addNode', () => {
    it('getNode returns node by ID', () => {
      const { node: root, state } = createRootNode('v');
      expect(getNode(state, root.id)).toBe(root);
    });

    it('getNode returns undefined for missing ID', () => {
      const { state } = createRootNode('v');
      expect(getNode(state, 'missing')).toBeUndefined();
    });

    it('addNode updates parent childNodeIds', () => {
      const { node: root, state } = createRootNode('v');
      const child: TreeNode = {
        id: 'manual-child',
        variantId: 'cv',
        parentNodeId: root.id,
        childNodeIds: [],
        depth: 1,
        revisionAction: editAction,
        value: 0,
        pruned: false,
      };
      addNode(state, child);
      expect(root.childNodeIds).toContain('manual-child');
      expect(state.nodes['manual-child']).toBe(child);
    });
  });

  describe('getAncestors', () => {
    it('returns only root for root node', () => {
      const { node: root, state } = createRootNode('v');
      const ancestors = getAncestors(state, root.id);
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]).toBe(root);
    });

    it('returns root→child→grandchild in order', () => {
      const { node: root, state } = createRootNode('rv');
      const child = createChildNode(root.id, 'cv', editAction, state);
      const grandchild = createChildNode(child.id, 'gv', structAction, state);
      const ancestors = getAncestors(state, grandchild.id);
      expect(ancestors.map((n) => n.id)).toEqual([root.id, child.id, grandchild.id]);
    });

    it('returns empty for non-existent node', () => {
      const { state } = createRootNode('v');
      expect(getAncestors(state, 'missing')).toEqual([]);
    });
  });

  describe('getPath', () => {
    it('returns empty path for root', () => {
      const { node: root, state } = createRootNode('v');
      expect(getPath(state, root.id)).toEqual([]);
    });

    it('returns revision actions from root to leaf (excluding root)', () => {
      const { node: root, state } = createRootNode('rv');
      const child = createChildNode(root.id, 'cv', editAction, state);
      const grandchild = createChildNode(child.id, 'gv', creativeAction, state);
      const path = getPath(state, grandchild.id);
      expect(path).toHaveLength(2);
      expect(path[0]).toEqual(editAction);
      expect(path[1]).toEqual(creativeAction);
    });
  });

  describe('getBestLeaf', () => {
    it('returns root when it is the only unpruned leaf', () => {
      const { node: root, state } = createRootNode('v');
      expect(getBestLeaf(state)).toBe(root);
    });

    it('returns highest-value unpruned leaf', () => {
      const { node: root, state } = createRootNode('rv');
      const c1 = createChildNode(root.id, 'c1v', editAction, state);
      const c2 = createChildNode(root.id, 'c2v', structAction, state);
      c1.value = 5;
      c2.value = 10;
      expect(getBestLeaf(state)).toBe(c2);
    });

    it('skips pruned nodes', () => {
      const { node: root, state } = createRootNode('rv');
      const c1 = createChildNode(root.id, 'c1v', editAction, state);
      const c2 = createChildNode(root.id, 'c2v', structAction, state);
      c1.value = 100;
      c1.pruned = true;
      c2.value = 5;
      expect(getBestLeaf(state)).toBe(c2);
    });

    it('returns null when all nodes are pruned', () => {
      const { node: root, state } = createRootNode('rv');
      root.pruned = true;
      expect(getBestLeaf(state)).toBeNull();
    });

    it('does not return non-leaf nodes', () => {
      const { node: root, state } = createRootNode('rv');
      root.value = 100;
      const child = createChildNode(root.id, 'cv', editAction, state);
      child.value = 1;
      // root has children so it's not a leaf
      expect(getBestLeaf(state)).toBe(child);
    });
  });

  describe('pruneSubtree', () => {
    it('prunes a single node', () => {
      const { node: root, state } = createRootNode('rv');
      const child = createChildNode(root.id, 'cv', editAction, state);
      const count = pruneSubtree(state, child.id);
      expect(count).toBe(1);
      expect(child.pruned).toBe(true);
    });

    it('prunes entire subtree recursively', () => {
      const { node: root, state } = createRootNode('rv');
      const child = createChildNode(root.id, 'cv', editAction, state);
      const gc1 = createChildNode(child.id, 'gc1v', structAction, state);
      const gc2 = createChildNode(child.id, 'gc2v', creativeAction, state);
      const count = pruneSubtree(state, child.id);
      expect(count).toBe(3);
      expect(child.pruned).toBe(true);
      expect(gc1.pruned).toBe(true);
      expect(gc2.pruned).toBe(true);
    });

    it('does not prune already-pruned nodes', () => {
      const { node: root, state } = createRootNode('rv');
      const child = createChildNode(root.id, 'cv', editAction, state);
      child.pruned = true;
      const count = pruneSubtree(state, child.id);
      expect(count).toBe(0);
    });

    it('does not affect sibling branches', () => {
      const { node: root, state } = createRootNode('rv');
      const c1 = createChildNode(root.id, 'c1v', editAction, state);
      const c2 = createChildNode(root.id, 'c2v', structAction, state);
      pruneSubtree(state, c1.id);
      expect(c1.pruned).toBe(true);
      expect(c2.pruned).toBe(false);
      expect(root.pruned).toBe(false);
    });
  });

  describe('Record-based TreeState serialization', () => {
    it('round-trips through JSON', () => {
      const { node: root, state } = createRootNode('rv');
      createChildNode(root.id, 'cv', editAction, state);

      const json = JSON.stringify(state);
      const restored: TreeState = JSON.parse(json);

      expect(restored.rootNodeId).toBe(state.rootNodeId);
      expect(Object.keys(restored.nodes)).toHaveLength(2);
      expect(restored.nodes[root.id].variantId).toBe('rv');
    });
  });
});
