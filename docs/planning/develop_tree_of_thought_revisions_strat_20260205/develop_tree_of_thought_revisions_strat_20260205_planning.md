# Develop Tree of Thought Revisions Strategy Plan

## Background

The evolution pipeline iteratively improves article quality through a flat pool of text variants that compete via LLM-judged pairwise comparisons. Eight specialized agents generate, rank, critique, debate, and evolve variants across EXPANSION and COMPETITION phases. The current IterativeEditingAgent is the closest to tree search — it runs a sequential critique→edit→judge loop — but it explores only one revision dimension at a time with no branching or backtracking. Academic research on Tree-of-Thought prompting (Yao et al. 2023) and applied text refinement systems (SPaR, ReTreVal) demonstrates that branching exploration with evaluation-guided pruning consistently outperforms linear refinement, even when using cheaper models.

## Problem

The pipeline's linear editing approach leaves quality improvements on the table. When the IterativeEditingAgent picks "clarity" as the weakest dimension and generates one edit, it commits to that path — if the edit is rejected, it moves to the next dimension rather than trying a different clarity improvement. There's no way to explore multiple revision strategies in parallel, compare their outcomes, and select the best path. Additionally, when a revision *is* accepted, the pipeline has no mechanism to understand *why* it worked — there's no path attribution from original to final variant. A tree-of-thought approach would: (1) generate multiple revision branches at each decision point, (2) evaluate branches via the existing comparison infrastructure, (3) prune unpromising branches early to conserve budget, and (4) track the full revision path for interpretability.

## Options Considered

### Option A: Beam Search Agent (Recommended)
- **Approach**: Maintain top-K candidates at each depth level. At each step, generate B revisions per candidate (targeting different weak dimensions), evaluate all K×B candidates, keep top K, repeat for D depths.
- **Pros**: Simple to implement, parallelizable (all K×B revisions generated concurrently), predictable budget (K×B×D total calls), natural fit with existing `Promise.allSettled` patterns.
- **Cons**: No backtracking (pruned candidates are lost), beam collapse risk (mitigated via action-type diversity enforcement and ancestry diversity slots — see §1.2).
- **Budget**: K=3, B=3, D=3 → 27 generation calls (gpt-4.1-mini) + 6 re-critique calls at depth ≥1 (gpt-4.1-mini) + ~90 evaluation calls (gpt-4.1-nano for judging). Realistic cost for a ~2000-char article: generation ~$0.035 (27 calls × ~1300 tokens I/O at $0.40/$1.60 per 1M), re-critique ~$0.008 (6 calls × ~1300 tokens at gpt-4.1-mini), evaluation ~$0.005 (90 calls × ~700 tokens at $0.10/$0.40 per 1M) = **~$0.048 per invocation**. With 10% budget cap ($0.50 of $5.00), supports ~9 COMPETITION iterations comfortably.
- **Why recommended**: Simplest path to ship, predictable costs, reuses existing comparison infra, still a major upgrade from linear editing.

### Option B: MCTS (Monte Carlo Tree Search) Agent
- **Approach**: Build tree incrementally using UCB selection → expansion → evaluation → backpropagation. Each MCTS iteration selects the most promising unexplored node, expands it with one revision, evaluates the result, and updates ancestor values.
- **Pros**: Theoretically optimal explore/exploit balance, adapts to problem difficulty, UCB formula maps naturally to OpenSkill ordinal + sigma.
- **Cons**: Complex implementation (UCB tuning, backpropagation logic), sequential by nature (each iteration depends on previous), harder to parallelize, more LLM calls needed for convergence.
- **Budget**: 50-100 MCTS iterations typical → 50-100 generation + 50-100 evaluation calls. Still affordable but less predictable.

### Option C: Enhanced IterativeEditingAgent (DFS with branching)
- **Approach**: Modify existing IterativeEditingAgent to generate edits for top-3 weak dimensions in parallel instead of just the weakest, evaluate all 3, keep best 1-2.
- **Pros**: Minimal code change, extends proven agent, no new data structures needed.
- **Cons**: Still essentially depth-first (no true tree), limited exploration breadth, doesn't enable path reconstruction or tree visualization.

### Option D: Full Pipeline Replacement (Tree Phases)
- **Approach**: Replace EXPANSION/COMPETITION phases with Tree Construction → Tree Search → Path Extraction phases.
- **Pros**: Most theoretically powerful, section-level parallelism possible.
- **Cons**: Massive scope, high risk, breaks existing checkpoint/resume, requires rewriting supervisor logic.

**Decision**: Start with **Option A (Beam Search)** for Phase 1. If results are promising, evolve toward **Option B (MCTS)** in Phase 2. Option C is too incremental; Option D is too risky.

**Why beam search adds value beyond IterativeEditingAgent**: IterativeEditingAgent does depth-3 sequential search with re-critiquing — a strong baseline. Beam search adds three capabilities it lacks: (1) **width**: exploring 3 different revision strategies simultaneously at each depth vs. 1, so if "clarity" is the weakest dimension, the beam can try 3 different approaches to fixing clarity and pick the best; (2) **cross-dimension exploration**: different beam slots can target different dimensions in parallel (clarity + structure + engagement), whereas IterativeEditingAgent commits to one dimension per cycle; (3) **path attribution**: the tree structure records exactly which sequence of actions led to the best result, enabling future prompt optimization. The hypothesis is testable: Phase 5 (article bank comparison) will compare evolution runs with and without tree search enabled. If tree search doesn't measurably improve quality, the feature should be disabled.

**Caveat on prose vs. structured tasks**: The cited academic results (SPaR, ReTreVal, MCT Self-Refine) are on structured/reasoning tasks where correctness is objective. Prose quality is subjective and the evaluation signal (LLM pairwise comparison) is noisy. Tree search may amplify evaluation noise rather than reduce it. The hybrid evaluation's two-stage design (parent-relative filter → tournament) is designed to mitigate this: Stage 1 provides a high-confidence binary signal (did this edit improve?), and Stage 2 only ranks the already-filtered improvements. This is a bet worth making at ~$0.04 per invocation, with the feature flag providing a clean rollback path if results are negative.

## Phased Execution Plan

### Phase 1: Core TreeNode Data Structure & Beam Search Agent

**Goal**: Ship a working `TreeSearchAgent` that plugs into the COMPETITION phase and produces better variants than the current IterativeEditingAgent alone.

#### 1.1 TreeNode types and utilities (`src/lib/evolution/treeOfThought/types.ts`)

New types:
```typescript
interface TreeNode {
  id: string;                    // UUID
  variantId: string;             // Links to TextVariation in pool
  parentNodeId: string | null;   // Tree parent (null = root)
  childNodeIds: string[];        // Tree children
  depth: number;                 // Distance from root (0 = root)
  revisionAction: RevisionAction; // What edit created this node
  value: number;                 // Evaluation score (OpenSkill ordinal from mini-tournament)
  pruned: boolean;               // Whether this branch was abandoned
  // Note: `visits` field omitted (YAGNI). Will be added in Phase 2 if MCTS is pursued.
}

interface RevisionAction {
  type: 'edit_dimension' | 'structural_transform' | 'lexical_simplify' | 'grounding_enhance' | 'creative';
  dimension?: string;            // For edit_dimension: clarity, structure, etc.
  description: string;           // Human-readable action description
}

interface TreeSearchResult {
  bestLeafNodeId: string;
  bestVariantId: string;
  revisionPath: RevisionAction[]; // Root → best leaf actions
  treeSize: number;
  maxDepth: number;
  prunedBranches: number;
}

interface TreeState {
  nodes: Record<string, TreeNode>; // Record (not Map) for JSON serialization safety
  rootNodeId: string;
}
// Runtime helper: treeNode.ts provides getNode(state, id) and addNode(state, node)
// that wrap Record access with type safety
```

Files to create:
- `src/lib/evolution/treeOfThought/types.ts` — Types above
- `src/lib/evolution/treeOfThought/treeNode.ts` — `createRootNode()`, `createChildNode()`, `getAncestors()`, `getPath()`, `getBestLeaf()`, `pruneSubtree()`
- `src/lib/evolution/treeOfThought/index.ts` — Barrel export

#### 1.2 Beam Search implementation (`src/lib/evolution/treeOfThought/beamSearch.ts`)

Core algorithm:
```typescript
async function beamSearch(
  root: TreeNode,
  state: PipelineState,
  ctx: ExecutionContext,
  config: { beamWidth: number; branchingFactor: number; maxDepth: number }
): Promise<TreeSearchResult>
```

Steps per depth level:
1. For each of K active candidates, **re-critique** the candidate (lightweight 5-dimension rubric, reusing ReflectionAgent prompt) to get fresh dimension scores, then identify B revision actions targeting the weakest dimensions. At depth 0, use the existing critique from state; at depth ≥1, run a fresh critique call per candidate (~K calls). This prevents the "stale critique" problem where beam search at depth 2-3 would otherwise use the root's critique data to select actions for already-modified text.
2. Generate B revised texts in parallel via `Promise.allSettled` (reuse prompt patterns from IterativeEditingAgent)
3. Validate format on all K×B candidates
4. **Stage 1 — Parent-relative filter**: Compare each passing candidate to its parent via `compareWithDiff()` (CriticMarkup blind diff, 2-pass direction reversal). Drop candidates that receive REJECT verdict. This guarantees the beam can never regress — only improvements survive. (~18 LLM calls: 9 candidates × 2 passes)
5. **Stage 2 — Sibling mini-tournament**: Run adjacent-pair pairwise comparisons via `compareWithBiasMitigation()` (1 round). Create **local** `Map<string, Rating>` (not `state.ratings`), apply match results to local OpenSkill ratings, rank by ordinal, keep top K (with ancestry diversity slot — see beam collapse mitigation). Local ratings are discarded after selection; they do NOT pollute `state.ratings`. (~N-1 LLM calls for N survivors)
6. Add all K×B to tree (mark non-surviving as `pruned: true`)
7. Add **best leaf + root only** to pipeline pool via `state.addToPool()` (rate-limited to 2 variants per invocation to prevent pool flooding — see beam collapse mitigation)

**Why hybrid evaluation?** Rubric scoring (absolute 1-10) suffers from score collapse when candidates are similar — LLMs cluster near-peers into identical scores. Pairwise comparison is much better at detecting small quality differences. Stage 1 uses diff comparison (the natural question: "did this edit improve things?"). Stage 2 uses the same Swiss tournament the pipeline already trusts for final ranking. Total cost per depth: ~30 evaluation LLM calls (~$0.002 at gpt-4.1-nano pricing), vs. 9 for rubric.

**Evaluation routing by revision type**: `compareWithDiff()` was designed for surgical, single-dimension edits. For broad revision types (`structural_transform`, `creative`) that restructure the document significantly, the CriticMarkup diff becomes noise (80%+ of text marked as changed). Therefore:
- For `edit_dimension` and `lexical_simplify` actions → use `compareWithDiff()` (parent-relative filter)
- For `structural_transform`, `grounding_enhance`, and `creative` actions → use `compareWithBiasMitigation()` directly (full pairwise against parent)
This routing is implemented in `evaluator.ts`'s `filterByParentComparison()` based on the candidate's `RevisionAction.type`.

#### Error handling and recovery paths

**All-rejected at a depth level**: If Stage 1 rejects ALL K×B candidates (no candidate improves on its parent), the beam retains the current depth's winners unchanged and terminates early. The `TreeSearchResult` records the actual max depth reached. This mirrors the IterativeEditingAgent's `consecutiveRejections` pattern — failing to improve is a signal to stop, not an error.

**UNSURE verdicts**: `compareWithDiff()` returns `UNSURE` with confidence 0 when AST parsing fails or changes are zero. Candidates with UNSURE verdict are treated as REJECT (conservative — if we can't confirm improvement, don't promote). Exception: if ALL candidates are UNSURE (e.g., markdown parsing broken), fall back to `compareWithBiasMitigation()` for the entire batch.

**Budget exhaustion mid-beam**: If `BudgetExceededError` is thrown during generation or evaluation at depth D, the beam search catches it, marks the current depth as final, and returns the best result from depth D-1. Partial tree results (surviving nodes from completed depths) are still added to the pool. The agent propagates the budget status in its `AgentResult.metrics`.

**LLM call failures in Promise.allSettled**: Generation uses `Promise.allSettled`. Rejected promises (timeout, network error) produce no candidate — that slot is simply empty. If fewer than K candidates survive format validation + generation, the beam narrows naturally. If zero candidates are generated at a depth, the beam terminates early (same as all-rejected).

**Feature flag rollback**: The flag is read once at pipeline startup (`fetchEvolutionFeatureFlags`). Toggling it mid-run does NOT affect in-progress runs — the run completes with whatever flag state it started with. When tree search is disabled:
- New runs skip the agent entirely (standard feature flag pattern)
- Existing checkpoints with `treeSearchResults` are harmlessly ignored (`deserializeState()` defaults to `null` for the field if the agent is disabled, tree variants already in pool remain as normal variants)
- No data migration needed — `treeSearchResults` is metadata, not structural

**Cost reservation strategy**: The agent calls `reserveBudget()` once upfront for the full estimated cost (~$0.062 with 1.3x margin). Individual LLM calls use `recordSpend()` which decrements the reservation. If actual cost is lower than reserved, the surplus is released when the agent completes. This follows the same pattern as Tournament agent (single reservation, batch execution, final release).

#### Beam collapse mitigation

Beam collapse occurs when all K beam slots converge to stylistically similar variants, eliminating the diversity that makes beam search valuable. Three mechanisms prevent this:

1. **Forced action-type diversity at generation**: When generating B revisions per candidate, each revision MUST use a different `RevisionAction.type`. With B=3, each candidate produces one `edit_dimension`, one `structural_transform`/`lexical_simplify`/`grounding_enhance`, and one `creative`. This ensures siblings are structurally diverse even if the parent critique points to a single weakness. Implemented in `revisionActions.ts`'s `selectRevisionActions()`.

2. **Ancestry diversity slot in top-K selection**: After the sibling mini-tournament ranks survivors by ordinal, the top-K selection reserves at least 1 slot for a candidate from a different parent lineage (if available). Concretely: select top K-1 by ordinal, then fill the last slot with the highest-ranked candidate whose `parentNodeId` differs from the top K-1's parents. If all survivors share a parent, the last slot goes to the best remaining candidate regardless. This prevents a single strong parent from monopolizing all beam slots.

3. **Pool injection rate limiting**: Only the best leaf and the root are added to the shared pool (not all intermediate surviving nodes). This limits tree search to contributing **2 variants per invocation** to the pool, comparable to other agents (GenerationAgent: 3, DebateAgent: 1). This prevents tree search from flooding the pool with same-lineage variants that would trigger the `PoolDiversityTracker`'s lineage dominance alert (>50% of pool from one ancestor).

**Implementation notes**:
- `evaluator.ts` constructs a `callLLM` closure from `ExecutionContext` for `compareWithDiff()` and `compareWithBiasMitigation()` (matching IterativeEditingAgent's pattern at line 97: `(prompt) => ctx.llmClient.complete(prompt, { model: config.judgeModel })`). Uses standalone `compareWithBiasMitigation` from `comparison.ts` (not the `PairwiseRanker` instance method) to avoid writing to `state.matchHistory`.
- Variants added to pool use strategy string `tree_search_{revisionAction.type}` (e.g., `tree_search_edit_dimension`, `tree_search_structural_transform`) for strategy effectiveness tracking.
- `treeSearchResults` field on PipelineState should be `treeSearchResults?: TreeSearchResult[] | null` (optional) so existing mocks/test helpers don't need immediate updates. Same for `treeSearchStates`.

Files to create:
- `src/lib/evolution/treeOfThought/beamSearch.ts` — Core beam search algorithm with hybrid two-stage evaluation
- `src/lib/evolution/treeOfThought/revisionActions.ts` — `selectRevisionActions()` using critique data (forced action-type diversity), `buildRevisionPrompt()` per action type
- `src/lib/evolution/treeOfThought/evaluator.ts` — `filterByParentComparison()` wrapping `compareWithDiff()` / `compareWithBiasMitigation()` (routed by revision type), `rankSurvivors()` wrapping Swiss pairing + local OpenSkill ratings

#### 1.3 TreeSearchAgent (`src/lib/evolution/agents/treeSearchAgent.ts`)

Extends `AgentBase`:
```typescript
class TreeSearchAgent extends AgentBase {
  readonly name = 'treeSearch'; // camelCase to match budgetCaps key and existing convention

  canExecute(state: PipelineState): boolean {
    // Requires critiques (runs after ReflectionAgent)
    // Requires ratings (at least some variants ranked)
    // Requires top variant to have a critique (match IterativeEditingAgent pattern)
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
    if (state.ratings.size === 0) return false;
    const top = state.getTopByRating(1)[0];
    if (!top) return false;
    return getCritiqueForVariant(top.id, state) !== null;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    // 1. Select root variant: highest mu with sigma > CONVERGENCE_SIGMA_THRESHOLD
    //    (high potential, underexplored). Falls back to top by ordinal if all converged.
    //    Also verify root has a critique (match IterativeEditingAgent's canExecute guard).
    // 2. Get critique for root to inform branching actions
    // 3. Run beamSearch(root, state, ctx, config)
    // 4. Add best leaf + root to pool (rate-limited: 2 variants max)
    // 5. Store tree search result in state for visualization
    // 6. Return AgentResult with metrics
  }

  estimateCost(payload: AgentPayload): number {
    // Estimate using actual model pricing, not flat per-call rate.
    // Generation: K*B*D calls at generationModel (gpt-4.1-mini) pricing
    // Re-critique: K*(D-1) calls at generationModel pricing
    // Evaluation: ~30*D calls at judgeModel (gpt-4.1-nano) pricing
    // For ~2000-char article: ~$0.048 per invocation
    // Reserve with 1.3x safety margin per costTracker convention = ~$0.062
  }
}
```

#### 1.4 Pipeline integration

Files to modify:
- `src/lib/evolution/core/supervisor.ts` — Add `runTreeSearch: boolean` to `PhaseConfig` interface (line 17-29), set `true` in COMPETITION phase config return, `false` in EXPANSION
- `src/lib/evolution/core/pipeline.ts`:
  - Add `treeSearch?: PipelineAgent` to `PipelineAgents` interface (line 297-307)
  - Add conditional execution block after IterativeEditingAgent (after line 425), following the exact dispatch pattern:
    ```typescript
    // === Tree Search (COMPETITION only — optional) ===
    if (config.runTreeSearch && agents.treeSearch) {
      if (options.featureFlags?.treeSearchEnabled === false) {
        logger.info('Tree search agent disabled by feature flag', { iteration: ctx.state.iteration });
      } else {
        await runAgent(runId, agents.treeSearch, ctx, phase, logger);
      }
    }
    ```
- `src/lib/evolution/config.ts` — **Rebalance** `budgetCaps`. Tree search **replaces** IterativeEditingAgent (mutually exclusive via feature flag). Budget rebalance reduces tournament slightly to give tree search a viable cap:
  ```typescript
  budgetCaps: {
    generation: 0.25,
    calibration: 0.15,
    tournament: 0.20,  // reduced from 0.25
    evolution: 0.15,
    reflection: 0.05,
    debate: 0.05,
    iterativeEditing: 0.05, // reduced from 0.10 (disabled when treeSearch enabled)
    treeSearch: 0.10,        // new: $0.50 at $5 total, supports ~9 invocations at ~$0.048 each
  }
  // Total: 1.00
  ```
- `src/lib/evolution/core/featureFlags.ts` — Four changes required:
  1. Add `treeSearchEnabled: boolean` to `EvolutionFeatureFlags` interface
  2. Add `treeSearchEnabled: false` to `DEFAULT_EVOLUTION_FLAGS` (opt-in: new experimental feature defaults to disabled)
  3. Add `'evolution_tree_search_enabled': 'treeSearchEnabled'` to `FLAG_MAP`
  4. Pipeline conditional check in pipeline.ts (covered above)

  **Mutual exclusivity with IterativeEditingAgent**: When `treeSearchEnabled` is true, `iterativeEditingEnabled` is forced to false in `fetchEvolutionFeatureFlags()`. They serve related purposes (critique-driven revision) and running both wastes budget on overlapping work targeting the same top variant. The dispatch block in pipeline.ts enforces this: tree search block checks `treeSearchEnabled !== false` AND the iterativeEditing block is skipped when `treeSearchEnabled` is true.
- `src/lib/evolution/types.ts` — Add to **both** `PipelineState` interface and `SerializedPipelineState` (moved from Phase 3 — needed in Phase 1 since the agent writes to this field):
    - `treeSearchResults: TreeSearchResult[] | null` — summary (best leaf, revision path, metrics)
    - `treeSearchStates: TreeState[] | null` — full tree (all nodes with depths, pruning status, values) for Phase 4 visualization
  Both fields are optional (`| null`) for backward compat. `SerializedPipelineState` uses the same types since `TreeState.nodes` is already `Record<string, TreeNode>` (JSON-safe).
- `src/lib/evolution/core/state.ts` — Add `treeSearchResults` field to `PipelineStateImpl`, initialize to `null`, include in `serializeState()` (convert TreeState Map → Record) and `deserializeState()` (with backward compat: default to `null` if missing)

**Note**: Serialization and state changes are consolidated into Phase 1 (moved from Phase 3) because the agent needs to write `treeSearchResults` from its first execution.

#### 1.5 Feature flag migration

File to create:
- `supabase/migrations/XXXXXXXX_tree_search_feature_flag.sql` — Insert `evolution_tree_search_enabled` into `feature_flags` table

### Phase 2: Testing

#### 2.1 Unit tests

Files to create:
- `src/lib/evolution/treeOfThought/treeNode.test.ts` — Tree construction, path extraction, pruning, ancestor traversal
- `src/lib/evolution/treeOfThought/beamSearch.test.ts` — Beam search with mock LLM client, beam collapse prevention, depth limits, budget enforcement
- `src/lib/evolution/treeOfThought/revisionActions.test.ts` — Action selection from critiques, prompt construction
- `src/lib/evolution/treeOfThought/evaluator.test.ts` — Parent-relative filtering, sibling tournament ranking
- `src/lib/evolution/agents/treeSearchAgent.test.ts` — Agent execute/canExecute/estimateCost, integration with mock pipeline state

Use existing test helpers: `createMockEvolutionLLMClient`, `createTestEvolutionRun`, `createTestVariant` from `src/testing/utils/evolution-test-helpers.ts`.

#### 2.2 Integration test

File to create:
- `src/__tests__/integration/evolution-tree-search.integration.test.ts` — TreeSearchAgent with real Supabase, verify variants persisted, tree structure correct

#### 2.3 CLI verification

Run tree search via existing `run-evolution-local.ts` CLI:
```bash
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --full --iterations 5
```
Verify tree search agent executes in COMPETITION iterations, produces variants, and doesn't break existing agents.

### Phase 3: ~~Checkpoint Serialization~~ (Consolidated into Phase 1)

State persistence and serialization changes were moved to Phase 1.4 because the agent writes `treeSearchResults` during execution. Keeping serialization in a later phase would create a dependency cycle.

**Serialization details** (implemented in Phase 1.4):
- `TreeState.nodes` uses `Record<string, TreeNode>` (not Map) — JSON-serializable natively, no conversion needed. This differs from `ratings` (which uses Map at runtime and converts to Record for serialization). The simpler Record approach is chosen because the tree is write-once (built during beam search, never mutated after) and the node count is small (~27 nodes).
- `deserializeState()` defaults `treeSearchResults` to `null` if absent (backward compat).
- The tree is also reconstructable from `pool` + `parentIds` as a fallback, but storing both `TreeSearchResult` (summary) and `TreeState` (full tree) preserves pruning decisions, revision path attribution, and supports Phase 4 visualization.

### Phase 4: Visualization

#### 4.1 Tree path in lineage graph

Files to modify:
- `src/lib/services/evolutionVisualizationActions.ts` — Extract tree search results from checkpoint, add `treeSearchPath` to `LineageData`
- `src/components/evolution/LineageGraph.tsx` — Highlight winning revision path (thicker/gold edges), dim pruned branches (gray/dashed edges), show revision action labels on edges
- `src/components/evolution/VariantCard.tsx` — Add `treeDepth` and `revisionAction` display when variant is part of a tree search result

#### 4.2 New "Tree" tab on run detail page

Files to create:
- `src/components/evolution/tabs/TreeTab.tsx` — Dedicated tree visualization showing the search tree with:
  - Depth-layered layout (switch to `d3-dag` Sugiyama for proper hierarchy)
  - Node size by evaluation score
  - Edge labels showing revision action type
  - Pruned branches shown as semi-transparent
  - Winner path highlighted
  - Click to compare any two nodes via existing diff infrastructure

Files to modify:
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Add "Tree" tab alongside existing Timeline/Elo/Lineage/Budget/Variants tabs

### Phase 5: Article Bank Integration & Comparison

#### 5.1 Add tree search as generation method

Files to modify:
- `src/config/promptBankConfig.ts` — Add `tree_search` as a generation method alongside `oneshot` and `evolution`
- `scripts/run-evolution-local.ts` — Ensure `--full` flag enables tree search agent (it will automatically if feature flag is on)

#### 5.2 Compare tree search vs baseline

Run prompt bank comparison:
```bash
npx tsx scripts/run-prompt-bank.ts --method evolution
npx tsx scripts/run-prompt-bank-comparisons.ts
```

Verify tree search variants appear in article bank and Elo rankings show improvement over non-tree-search evolution runs.

## Testing

### Unit Tests (Phase 2.1)
- `treeNode.test.ts` — ~15 tests: create root/child, path extraction, ancestor chain, pruning, Record-based TreeState serialization round-trip
- `beamSearch.test.ts` — ~25 tests: basic beam happy path, beam collapse prevention (ancestry diversity slot), depth limit, budget exhaustion mid-beam (partial tree returned), format validation failures, empty critique handling, all-rejected early termination, Promise.allSettled partial failures (2 of 9 calls fail), re-critique at depth ≥1, evaluation routing by revision type (diff vs pairwise)
- `revisionActions.test.ts` — ~10 tests: action selection from critique, forced action-type diversity (each sibling gets different type), prompt construction for each action type, FORMAT_RULES inclusion
- `evaluator.test.ts` — ~15 tests: parent-relative diff filtering (ACCEPT/REJECT/UNSURE verdicts), all-rejected fallback (terminate early), all-UNSURE fallback (switch to compareWithBiasMitigation), evaluation routing (diff for surgical edits, pairwise for broad revisions), sibling mini-tournament with LOCAL ratings (verify state.ratings not mutated), Swiss pairing on TextVariation[] mapped from TreeNodes, OpenSkill ranking, single-survivor bypass (skip tournament), ancestry diversity slot selection, no-regression guarantee
- `treeSearchAgent.test.ts` — ~20 tests: canExecute guards (including top-variant-has-critique check), root selection (highest mu with high sigma, fallback to top ordinal when all converged), execute flow, pool injection rate limiting (only 2 variants added: best leaf + root — root already in pool is no-op so effectively 1 new), cost estimation with real model pricing (including re-critique calls), feature flag gating (disabled by default), mutual exclusivity (treeSearchEnabled=true forces iterativeEditingEnabled=false), multi-iteration budget accumulation (verify agent respects 10% cap across 7+ invocations), agent name matches budgetCaps key ('treeSearch')

### Integration Tests (Phase 2.2)
- `evolution-tree-search.integration.test.ts` — ~8 tests: agent with real Supabase, variant persistence, tree structure in checkpoint, backward compat (deserialize checkpoint without treeSearchResults → null), feature flag seed in test setup, pool count before/after (verify only 2 variants added)

### State Serialization Tests (added to existing state.test.ts)
- Backward compat: deserialize checkpoint without `treeSearchResults` → defaults to `null`
- Round-trip: serialize/deserialize TreeState with Record<string, TreeNode>

### Manual Verification
- Run CLI with `--full --iterations 5` on sample content
- Run CLI with `--full --iterations 1` to test single-iteration edge case
- Verify tree search agent appears in checkpoint data
- Verify checkpoint contains treeSearchResults with valid tree structure
- Verify parentIds form valid tree in pool variants
- Compare final ordinal with and without tree search enabled (feature flag toggle)
- Verify lineage graph shows branching structure
- Verify article bank comparison includes tree-search variants

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` — Add TreeSearchAgent to agent table, update pipeline flow diagram, add tree search to COMPETITION phase description, add budget cap entry
- `docs/feature_deep_dives/iterative_editing_agent.md` — Add cross-reference to tree search as the branching evolution of the sequential editing approach
- `docs/feature_deep_dives/comparison_infrastructure.md` — Add `tree_search` as generation method in prompt bank config documentation
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Document new Tree tab, updated lineage graph with path highlighting
- `docs/feature_deep_dives/tree_of_thought_revisions.md` — Fill in the stub created during /initialize with full implementation details

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `src/lib/evolution/treeOfThought/types.ts` | TreeNode, RevisionAction, TreeSearchResult, TreeState types |
| `src/lib/evolution/treeOfThought/treeNode.ts` | Tree construction/traversal utilities |
| `src/lib/evolution/treeOfThought/beamSearch.ts` | Beam search algorithm |
| `src/lib/evolution/treeOfThought/revisionActions.ts` | Action selection and prompt construction |
| `src/lib/evolution/treeOfThought/evaluator.ts` | Hybrid evaluation: parent-relative diff filter + sibling mini-tournament |
| `src/lib/evolution/treeOfThought/index.ts` | Barrel export |
| `src/lib/evolution/agents/treeSearchAgent.ts` | AgentBase implementation |
| `src/lib/evolution/treeOfThought/treeNode.test.ts` | Unit tests |
| `src/lib/evolution/treeOfThought/beamSearch.test.ts` | Unit tests |
| `src/lib/evolution/treeOfThought/revisionActions.test.ts` | Unit tests |
| `src/lib/evolution/treeOfThought/evaluator.test.ts` | Unit tests |
| `src/lib/evolution/agents/treeSearchAgent.test.ts` | Unit tests |
| `src/__tests__/integration/evolution-tree-search.integration.test.ts` | Integration test |
| `src/components/evolution/tabs/TreeTab.tsx` | Tree visualization tab |
| `supabase/migrations/XXXXXXXX_tree_search_feature_flag.sql` | Feature flag migration |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/evolution/core/supervisor.ts` | Add `runTreeSearch: boolean` to PhaseConfig, set in COMPETITION/EXPANSION returns |
| `src/lib/evolution/core/pipeline.ts` | Add `treeSearch?: PipelineAgent` to PipelineAgents, add dispatch block with feature flag check |
| `src/lib/evolution/config.ts` | Rebalance budgetCaps: `tournament: 0.20`, `iterativeEditing: 0.05`, add `treeSearch: 0.10` (total 1.00) |
| `src/lib/evolution/core/featureFlags.ts` | Add `treeSearchEnabled` (default: false, opt-in), mutual exclusivity with iterativeEditing, 4 touch points |
| `src/lib/evolution/types.ts` | Add TreeSearchResult to PipelineState + SerializedPipelineState (Phase 1, not Phase 3) |
| `src/lib/evolution/core/state.ts` | Add treeSearchResults: field, serialization (Record conversion), deserialization with backward compat |
| `src/lib/services/evolutionVisualizationActions.ts` | Extract tree data for visualization |
| `src/components/evolution/LineageGraph.tsx` | Path highlighting, pruned branch dimming |
| `src/components/evolution/VariantCard.tsx` | Show tree depth and revision action |
| `src/app/admin/quality/evolution/run/[runId]/page.tsx` | Add Tree tab |
| `src/config/promptBankConfig.ts` | Add tree_search generation method |
