// Subagent tree parsers: derive a structured tree of sub-units of work from an
// invocation's execution_detail JSONB. Single source of truth consumed by both
// the UI tree builder (Phase 2, /admin/evolution/invocations/[id] Subagents tab)
// AND the metric backfill script (Phase 3, evolution/scripts/backfillSubagentMetrics.ts).
//
// One parser per detailType / agent_name. Each parser is pure: takes the JSONB
// blob + optional list of llmCallTracking rows, returns SubagentNode[].
//
// rename_agents_subagents_evolution_20260508 — Phase 2.

/** A node in the subagent tree. Recursive: children may have their own children. */
export interface SubagentNode {
  /** Last segment of the path (e.g. 'reflection', 'generation', 'comparison'). */
  name: string;
  /** Full dotted path from L1 root (e.g. ['reflection'], ['gfpa', 'ranking', 'comparison']). */
  path: string[];
  /** Tree depth — L1 = 1, L2 = 2, ... Computed from path.length. */
  level: number;
  /** Classification: LLM call, composite (has children), or deterministic step. */
  kind: 'LLM' | 'Composite' | 'Deterministic';
  /** Wall-clock duration in ms. 0 if not tracked. */
  durationMs: number;
  /** USD cost. 0 for deterministic / composite-only nodes. */
  costUsd: number;
  /** Number of LLM calls under this subtree (1 for LLM leaf, sum for Composite). */
  llmCallCount: number;
  /** Optional one-line summary surfaced next to the row label. */
  summary?: string;
  /** Children. Empty for LLM/Deterministic leaves. */
  children: SubagentNode[];
  /**
   * Optional bespoke detail panel slice — when present, the UI renders the existing
   * ConfigDrivenDetailRenderer with these keys. Preserves domain-specific tables
   * (criteriaScored, suggestions, forwardDecisions, mirrorDecisions, annotated-edits)
   * that a generic tree can't reproduce.
   */
  bespokeDetail?: {
    /** detailType key into DETAIL_VIEW_CONFIGS. */
    configKey: string;
    /** Subset of keys (dot-paths) to render from the agent's detailViewConfig. */
    keyFilter?: string[];
    /** Pre-sliced data passed to ConfigDrivenDetailRenderer. */
    data: unknown;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Extract a number safely from a possibly-malformed JSONB blob; returns 0 for non-finite. */
function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
}

/** Build an L2 child node. Helper to keep parsers concise. */
function makeChild(
  parentPath: string[],
  name: string,
  kind: SubagentNode['kind'],
  durationMs: number,
  costUsd: number,
  opts: { llmCallCount?: number; summary?: string; children?: SubagentNode[] } = {},
): SubagentNode {
  const path = [...parentPath, name];
  const children = opts.children ?? [];
  const llmCallCount = opts.llmCallCount ?? (kind === 'LLM' ? 1 : children.reduce((s, c) => s + c.llmCallCount, 0));
  return {
    name,
    path,
    level: path.length + 1, // L1 is the agent itself; first child is L2
    kind,
    durationMs,
    costUsd,
    llmCallCount,
    summary: opts.summary,
    children,
  };
}

// ─── Per-detailType parsers ──────────────────────────────────────

/**
 * `generate_from_previous_article` (the leaf agent type).
 * Tree: L1 GFPA → L2 generation, L2 ranking → L3 comparison × N
 */
export function parseGenerateFromPreviousArticleTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const generation = detail.generation as Record<string, unknown> | undefined;
  if (generation) {
    out.push(makeChild([], 'generation', 'LLM', num(generation.durationMs), num(generation.cost)));
  }
  const ranking = detail.ranking as Record<string, unknown> | undefined;
  if (ranking) {
    const comparisons = (ranking.comparisons as Array<Record<string, unknown>> | undefined) ?? [];
    const comparisonChildren: SubagentNode[] = comparisons.map((cmp, idx) =>
      makeChild(['ranking'], `comparison.${idx + 1}`, 'LLM', num(cmp.durationMs), num(cmp.cost), {
        summary: typeof cmp.outcome === 'string' ? cmp.outcome : undefined,
      }),
    );
    out.push(makeChild([], 'ranking', 'Composite', num(ranking.durationMs), num(ranking.cost), {
      children: comparisonChildren,
      summary: comparisons.length > 0 ? `${comparisons.length} comparisons` : undefined,
    }));
  }
  return out;
}

/**
 * `reflect_and_generate_from_previous_article` (wrapper, calls inner GFPA.execute()).
 * Tree: L1 wrapper → L2 reflection (LLM), L2 generate_from_previous_article (Composite) →
 *       L3 generation, L3 ranking → L4 comparison × N.
 */
export function parseReflectAndGenerateTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const reflection = detail.reflection as Record<string, unknown> | undefined;
  if (reflection) {
    out.push(makeChild([], 'reflection', 'LLM', num(reflection.durationMs), num(reflection.cost), {
      summary: typeof reflection.tacticChosen === 'string' ? `tactic: ${reflection.tacticChosen}` : undefined,
    }));
  }
  // Inner GFPA's generation + ranking land at the same level under a synthetic
  // composite node so the user sees the wrapper structure clearly.
  const innerChildren = parseGenerateFromPreviousArticleTree(detail);
  if (innerChildren.length > 0) {
    // Re-parent the inner children so their paths reflect the wrapper.
    const reparented = innerChildren.map((c) => reparent(c, ['generate_from_previous_article']));
    const innerCost = innerChildren.reduce((s, c) => s + c.costUsd, 0);
    const innerDuration = innerChildren.reduce((s, c) => s + c.durationMs, 0);
    out.push(makeChild([], 'generate_from_previous_article', 'Composite', innerDuration, innerCost, {
      children: reparented,
    }));
  }
  return out;
}

/**
 * `evaluate_criteria_then_generate_from_previous_article` (wrapper).
 * Tree: L1 wrapper → L2 evaluate_and_suggest (LLM), L2 generate_from_previous_article (Composite).
 */
export function parseEvaluateCriteriaThenGenerateTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const evalSuggest = detail.evaluateAndSuggest as Record<string, unknown> | undefined;
  if (evalSuggest) {
    const weakest = (detail.weakestCriteriaNames as string[] | undefined) ?? [];
    out.push(makeChild([], 'evaluate_and_suggest', 'LLM', num(evalSuggest.durationMs), num(evalSuggest.cost), {
      summary: weakest.length > 0 ? `weakest: ${weakest.slice(0, 3).join(', ')}` : undefined,
    }));
  }
  const innerChildren = parseGenerateFromPreviousArticleTree(detail);
  if (innerChildren.length > 0) {
    const reparented = innerChildren.map((c) => reparent(c, ['generate_from_previous_article']));
    const innerCost = innerChildren.reduce((s, c) => s + c.costUsd, 0);
    const innerDuration = innerChildren.reduce((s, c) => s + c.durationMs, 0);
    out.push(makeChild([], 'generate_from_previous_article', 'Composite', innerDuration, innerCost, {
      children: reparented,
    }));
  }
  return out;
}

/** `single_pass_evaluate_criteria_and_generate` — same shape as evaluate_criteria_then_generate. */
export function parseSinglePassEvaluateCriteriaTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  return parseEvaluateCriteriaThenGenerateTree(detail);
}

/**
 * `proposer_approver_criteria_generate` (quasi-wrapper).
 * Tree: L1 wrapper → L2 evaluate_and_suggest, L2 cycle.1 → L3 propose, L3 approve_forward,
 *       L3 approve_mirror (optional), L3 apply (Deterministic), L2 ranking → L3 comparison × N.
 */
export function parseProposerApproverCriteriaTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const evalSuggest = detail.evaluateAndSuggest as Record<string, unknown> | undefined;
  if (evalSuggest) {
    out.push(makeChild([], 'evaluate_and_suggest', 'LLM', num(evalSuggest.durationMs), num(evalSuggest.cost)));
  }
  const cycles = (detail.cycles as Array<Record<string, unknown>> | undefined) ?? [];
  cycles.forEach((cycle, idx) => {
    const cycleName = `cycle.${idx + 1}`;
    const cycleChildren: SubagentNode[] = [];
    const cyclePath = [cycleName];
    const proposeCost = num(cycle.proposeCostUsd);
    if (proposeCost > 0 || cycle.proposedMarkup !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'propose', 'LLM', 0, proposeCost));
    }
    const approveForwardCost = num(cycle.approveForwardCostUsd);
    if (approveForwardCost > 0 || cycle.forwardDecisions !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'approve_forward', 'LLM', 0, approveForwardCost));
    }
    const approveMirrorCost = num(cycle.approveMirrorCostUsd);
    if (approveMirrorCost > 0 || cycle.mirrorDecisions !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'approve_mirror', 'LLM', 0, approveMirrorCost));
    }
    if (cycle.appliedGroups !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'apply', 'Deterministic', 0, 0, {
        summary: typeof cycle.appliedCount === 'number' ? `applied: ${cycle.appliedCount}` : undefined,
      }));
    }
    out.push(makeChild([], cycleName, 'Composite', 0,
      proposeCost + approveForwardCost + approveMirrorCost,
      { children: cycleChildren },
    ));
  });
  // Final ranking
  const ranking = detail.ranking as Record<string, unknown> | undefined;
  if (ranking) {
    const comparisons = (ranking.comparisons as Array<Record<string, unknown>> | undefined) ?? [];
    const comparisonChildren = comparisons.map((cmp, idx) =>
      makeChild(['ranking'], `comparison.${idx + 1}`, 'LLM', num(cmp.durationMs), num(cmp.cost)),
    );
    out.push(makeChild([], 'ranking', 'Composite', num(ranking.durationMs), num(ranking.cost), {
      children: comparisonChildren,
      summary: comparisons.length > 0 ? `${comparisons.length} comparisons` : undefined,
    }));
  }
  return out;
}

/**
 * `iterative_editing` (quasi-wrapper, multi-cycle).
 * Tree: L1 wrapper → L2 cycle.1, L2 cycle.2, ... → L3 propose, L3 review, L3 apply, L3 drift_recovery (optional)
 *                  → L2 ranking (final variant only) → L3 comparison × N.
 */
export function parseIterativeEditingTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const cycles = (detail.cycles as Array<Record<string, unknown>> | undefined) ?? [];
  cycles.forEach((cycle, idx) => {
    const cycleName = `cycle.${idx + 1}`;
    const cyclePath = [cycleName];
    const cycleChildren: SubagentNode[] = [];
    const proposeCost = num(cycle.proposeCostUsd);
    if (proposeCost > 0 || cycle.proposedMarkup !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'propose', 'LLM', 0, proposeCost));
    }
    const driftRecovery = cycle.driftRecovery as Record<string, unknown> | undefined;
    const driftCost = num(cycle.driftRecoveryCostUsd);
    if (driftRecovery !== undefined || driftCost > 0) {
      cycleChildren.push(makeChild(cyclePath, 'drift_recovery', 'LLM', 0, driftCost, {
        summary: typeof driftRecovery?.outcome === 'string' ? driftRecovery.outcome : undefined,
      }));
    }
    const approveCost = num(cycle.approveCostUsd);
    if (approveCost > 0 || cycle.approverGroups !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'review', 'LLM', 0, approveCost));
    }
    if (cycle.appliedGroups !== undefined) {
      cycleChildren.push(makeChild(cyclePath, 'apply', 'Deterministic', 0, 0, {
        summary: typeof cycle.appliedCount === 'number' ? `applied: ${cycle.appliedCount}` : undefined,
      }));
    }
    out.push(makeChild([], cycleName, 'Composite', 0,
      proposeCost + driftCost + approveCost,
      { children: cycleChildren },
    ));
  });
  // Final ranking
  const ranking = detail.ranking as Record<string, unknown> | undefined;
  if (ranking) {
    const comparisons = (ranking.comparisons as Array<Record<string, unknown>> | undefined) ?? [];
    const comparisonChildren = comparisons.map((cmp, idx) =>
      makeChild(['ranking'], `comparison.${idx + 1}`, 'LLM', num(cmp.durationMs), num(cmp.cost)),
    );
    out.push(makeChild([], 'ranking', 'Composite', num(ranking.durationMs), num(ranking.cost), {
      children: comparisonChildren,
      summary: comparisons.length > 0 ? `${comparisons.length} comparisons (final)` : undefined,
    }));
  }
  return out;
}

/** `swiss_ranking` — leaf agent. Tree: pairs as L2. */
export function parseSwissRankingTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const matches = (detail.matches as Array<Record<string, unknown>> | undefined) ?? [];
  return matches.map((m, idx) =>
    makeChild([], `pair.${idx + 1}`, 'LLM', num(m.durationMs), num(m.cost)),
  );
}

/** `merge_ratings` — leaf, deterministic, no LLM cost. */
export function parseMergeRatingsTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const matchCount = typeof detail.totalMatches === 'number' ? detail.totalMatches : 0;
  return [makeChild([], 'merge', 'Deterministic', 0, 0, {
    summary: matchCount > 0 ? `${matchCount} matches merged` : undefined,
  })];
}

/** `create_seed_article` — Tree: seed_title (LLM), seed_article (LLM), ranking (Composite). */
export function parseCreateSeedArticleTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const out: SubagentNode[] = [];
  const seedTitle = detail.seedTitle as Record<string, unknown> | undefined;
  if (seedTitle) {
    out.push(makeChild([], 'seed_title', 'LLM', num(seedTitle.durationMs), num(seedTitle.cost)));
  }
  const seedArticle = detail.seedArticle as Record<string, unknown> | undefined;
  if (seedArticle) {
    out.push(makeChild([], 'seed_article', 'LLM', num(seedArticle.durationMs), num(seedArticle.cost)));
  }
  const ranking = detail.ranking as Record<string, unknown> | undefined;
  if (ranking) {
    out.push(makeChild([], 'ranking', 'Composite', num(ranking.durationMs), num(ranking.cost)));
  }
  return out;
}

// ─── Façade dispatch ─────────────────────────────────────────────

/**
 * Single dispatch point: takes an invocation's agent_name + execution_detail JSONB,
 * returns the L2+ subagent tree for that invocation.
 *
 * Unknown agent names return an empty array — caller renders a leaf-only tree.
 */
export function parseSubagentTreeByAgentName(
  agentName: string,
  detail: Record<string, unknown> | null | undefined,
): SubagentNode[] {
  switch (agentName) {
    case 'generate_from_previous_article':
      return parseGenerateFromPreviousArticleTree(detail);
    case 'reflect_and_generate_from_previous_article':
      return parseReflectAndGenerateTree(detail);
    case 'evaluate_criteria_then_generate_from_previous_article':
      return parseEvaluateCriteriaThenGenerateTree(detail);
    case 'single_pass_evaluate_criteria_and_generate':
      return parseSinglePassEvaluateCriteriaTree(detail);
    case 'proposer_approver_criteria_generate':
      return parseProposerApproverCriteriaTree(detail);
    case 'iterative_editing':
      return parseIterativeEditingTree(detail);
    case 'swiss_ranking':
      return parseSwissRankingTree(detail);
    case 'merge_ratings':
      return parseMergeRatingsTree(detail);
    case 'create_seed_article':
      return parseCreateSeedArticleTree(detail);
    default:
      return [];
  }
}

// ─── Internal helpers ────────────────────────────────────────────

/** Recursively prepend a path prefix to a subtree. */
function reparent(node: SubagentNode, prefix: string[]): SubagentNode {
  const newPath = [...prefix, ...node.path];
  return {
    ...node,
    path: newPath,
    level: newPath.length + 1,
    children: node.children.map((c) => reparent(c, prefix)),
  };
}

/**
 * Recursive sum of cost across a subtree (for render-time validation: an L1 row's totals
 * should equal the recursive sum of its children).
 */
export function sumCostUsd(nodes: SubagentNode[]): number {
  return nodes.reduce((s, n) => s + n.costUsd + sumCostUsd(n.children), 0);
}

/** Recursive sum of duration across a subtree. */
export function sumDurationMs(nodes: SubagentNode[]): number {
  return nodes.reduce((s, n) => s + n.durationMs + sumDurationMs(n.children), 0);
}

/** Recursive sum of llmCallCount across a subtree. */
export function sumLlmCallCount(nodes: SubagentNode[]): number {
  return nodes.reduce((s, n) => s + (n.children.length > 0 ? sumLlmCallCount(n.children) : n.llmCallCount), 0);
}
