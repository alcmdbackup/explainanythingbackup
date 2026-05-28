// Unit tests for subagentTreeParser — covers the per-detailType parsers and the
// dispatch façade. Locks in the JSONB → SubagentNode[] shape for both the UI
// (Phase 2) and the metric backfill (Phase 3) since they share this module.

import {
  parseGenerateFromPreviousArticleTree,
  parseReflectAndGenerateTree,
  parseEvaluateCriteriaThenGenerateTree,
  parseProposerApproverCriteriaTree,
  parseIterativeEditingTree,
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
