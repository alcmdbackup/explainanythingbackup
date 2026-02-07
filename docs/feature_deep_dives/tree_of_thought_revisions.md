# Tree of Thought Revisions

## Overview

The tree-of-thought revision strategy adds **beam search** to the evolution pipeline's COMPETITION phase. Instead of the IterativeEditingAgent's linear critique→edit→judge loop (one revision at a time), the TreeSearchAgent explores multiple revision strategies in parallel at each depth level, evaluates them via the existing comparison infrastructure, and prunes underperforming branches.

The approach is inspired by Tree-of-Thought prompting (Yao et al. 2023) adapted for prose quality improvement. Configuration: beam width K=3, branching factor B=3, max depth D=3 — generating up to 27 revision candidates per invocation, evaluating ~90 comparisons, at approximately $0.048 per run.

## How It Works

### Beam Search Algorithm

At each depth level (1 to D):

1. **Re-critique** each beam member (fresh dimension scores for already-modified text, depth ≥ 1)
2. **Generate** B revisions per beam member using diverse action types:
   - `edit_dimension` — target weakest critique dimension
   - `structural_transform` — reorganize document structure
   - `lexical_simplify` — simplify language and reduce complexity
   - `grounding_enhance` — add concrete examples and evidence
   - `creative` — rethink engagement hooks and framing
3. **Stage 1 (Parent-relative filter)**: Compare each candidate to its parent using `compareWithDiff()` for surgical edits or `compareWithBiasMitigation()` for broad revisions. Reject candidates that don't improve.
4. **Stage 2 (Sibling mini-tournament)**: Adjacent-pair pairwise comparisons among survivors using local OpenSkill ratings. Select top K candidates with ancestry diversity slot.
5. **Prune** non-selected candidates. Repeat at next depth.

### Beam Collapse Mitigation

Three mechanisms prevent beam slots from converging to similar variants:
- **Action-type diversity**: Each sibling must use a different `RevisionActionType`
- **Ancestry diversity slot**: Last beam position reserved for a different parent lineage
- **Pool injection rate limiting**: Only best leaf added to shared pool (1 variant per invocation)

### Error Handling

- **All-rejected**: If no candidates improve on parents, beam terminates early
- **Budget exhaustion**: Catches `BudgetExceededError` mid-beam, returns best result from completed depths
- **LLM failures**: `Promise.allSettled` handles partial failures gracefully; beam narrows naturally

## Pipeline Integration

- **Phase**: COMPETITION only (after ReflectionAgent, requires critiques)
- **Feature flag**: `evolution_tree_search_enabled` (default: `false`, opt-in)
- **Mutual exclusivity**: When enabled, IterativeEditingAgent is automatically disabled
- **Budget cap**: 10% of total ($0.50 at default $5.00), supports ~9 invocations
- **Root selection**: Highest μ with σ > convergence threshold (underexplored high-potential variants)

## Visualization

- **Lineage graph**: Winning tree path highlighted with gold edges, pruned branches shown as dashed/dimmed
- **Tree tab**: Dedicated visualization showing depth-layered tree with node detail panel, revision action labels on edges
- **Variant card**: Shows tree depth and revision action for tree-search-produced variants

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `beamWidth` | 3 | Active candidates per depth (K) |
| `branchingFactor` | 3 | Revisions per candidate (B) |
| `maxDepth` | 3 | Maximum tree depth (D) |
| `treeSearchEnabled` | false | Feature flag — opt-in |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/evolution/treeOfThought/types.ts` | TreeNode, RevisionAction, TreeSearchResult, TreeState, BeamSearchConfig |
| `src/lib/evolution/treeOfThought/treeNode.ts` | Tree construction/traversal: createRootNode, createChildNode, getAncestors, getPath, getBestLeaf, pruneSubtree |
| `src/lib/evolution/treeOfThought/beamSearch.ts` | Core beam search with hybrid two-stage evaluation, re-critique, budget handling |
| `src/lib/evolution/treeOfThought/revisionActions.ts` | Action selection from critiques (forced diversity), per-action-type prompt construction |
| `src/lib/evolution/treeOfThought/evaluator.ts` | Stage 1 (parent-relative filter), Stage 2 (sibling mini-tournament with local OpenSkill ratings) |
| `src/lib/evolution/treeOfThought/index.ts` | Barrel exports |
| `src/lib/evolution/agents/treeSearchAgent.ts` | AgentBase implementation: root selection, budget reservation, pool injection |
| `src/components/evolution/tabs/TreeTab.tsx` | Tree search visualization tab with D3 rendering |

## Testing

| Suite | Tests | Coverage |
|-------|-------|----------|
| `treeNode.test.ts` | 24 | Tree construction, path extraction, pruning, ancestor traversal |
| `revisionActions.test.ts` | 12 | Action selection, diversity enforcement, prompt construction |
| `evaluator.test.ts` | 13 | Parent-relative filtering, sibling tournament, ancestry diversity |
| `treeSearchAgent.test.ts` | 17 | canExecute guards, root selection, execute flow, cost estimation |
| `evolution-tree-search.integration.test.ts` | 8 | Real Supabase, checkpoint round-trip, backward compat |

## Related Documentation

- [Evolution Pipeline](./evolution_pipeline.md) — Agent framework, pipeline phases, budget system
- [Iterative Editing Agent](./iterative_editing_agent.md) — The linear editing approach that tree search extends
- [Comparison Infrastructure](./comparison_infrastructure.md) — Article bank and prompt bank comparison system
- [Pipeline Visualization](./evolution_pipeline_visualization.md) — Dashboard, timeline, Elo, lineage, budget tabs
