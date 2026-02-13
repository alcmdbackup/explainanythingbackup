// Tree construction and traversal utilities for the revision tree.
// Provides typed accessors over Record-based TreeState for building and querying the search tree.

import { v4 as uuidv4 } from 'uuid';
import type { TreeNode, TreeState, RevisionAction } from './types';

/** Get a node by ID with type safety. Returns undefined if not found. */
export function getNode(state: TreeState, id: string): TreeNode | undefined {
  return state.nodes[id];
}

/** Add a node to tree state. Mutates state in place. */
export function addNode(state: TreeState, node: TreeNode): void {
  state.nodes[node.id] = node;
  if (node.parentNodeId) {
    const parent = state.nodes[node.parentNodeId];
    if (parent && !parent.childNodeIds.includes(node.id)) {
      parent.childNodeIds.push(node.id);
    }
  }
}

/** Create a root node for the tree from an existing variant. */
export function createRootNode(variantId: string): { node: TreeNode; state: TreeState } {
  const node: TreeNode = {
    id: uuidv4(),
    variantId,
    parentNodeId: null,
    childNodeIds: [],
    depth: 0,
    revisionAction: { type: 'edit_dimension', description: 'root' },
    value: 0,
    pruned: false,
  };
  const state: TreeState = {
    nodes: { [node.id]: node },
    rootNodeId: node.id,
  };
  return { node, state };
}

/** Create a child node from a parent with a given revision action and variant. */
export function createChildNode(
  parentNodeId: string,
  variantId: string,
  action: RevisionAction,
  state: TreeState,
): TreeNode {
  const parent = state.nodes[parentNodeId];
  if (!parent) throw new Error(`Parent node ${parentNodeId} not found in tree`);

  const node: TreeNode = {
    id: uuidv4(),
    variantId,
    parentNodeId,
    childNodeIds: [],
    depth: parent.depth + 1,
    revisionAction: action,
    value: 0,
    pruned: false,
  };
  addNode(state, node);
  return node;
}

/** Get ordered ancestor chain from root to the given node (inclusive). */
export function getAncestors(state: TreeState, nodeId: string): TreeNode[] {
  const ancestors: TreeNode[] = [];
  let current: TreeNode | undefined = state.nodes[nodeId];
  while (current) {
    ancestors.unshift(current);
    current = current.parentNodeId ? state.nodes[current.parentNodeId] : undefined;
  }
  return ancestors;
}

/** Get the revision path (sequence of RevisionActions) from root to a node. */
export function getPath(state: TreeState, nodeId: string): RevisionAction[] {
  const ancestors = getAncestors(state, nodeId);
  // Skip root's action (it's just a placeholder)
  return ancestors.slice(1).map((n) => n.revisionAction);
}

/** Find the best (highest value) unpruned leaf node. */
export function getBestLeaf(state: TreeState): TreeNode | null {
  let best: TreeNode | null = null;
  for (const node of Object.values(state.nodes)) {
    if (node.pruned) continue;
    const isLeaf = node.childNodeIds.length === 0;
    if (isLeaf && (best === null || node.value > best.value)) {
      best = node;
    }
  }
  return best;
}

/** Mark a node and all its descendants as pruned. Returns count of newly pruned nodes. */
export function pruneSubtree(state: TreeState, nodeId: string): number {
  let count = 0;
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = state.nodes[id];
    if (!node || node.pruned) continue;
    node.pruned = true;
    count++;
    stack.push(...node.childNodeIds);
  }
  return count;
}
