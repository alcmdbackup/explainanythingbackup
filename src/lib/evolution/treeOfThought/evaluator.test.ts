// Unit tests for hybrid two-stage evaluation: parent-relative filtering and sibling mini-tournament.

import { filterByParentComparison, rankSurvivors } from './evaluator';
import type { EvalCandidate } from './evaluator';
import type { TreeNode, TreeState } from './types';
import type { DiffComparisonResult } from '../diffComparison';
import type { ComparisonResult } from '../comparison';

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 6)}`,
    variantId: `var-${Math.random().toString(36).slice(2, 6)}`,
    parentNodeId: null,
    childNodeIds: [],
    depth: 1,
    revisionAction: { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' },
    value: 0,
    pruned: false,
    ...overrides,
  };
}

function makeCandidate(nodeOverrides: Partial<TreeNode> = {}): EvalCandidate {
  return {
    node: makeNode(nodeOverrides),
    text: 'revised text',
    parentText: 'original text',
  };
}

function makeTreeState(nodes: TreeNode[]): TreeState {
  const record: Record<string, TreeNode> = {};
  for (const n of nodes) record[n.id] = n;
  return { nodes: record, rootNodeId: nodes[0]?.id ?? '' };
}

describe('filterByParentComparison', () => {
  it('accepts candidates with ACCEPT diff verdict', async () => {
    const candidate = makeCandidate();
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockResolvedValue({ verdict: 'ACCEPT', confidence: 1, changesFound: 3 });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(result.survivors).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects candidates with REJECT diff verdict', async () => {
    const candidate = makeCandidate();
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockResolvedValue({ verdict: 'REJECT', confidence: 1, changesFound: 3 });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(result.survivors).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects candidates with UNSURE diff verdict (conservative)', async () => {
    const candidate = makeCandidate();
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockResolvedValue({ verdict: 'UNSURE', confidence: 0, changesFound: 0 });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(result.survivors).toHaveLength(0);
  });

  it('uses pairwise comparison for structural_transform actions', async () => {
    const candidate = makeCandidate({
      revisionAction: { type: 'structural_transform', description: 'Restructure' },
    });
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>();
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>()
      .mockResolvedValue({ winner: 'B', confidence: 0.9, turns: 2 });

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(callDiff).not.toHaveBeenCalled();
    expect(callPairwise).toHaveBeenCalled();
    expect(result.survivors).toHaveLength(1);
  });

  it('uses pairwise for creative actions', async () => {
    const candidate = makeCandidate({
      revisionAction: { type: 'creative', description: 'Rethink' },
    });
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>();
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>()
      .mockResolvedValue({ winner: 'A', confidence: 0.8, turns: 2 }); // A = parent wins = reject

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(result.survivors).toHaveLength(0);
  });

  it('uses diff for lexical_simplify actions', async () => {
    const candidate = makeCandidate({
      revisionAction: { type: 'lexical_simplify', description: 'Simplify' },
    });
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockResolvedValue({ verdict: 'ACCEPT', confidence: 1, changesFound: 2 });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();

    const result = await filterByParentComparison([candidate], callDiff, callPairwise);
    expect(callDiff).toHaveBeenCalled();
    expect(callPairwise).not.toHaveBeenCalled();
    expect(result.survivors).toHaveLength(1);
  });

  it('handles empty candidates array', async () => {
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>();
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();
    const result = await filterByParentComparison([], callDiff, callPairwise);
    expect(result.survivors).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('handles Promise.allSettled partial failures', async () => {
    const c1 = makeCandidate();
    const c2 = makeCandidate();
    let callCount = 0;
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ verdict: 'ACCEPT' as const, confidence: 1, changesFound: 2 });
        return Promise.reject(new Error('network error'));
      });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>();

    const result = await filterByParentComparison([c1, c2], callDiff, callPairwise);
    // One survived, one failed (ignored)
    expect(result.survivors).toHaveLength(1);
  });

  it('falls back to pairwise when all results are UNSURE', async () => {
    const c1 = makeCandidate();
    const c2 = makeCandidate();
    const callDiff = jest.fn<Promise<DiffComparisonResult>, [string, string]>()
      .mockResolvedValue({ verdict: 'UNSURE', confidence: 0, changesFound: 0 });
    const callPairwise = jest.fn<Promise<ComparisonResult>, [string, string]>()
      .mockResolvedValue({ winner: 'B', confidence: 0.7, turns: 2 });

    const result = await filterByParentComparison([c1, c2], callDiff, callPairwise);
    expect(result.allUnsure).toBe(true);
    expect(callPairwise).toHaveBeenCalled();
    expect(result.survivors).toHaveLength(2);
  });
});

describe('rankSurvivors', () => {
  it('returns single survivor as-is', () => {
    const candidate = makeCandidate();
    const state = makeTreeState([candidate.node]);
    const result = rankSurvivors([candidate], state, 3, new Map());
    expect(result).toHaveLength(1);
  });

  it('returns all survivors when count <= beamWidth', () => {
    const candidates = [makeCandidate(), makeCandidate()];
    const state = makeTreeState(candidates.map((c) => c.node));
    const result = rankSurvivors(candidates, state, 3, new Map());
    expect(result).toHaveLength(2);
  });

  it('limits output to beamWidth', () => {
    const candidates = Array.from({ length: 5 }, () => makeCandidate());
    const state = makeTreeState(candidates.map((c) => c.node));

    // Create match results that establish a clear ranking
    const matchResults = new Map<string, Map<string, 'A' | 'B' | 'TIE'>>();
    for (let i = 0; i < candidates.length - 1; i++) {
      const aId = candidates[i].node.variantId;
      const bId = candidates[i + 1].node.variantId;
      if (!matchResults.has(aId)) matchResults.set(aId, new Map());
      if (!matchResults.has(bId)) matchResults.set(bId, new Map());
      matchResults.get(aId)!.set(bId, 'A');
      matchResults.get(bId)!.set(aId, 'B');
    }

    const result = rankSurvivors(candidates, state, 3, matchResults);
    expect(result).toHaveLength(3);
  });

  it('applies ancestry diversity slot', () => {
    // Create 4 candidates: 3 from parent A, 1 from parent B
    const parentA = makeNode({ id: 'parentA' });
    const parentB = makeNode({ id: 'parentB' });
    const candidates = [
      makeCandidate({ parentNodeId: 'parentA', id: 'c1' }),
      makeCandidate({ parentNodeId: 'parentA', id: 'c2' }),
      makeCandidate({ parentNodeId: 'parentA', id: 'c3' }),
      makeCandidate({ parentNodeId: 'parentB', id: 'c4' }),
    ];

    const allNodes = [parentA, parentB, ...candidates.map((c) => c.node)];
    const state = makeTreeState(allNodes);

    // Make parent-A candidates win all matches
    const matchResults = new Map<string, Map<string, 'A' | 'B' | 'TIE'>>();
    for (const c of candidates) {
      matchResults.set(c.node.variantId, new Map());
    }
    // c1 beats c4
    matchResults.get(candidates[0].node.variantId)!.set(candidates[3].node.variantId, 'A');
    matchResults.get(candidates[3].node.variantId)!.set(candidates[0].node.variantId, 'B');

    const result = rankSurvivors(candidates, state, 3, matchResults);
    expect(result).toHaveLength(3);

    // Last slot should be the diverse candidate from parentB
    const parentIds = result.map((c) => c.node.parentNodeId);
    expect(parentIds).toContain('parentB');
  });
});
