// Targeted test for the pure helpers inside backfillSubagentMetrics.ts.
// The script's main() reads env + creates a Supabase client at module load, so we
// test the parser dispatch + accumulator behavior via subagentTreeParser directly
// (the same module the script imports). This locks in idempotency expectations
// and the allowlist + comparison/cycle group-key logic that the backfill relies on.
//
// rename_agents_subagents_evolution_20260508 Phase 3.

import {
  parseSubagentTreeByAgentName,
  type SubagentNode,
} from '../src/lib/shared/subagentTreeParser';

const SUBAGENT_ALLOWLIST = new Set<string>([
  'reflection', 'generation', 'ranking', 'comparison',
  'evaluate_and_suggest',
  'cycle.propose', 'cycle.review', 'cycle.apply',
  'drift_recovery', 'approve_forward', 'approve_mirror',
  'seed_title', 'seed_article',
  'merge', 'pair',
]);

function accumulate(
  nodes: SubagentNode[],
  acc: Map<string, { cost: number; durationMs: number; count: number }>,
  parentName?: string,
): void {
  for (const node of nodes) {
    const groupKey = node.name.startsWith('comparison.') ? 'comparison'
      : node.name.startsWith('pair.') ? 'pair'
      : node.name.startsWith('cycle.') ? `cycle.${parentName ?? 'unknown'}`
      : parentName === 'cycle' ? `cycle.${node.name}`
      : node.name;
    if (SUBAGENT_ALLOWLIST.has(groupKey)) {
      const cur = acc.get(groupKey) ?? { cost: 0, durationMs: 0, count: 0 };
      cur.cost += Number.isFinite(node.costUsd) ? node.costUsd : 0;
      cur.durationMs += Number.isFinite(node.durationMs) ? node.durationMs : 0;
      cur.count += node.kind === 'LLM' ? 1 : 0;
      acc.set(groupKey, cur);
    }
    if (node.children.length > 0) {
      accumulate(
        node.children,
        acc,
        node.name.startsWith('cycle.') ? 'cycle' : node.name,
      );
    }
  }
}

describe('backfillSubagentMetrics — accumulator', () => {
  it('aggregates comparisons under "comparison" group across multiple instances', () => {
    const detail = {
      generation: { cost: 0.02, durationMs: 8000 },
      ranking: {
        cost: 0.01, durationMs: 4000,
        comparisons: [
          { cost: 0.002, durationMs: 800 },
          { cost: 0.002, durationMs: 800 },
          { cost: 0.002, durationMs: 800 },
        ],
      },
    };
    const tree = parseSubagentTreeByAgentName('generate_from_previous_article', detail);
    const acc = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc);
    expect(acc.get('comparison')).toEqual({
      cost: 0.006,
      durationMs: 2400,
      count: 3,
    });
    expect(acc.get('generation')).toEqual({ cost: 0.02, durationMs: 8000, count: 1 });
    expect(acc.get('ranking')!.cost).toBeCloseTo(0.01);
  });

  it('aggregates per-cycle propose/review/apply across multiple cycles', () => {
    const detail = {
      cycles: [
        { proposeCostUsd: 0.018, approveCostUsd: 0.006, appliedGroups: [], appliedCount: 3, proposedMarkup: '...' },
        { proposeCostUsd: 0.020, approveCostUsd: 0.007, appliedGroups: [], appliedCount: 2, proposedMarkup: '...' },
      ],
      ranking: { cost: 0.022, durationMs: 3200, comparisons: [] },
    };
    const tree = parseSubagentTreeByAgentName('iterative_editing', detail);
    const acc = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc);
    // Two cycles each propose + review, summed under cycle.propose / cycle.review.
    expect(acc.get('cycle.propose')!.cost).toBeCloseTo(0.038);
    expect(acc.get('cycle.review')!.cost).toBeCloseTo(0.013);
    expect(acc.get('ranking')).toBeDefined();
  });

  it('drops names not in the allowlist (idempotency / typo guard)', () => {
    const detail = {
      generation: { cost: 0.02, durationMs: 8000 },
      // Hypothetical typo'd subagent — parser would never emit this; this is a
      // belt-and-suspenders test that even if a parser bug emitted it, accumulate
      // would drop it.
    };
    const tree = parseSubagentTreeByAgentName('generate_from_previous_article', detail);
    // Inject a typo'd extra node to validate filter.
    const trojan: SubagentNode = {
      name: 'reflektion_typo',
      path: ['reflektion_typo'],
      level: 2,
      kind: 'LLM',
      durationMs: 100,
      costUsd: 0.001,
      llmCallCount: 1,
      children: [],
    };
    tree.push(trojan);
    const acc = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc);
    expect(acc.has('reflektion_typo')).toBe(false);
    expect(acc.has('generation')).toBe(true);
  });

  it('NaN/Infinity values are filtered (writeMetricMax would throw otherwise)', () => {
    const detail = {
      generation: { cost: NaN, durationMs: 8000 },
      ranking: { cost: Infinity, durationMs: 4000, comparisons: [] },
    };
    const tree = parseSubagentTreeByAgentName('generate_from_previous_article', detail);
    const acc = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc);
    // Parsers replace non-finite with 0 via the num() helper.
    expect(acc.get('generation')?.cost ?? 0).toBe(0);
    expect(acc.get('ranking')?.cost ?? 0).toBe(0);
  });

  it('re-running accumulate over the same tree is idempotent only with a fresh acc map', () => {
    // Real idempotency for the script comes from writeMetricMax (GREATEST-on-conflict).
    // accumulate itself is additive; this test pins that expectation so future
    // refactors don't accidentally make it additive AND idempotent.
    const detail = {
      generation: { cost: 0.02, durationMs: 8000 },
      ranking: { cost: 0.01, durationMs: 4000, comparisons: [] },
    };
    const tree = parseSubagentTreeByAgentName('generate_from_previous_article', detail);
    const acc1 = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc1);
    const acc2 = new Map<string, { cost: number; durationMs: number; count: number }>();
    accumulate(tree, acc2);
    accumulate(tree, acc2); // run twice into the same acc — additive
    expect(acc1.get('generation')!.cost).toBeCloseTo(0.02);
    expect(acc2.get('generation')!.cost).toBeCloseTo(0.04); // 2× because additive
  });
});
