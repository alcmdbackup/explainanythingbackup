// Unit tests for parseParagraphRecombineWithCoherencePassTree (Phase 6 addition).

import {
  parseParagraphRecombineWithCoherencePassTree,
  parseSubagentTreeByAgentName,
} from './subagentTreeParser';

describe('parseParagraphRecombineWithCoherencePassTree', () => {
  it('returns empty tree on null detail', () => {
    expect(parseParagraphRecombineWithCoherencePassTree(null)).toEqual([]);
  });

  it('returns slot tree only when coherencePass field is absent', () => {
    const detail = {
      slots: [
        {
          slotIndex: 0,
          originalText: 'p1',
          originalSlotVariantId: 'u1',
          slotTopicId: 't1',
          perSlotBudgetUsd: 0.01,
          spentUsd: 0.002,
          rewrites: [],
        },
      ],
      recombined: { text: 'p1', formatValid: true },
      totalCost: 0.002,
    };
    const tree = parseParagraphRecombineWithCoherencePassTree(detail);
    // Slot tree + recombine deterministic node (no coherence_pass node).
    expect(tree.find((n) => n.name === 'slot.0')).toBeDefined();
    expect(tree.find((n) => n.name === 'recombine')).toBeDefined();
    expect(tree.find((n) => n.name === 'coherence_pass')).toBeUndefined();
  });

  it('appends coherence_pass leaf with skip reason when skipped', () => {
    const detail = {
      slots: [],
      recombined: { text: '', formatValid: true },
      totalCost: 0,
      coherencePass: { skipped: 'disabled' },
    };
    const tree = parseParagraphRecombineWithCoherencePassTree(detail);
    const cpNode = tree.find((n) => n.name === 'coherence_pass');
    expect(cpNode).toBeDefined();
    expect(cpNode?.kind).toBe('Deterministic');
    expect(cpNode?.summary).toContain('skipped');
    expect(cpNode?.summary).toContain('disabled');
  });

  it('builds coherence_pass composite with cycle children when cycles[] populated', () => {
    const detail = {
      slots: [],
      recombined: { text: '', formatValid: true },
      totalCost: 0.005,
      coherencePass: {
        cycles: [
          {
            cycleNumber: 1,
            proposedMarkup: '...markup...',
            proposedGroupsRaw: [],
            droppedPreApprover: [],
            approverGroups: [{ groupNumber: 1, atomicEdits: [] }],
            reviewDecisions: [{ groupNumber: 1, decision: 'accept', reason: 'ok' }],
            droppedPostApprover: [],
            appliedGroups: [{ groupNumber: 1, atomicEdits: [] }],
            acceptedCount: 1,
            rejectedCount: 0,
            appliedCount: 1,
            formatValid: true,
            parentText: 'parent',
            childText: 'child',
            proposeCostUsd: 0.002,
            approveCostUsd: 0.001,
            sizeRatio: 1.01,
          },
        ],
      },
    };
    const tree = parseParagraphRecombineWithCoherencePassTree(detail);
    const cpNode = tree.find((n) => n.name === 'coherence_pass');
    expect(cpNode).toBeDefined();
    expect(cpNode?.kind).toBe('Composite');
    // Cycle children should include propose + review + apply L3 nodes (via parseIterativeEditingTree).
    const cycleChild = cpNode?.children.find((c) => c.name.startsWith('cycle.'));
    expect(cycleChild).toBeDefined();
    expect(cycleChild?.children.length).toBeGreaterThanOrEqual(2); // propose + review at minimum
  });
});

describe('parseSubagentTreeByAgentName dispatch', () => {
  it('routes paragraph_recombine_with_coherence_pass to the new parser', () => {
    const detail = {
      slots: [],
      recombined: { text: '', formatValid: true },
      totalCost: 0,
      coherencePass: { skipped: 'budget' },
    };
    const tree = parseSubagentTreeByAgentName('paragraph_recombine_with_coherence_pass', detail);
    expect(tree.find((n) => n.name === 'coherence_pass')).toBeDefined();
  });
});
