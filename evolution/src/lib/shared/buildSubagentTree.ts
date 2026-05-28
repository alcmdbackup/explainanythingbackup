// Subagent-tree façade: dispatches an invocation row + its execution_detail to the
// appropriate parser in subagentTreeParser.ts. Returns the L2+ tree; the L1 root
// (the agent itself) is constructed by the UI from the invocation row's own fields.
//
// rename_agents_subagents_evolution_20260508 — Phase 2.

import {
  type SubagentNode,
  parseSubagentTreeByAgentName,
  sumCostUsd,
  sumDurationMs,
  sumLlmCallCount,
} from './subagentTreeParser';

/** Minimal invocation shape needed to build the tree. */
export interface InvocationForTree {
  id: string;
  agent_name: string;
  cost_usd: number | null;
  duration_ms: number | null;
  execution_detail: Record<string, unknown> | null;
}

/**
 * Build the full subagent tree for one invocation. The returned tree's root is the
 * invocation itself (L1, kind: 'Composite'); its children are L2 subagents derived
 * from the agent's execution_detail JSONB shape.
 */
export function buildSubagentTree(invocation: InvocationForTree): SubagentNode {
  const children = parseSubagentTreeByAgentName(invocation.agent_name, invocation.execution_detail);
  const sumChildCost = sumCostUsd(children);
  const sumChildDuration = sumDurationMs(children);
  const sumChildLlmCalls = sumLlmCallCount(children);

  // L1 root: use invocation row's own cost_usd/duration_ms as authoritative, but also
  // expose the recursive-sum from children so the UI can flag mismatches.
  return {
    name: invocation.agent_name,
    path: [invocation.agent_name],
    level: 1,
    kind: 'Composite',
    durationMs: invocation.duration_ms ?? sumChildDuration,
    costUsd: invocation.cost_usd ?? sumChildCost,
    llmCallCount: sumChildLlmCalls,
    children,
  };
}

/**
 * Validate that an L1 row's totals match the recursive sum of its children.
 * Returns null when in tolerance, otherwise a description of the mismatch.
 * Tolerance: 1e-4 USD / 1ms — handles floating-point rounding.
 */
export function validateTreeTotals(root: SubagentNode): { mismatch: string } | null {
  const childCost = sumCostUsd(root.children);
  const childDuration = sumDurationMs(root.children);
  const costDelta = Math.abs(root.costUsd - childCost);
  const durationDelta = Math.abs(root.durationMs - childDuration);
  if (costDelta > 1e-4) {
    return { mismatch: `cost: L1=${root.costUsd.toFixed(6)} vs sum(children)=${childCost.toFixed(6)} (delta ${costDelta.toFixed(6)})` };
  }
  if (durationDelta > 1) {
    return { mismatch: `duration_ms: L1=${root.durationMs} vs sum(children)=${childDuration} (delta ${durationDelta})` };
  }
  return null;
}

export type { SubagentNode } from './subagentTreeParser';
