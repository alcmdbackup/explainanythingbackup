// Unit tests for subagentTreeParser — covers the per-detailType parsers and the
// dispatch façade. Locks in the JSONB → SubagentNode[] shape for both the UI
// (Phase 2) and the metric backfill (Phase 3) since they share this module.

import {
  parseGenerateFromPreviousArticleTree,
  parseReflectAndGenerateTree,
  parseEvaluateCriteriaThenGenerateTree,
  parseProposerApproverCriteriaTree,
  parseIterativeEditingTree,
  parseParagraphRecombineTree,
  parseSubagentTreeByAgentName,
  sumCostUsd,
  sumDurationMs,
} from './subagentTreeParser';

describe('parseGenerateFromPreviousArticleTree', () => {
  it('returns generation + ranking children with comparison grandchildren', () => {
    const detail = {
      generation: { cost: 0.022, durationMs: 9000 },
      ranking: {
        cost: 0.011,
        durationMs: 4200,
        comparisons: [
          { round: 1, opponentId: 'a', outcome: 'win', durationMs: 800, cost: 0.0022 },
          { round: 2, opponentId: 'b', outcome: 'loss', durationMs: 900, cost: 0.0022 },
        ],
      },
    };
    const tree = parseGenerateFromPreviousArticleTree(detail);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.name).toBe('generation');
    expect(tree[0]!.kind).toBe('LLM');
    expect(tree[0]!.costUsd).toBeCloseTo(0.022);
    expect(tree[1]!.name).toBe('ranking');
    expect(tree[1]!.kind).toBe('Composite');
    expect(tree[1]!.children).toHaveLength(2);
    expect(tree[1]!.children[0]!.name).toBe('comparison.1');
    expect(tree[1]!.children[0]!.summary).toBe('win');
  });

  it('handles missing ranking gracefully (e.g. discarded variant)', () => {
    const tree = parseGenerateFromPreviousArticleTree({ generation: { cost: 0.02, durationMs: 8000 } });
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe('generation');
  });

  it('returns empty array for null detail', () => {
    expect(parseGenerateFromPreviousArticleTree(null)).toEqual([]);
    expect(parseGenerateFromPreviousArticleTree(undefined)).toEqual([]);
  });
});

describe('parseReflectAndGenerateTree', () => {
  it('returns reflection + generate_from_previous_article (composite) at L2', () => {
    const detail = {
      reflection: { cost: 0.003, durationMs: 1200, tacticChosen: 'engagement_amplify' },
      generation: { cost: 0.022, durationMs: 9000 },
      ranking: { cost: 0.011, durationMs: 4200, comparisons: [{ round: 1, durationMs: 800, cost: 0.0022 }] },
    };
    const tree = parseReflectAndGenerateTree(detail);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.name).toBe('reflection');
    expect(tree[0]!.kind).toBe('LLM');
    expect(tree[0]!.summary).toBe('tactic: engagement_amplify');
    expect(tree[1]!.name).toBe('generate_from_previous_article');
    expect(tree[1]!.kind).toBe('Composite');
    expect(tree[1]!.children).toHaveLength(2); // generation + ranking
    expect(tree[1]!.children[1]!.children[0]!.path).toEqual([
      'generate_from_previous_article', 'ranking', 'comparison.1',
    ]);
  });
});

describe('parseEvaluateCriteriaThenGenerateTree', () => {
  it('returns evaluate_and_suggest + generate_from_previous_article composite', () => {
    const detail = {
      weakestCriteriaNames: ['clarity', 'structure'],
      evaluateAndSuggest: { cost: 0.012, durationMs: 3200 },
      generation: { cost: 0.022, durationMs: 9000 },
      ranking: { cost: 0.011, durationMs: 4200, comparisons: [] },
    };
    const tree = parseEvaluateCriteriaThenGenerateTree(detail);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.name).toBe('evaluate_and_suggest');
    expect(tree[0]!.summary).toBe('weakest: clarity, structure');
    expect(tree[1]!.name).toBe('generate_from_previous_article');
  });
});

describe('parseProposerApproverCriteriaTree', () => {
  it('returns evaluate_and_suggest + cycle.1 composite + ranking', () => {
    const detail = {
      evaluateAndSuggest: { cost: 0.012, durationMs: 3200 },
      cycles: [{
        proposeCostUsd: 0.024,
        approveForwardCostUsd: 0.014,
        approveMirrorCostUsd: 0.014,
        proposedMarkup: '...',
        forwardDecisions: [],
        mirrorDecisions: [],
        appliedGroups: [],
        appliedCount: 2,
      }],
      ranking: { cost: 0.022, durationMs: 7000, comparisons: [] },
    };
    const tree = parseProposerApproverCriteriaTree(detail);
    expect(tree).toHaveLength(3);
    expect(tree[0]!.name).toBe('evaluate_and_suggest');
    expect(tree[1]!.name).toBe('cycle.1');
    expect(tree[1]!.kind).toBe('Composite');
    const cycleChildren = tree[1]!.children;
    expect(cycleChildren.map((c) => c.name)).toEqual(['propose', 'approve_forward', 'approve_mirror', 'apply']);
    expect(cycleChildren.find((c) => c.name === 'apply')!.kind).toBe('Deterministic');
    expect(cycleChildren.find((c) => c.name === 'apply')!.summary).toBe('applied: 2');
    expect(tree[2]!.name).toBe('ranking');
  });
});

describe('parseIterativeEditingTree', () => {
  it('returns one cycle.N composite per cycle, plus ranking', () => {
    const detail = {
      cycles: [
        { proposeCostUsd: 0.018, approveCostUsd: 0.006, appliedGroups: [], appliedCount: 3, proposedMarkup: '...' },
        { proposeCostUsd: 0.018, approveCostUsd: 0.006, driftRecoveryCostUsd: 0.001, driftRecovery: { outcome: 'recovered' }, appliedGroups: [], appliedCount: 1, proposedMarkup: '...' },
      ],
      ranking: { cost: 0.022, durationMs: 3200, comparisons: [{ round: 1, durationMs: 200 }] },
    };
    const tree = parseIterativeEditingTree(detail);
    expect(tree).toHaveLength(3); // cycle.1, cycle.2, ranking
    expect(tree[0]!.name).toBe('cycle.1');
    expect(tree[0]!.children.find((c) => c.name === 'drift_recovery')).toBeUndefined();
    const cycle2 = tree[1]!;
    expect(cycle2.children.find((c) => c.name === 'drift_recovery')?.summary).toBe('recovered');
  });
});

describe('parseSubagentTreeByAgentName (façade)', () => {
  it('dispatches by agent_name', () => {
    const detail = { generation: { cost: 0.02, durationMs: 8000 } };
    expect(parseSubagentTreeByAgentName('generate_from_previous_article', detail)).toHaveLength(1);
    expect(parseSubagentTreeByAgentName('unknown_agent', detail)).toEqual([]);
  });
});

describe('sum helpers', () => {
  it('sumCostUsd recursively sums across the tree', () => {
    const detail = {
      generation: { cost: 0.02, durationMs: 8000 },
      ranking: { cost: 0.01, durationMs: 4000, comparisons: [{ cost: 0.002 }, { cost: 0.002 }] },
    };
    const tree = parseGenerateFromPreviousArticleTree(detail);
    // generation 0.02 + ranking 0.01 + comparisons 0.002+0.002 = 0.034
    expect(sumCostUsd(tree)).toBeCloseTo(0.034);
  });

  it('sumDurationMs recursively sums', () => {
    const detail = {
      generation: { cost: 0.02, durationMs: 8000 },
      ranking: { cost: 0.01, durationMs: 4000, comparisons: [{ durationMs: 800 }] },
    };
    const tree = parseGenerateFromPreviousArticleTree(detail);
    expect(sumDurationMs(tree)).toBe(8000 + 4000 + 800);
  });
});

// Phase 9 retrofit R7a — parseParagraphRecombineTree.
// rank_individual_paragraphs_evolution_20260525.
describe('parseParagraphRecombineTree', () => {
  const happyDetail = {
    detailType: 'paragraph_recombine',
    parentVariantId: 'p0',
    slots: [
      {
        slotIndex: 0,
        originalText: 'Slot 0 original.',
        rewrites: [
          { index: 0, costUsd: 0.001, durationMs: 500, formatValid: true },
          { index: 1, costUsd: 0.002, durationMs: 700, formatValid: true },
          { index: 2, costUsd: 0.003, durationMs: 900, formatValid: true },
        ],
        ranking: { matchCount: 4, ratings: [], winnerSlotVariantId: 'v1', winnerIsOriginal: false },
      },
      {
        slotIndex: 1,
        originalText: 'Slot 1 original.',
        rewrites: [
          { index: 0, costUsd: 0.001, durationMs: 600, formatValid: true },
        ],
        ranking: { matchCount: 2, ratings: [], winnerSlotVariantId: 'v2', winnerIsOriginal: true },
      },
      {
        slotIndex: 2,
        originalText: 'Slot 2 original.',
        rewrites: [],
        discardReason: { failurePoint: 'slot_budget' },
      },
    ],
    recombined: { text: 'recombined', formatValid: true },
    totalCost: 0.007,
  };

  it('returns L2 slot composites + L2 recombine deterministic node', () => {
    const tree = parseParagraphRecombineTree(happyDetail);
    // 3 slot composites + 1 recombine deterministic = 4 L2 nodes.
    expect(tree).toHaveLength(4);
    expect(tree.map((n) => n.name)).toEqual(['slot.0', 'slot.1', 'slot.2', 'recombine']);
    expect(tree[0]!.kind).toBe('Composite');
    expect(tree[3]!.kind).toBe('Deterministic');
    // slot.0 has 3 rewrites + 1 ranking = 4 L3 children.
    expect(tree[0]!.children).toHaveLength(4);
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['rewrite.0', 'rewrite.1', 'rewrite.2', 'ranking']);
  });

  it('returns empty array for null detail', () => {
    expect(parseParagraphRecombineTree(null)).toEqual([]);
    expect(parseParagraphRecombineTree(undefined)).toEqual([]);
  });

  it('marks self-aborted slot with "self-aborted (slot_budget)" summary', () => {
    const tree = parseParagraphRecombineTree(happyDetail);
    expect(tree[2]!.summary).toBe('self-aborted (slot_budget)');
    // Self-aborted slot has no ranking L3 child.
    expect(tree[2]!.children.map((c) => c.name)).not.toContain('ranking');
  });

  it('recombine deterministic summary counts replaced vs original-kept slots', () => {
    const tree = parseParagraphRecombineTree(happyDetail);
    // 1 of 3 slots replaced: slot.0 (winnerIsOriginal=false) replaced; slot.1 kept;
    // slot.2 self-aborted (no ranking).
    expect(tree[3]!.summary).toBe('1 of 3 slots replaced');
  });

  it('slot composite cost = sum of its rewrite L3 costs', () => {
    const tree = parseParagraphRecombineTree(happyDetail);
    // slot.0: 0.001 + 0.002 + 0.003 = 0.006
    expect(tree[0]!.costUsd).toBeCloseTo(0.006);
    expect(tree[0]!.durationMs).toBe(500 + 700 + 900);
    // ranking sub-composite carries 0 cost (per option-1 schema decision).
    const rankingNode = tree[0]!.children.find((c) => c.name === 'ranking');
    expect(rankingNode?.costUsd).toBe(0);
    expect(rankingNode?.summary).toBe('4 matches ranked');
  });
});

// Phase 9 retrofit R7a case 6 — dispatcher façade.
describe('parseSubagentTreeByAgentName (façade)', () => {
  it('dispatches paragraph_recombine to parseParagraphRecombineTree', () => {
    const detail = {
      detailType: 'paragraph_recombine',
      parentVariantId: 'p0',
      slots: [{ slotIndex: 0, originalText: 'x', rewrites: [], discardReason: { failurePoint: 'slot_budget' } }],
      recombined: { text: '', formatValid: true },
      totalCost: 0,
    };
    const tree = parseSubagentTreeByAgentName('paragraph_recombine', detail);
    expect(tree).toHaveLength(2); // 1 slot composite + 1 recombine deterministic.
    expect(tree[0]!.name).toBe('slot.0');
    expect(tree[1]!.name).toBe('recombine');
  });

  // Phase 9 retrofit R7a case 7 — try/catch fallback contract.
  it('parser error fallback returns empty array and logs warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    // Pass a malformed shape that will throw inside the parser (e.g., slots is not iterable).
    const malformed = { slots: { notAnArray: true } } as unknown as Record<string, unknown>;
    const tree = parseSubagentTreeByAgentName('paragraph_recombine', malformed);
    expect(tree).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/paragraph_recombine parser failed/);
    warnSpy.mockRestore();
  });
});
