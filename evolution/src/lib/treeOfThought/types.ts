// Type definitions for tree-of-thought beam search revision strategy.
// Defines the tree structure, revision actions, and search results used by TreeSearchAgent.

/** A node in the revision tree. Each node corresponds to a TextVariation in the pool. */
export interface TreeNode {
  id: string;
  variantId: string;
  parentNodeId: string | null;
  childNodeIds: string[];
  depth: number;
  revisionAction: RevisionAction;
  /** Evaluation score (OpenSkill mu from mini-tournament). */
  value: number;
  /** Whether this branch was abandoned during beam selection. */
  pruned: boolean;
}

/** The type of revision applied to create a child node. */
export type RevisionActionType =
  | 'edit_dimension'
  | 'structural_transform'
  | 'lexical_simplify'
  | 'grounding_enhance'
  | 'creative';

/** Describes the revision applied to create a child node from its parent. */
export interface RevisionAction {
  type: RevisionActionType;
  /** For edit_dimension: the critique dimension targeted (clarity, structure, etc.). */
  dimension?: string;
  /** Human-readable description of the revision action. */
  description: string;
}

/** Summary result of a completed tree search. */
export interface TreeSearchResult {
  bestLeafNodeId: string;
  bestVariantId: string;
  /** Ordered root → best leaf revision actions. */
  revisionPath: RevisionAction[];
  treeSize: number;
  maxDepth: number;
  prunedBranches: number;
}

/** Full tree state: all nodes keyed by node ID. Record (not Map) for JSON serialization safety. */
export interface TreeState {
  nodes: Record<string, TreeNode>;
  rootNodeId: string;
}

/** Configuration for beam search. */
export interface BeamSearchConfig {
  /** Number of active candidates to keep at each depth (default: 3). */
  beamWidth: number;
  /** Number of revisions to generate per candidate (default: 3). */
  branchingFactor: number;
  /** Maximum tree depth (default: 3). */
  maxDepth: number;
}

export const DEFAULT_BEAM_SEARCH_CONFIG: BeamSearchConfig = {
  beamWidth: 3,
  branchingFactor: 3,
  maxDepth: 3,
};
