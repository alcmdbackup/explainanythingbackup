# Develop Tree of Thought Revisions Strategy Progress

## Phase 1: Core TreeNode Data Structure & Beam Search Agent

### 1.1 Core Types & Tree Utilities
**Status:** Complete

**Files created:**
- `src/lib/evolution/treeOfThought/types.ts` — TreeNode, RevisionAction, TreeState, BeamSearchConfig types
- `src/lib/evolution/treeOfThought/treeNode.ts` — Tree construction/traversal: createRootNode, createChildNode, getAncestors, getPath, getBestLeaf, pruneSubtree
- `src/lib/evolution/treeOfThought/index.ts` — Barrel exports

**Design decisions:**
- Used `Record<string, TreeNode>` (not Map) for JSON serialization safety
- BeamWidth=3, BranchingFactor=3, MaxDepth=3 defaults per plan

### 1.2 Beam Search, Revision Actions, Evaluator
**Status:** Complete

**Files created:**
- `src/lib/evolution/treeOfThought/revisionActions.ts` — selectRevisionActions (enforces action-type diversity), buildRevisionPrompt (per-action-type LLM prompts with FORMAT_RULES)
- `src/lib/evolution/treeOfThought/evaluator.ts` — filterByParentComparison (Stage 1: parent-relative diff/pairwise routing), rankSurvivors (Stage 2: local Swiss mini-tournament with OpenSkill + ancestry diversity slot)
- `src/lib/evolution/treeOfThought/beamSearch.ts` — Core beam search algorithm returning {result, treeState, bestLeafText}

**Design decisions:**
- DIFF_ELIGIBLE_TYPES = edit_dimension, lexical_simplify → use compareWithDiff; others → compareWithBiasMitigation
- Ancestry diversity slot: last beam position reserved for different-parent lineage
- Promise.allSettled for generation (graceful partial failure handling)
- Re-critiques beam at depth >= 2 for fresh dimension targeting

### 1.3 TreeSearchAgent
**Status:** Complete

**Files created:**
- `src/lib/evolution/agents/treeSearchAgent.ts` — TreeSearchAgent extends AgentBase with name='treeSearch'

**Design decisions:**
- Root selection prefers underexplored (high sigma) variants with high potential
- Rate-limited to 1 new variant per execution (best leaf only)
- Stores results on state.treeSearchResults and state.treeSearchStates

### 1.4 Pipeline Integration
**Status:** Complete

**Files modified:**
- `src/lib/evolution/core/featureFlags.ts` — Added treeSearchEnabled with mutual exclusivity (disables iterativeEditing)
- `src/lib/evolution/core/supervisor.ts` — Added runTreeSearch to COMPETITION phase config
- `src/lib/evolution/config.ts` — Rebalanced budgetCaps: tournament 0.25→0.20, iterativeEditing 0.10→0.05, treeSearch: 0.10
- `src/lib/evolution/core/pipeline.ts` — Added treeSearch to PipelineAgents, dispatch block with feature flag check
- `src/lib/evolution/types.ts` — Added treeSearchResults/treeSearchStates to PipelineState
- `src/lib/evolution/core/state.ts` — Added fields, serialization/deserialization with backward compat

### 1.5 Feature Flag Migration
**Status:** Complete

**Files created:**
- `supabase/migrations/20260206000001_tree_search_feature_flag.sql`

### Issues Encountered
1. **Workflow hook mismatch:** Branch `feat/develop_tree_of_thought_revisions_strat_20260205` vs project folder `docs/planning/develop_tree_of_thought_revisions_strat_20260205/`. Fixed with symlink at `docs/planning/feat/`.
2. **TS type narrowing:** `TreeNode | undefined` in tree traversal — fixed with explicit type annotation.
3. **bestLeafText return:** beamSearch initially didn't return the generated text. Added `bestLeafText` to return type.
4. **openskill not installed:** Package in package.json but not in node_modules. Created centralized mock at `src/testing/mocks/openskill.ts` with Bayesian-approximate behavior.

## Phase 2: Testing

### 2.1 Unit Tests
**Status:** Complete

**Files created:**
- `src/lib/evolution/treeOfThought/treeNode.test.ts` — 24 tests
- `src/lib/evolution/treeOfThought/revisionActions.test.ts` — 12 tests
- `src/lib/evolution/treeOfThought/evaluator.test.ts` — 13 tests
- `src/lib/evolution/agents/treeSearchAgent.test.ts` — 17 tests

**Files modified (test fixes):**
- `src/lib/evolution/core/featureFlags.test.ts` — Added treeSearchEnabled to expected flag objects
- `src/lib/evolution/core/config.test.ts` — Updated tournament budget cap expectation 0.25→0.20
- `jest.config.js` — Added openskill mock to moduleNameMapper
- `src/testing/mocks/openskill.ts` — Made mock Bayesian-realistic (logistic expected-outcome)

**Test results:** 28 suites, 427 tests — all passing.

### 2.2 Integration Test
**Status:** Complete

**Files created:**
- `src/__tests__/integration/evolution-tree-search.integration.test.ts` — 8 tests: agent execution with mock LLM, treeSearchResults/treeSearchStates on state, canExecute guards, checkpoint backward compat (deserialize without tree fields → null), round-trip serialization, pool rate limiting

**Design decisions:**
- Small beam config (K=2, B=2, D=1) for fast tests while exercising full code path
- Mock LLM discriminates between critique/comparison/generation calls via prompt content

### Issues Encountered
- openskill mock initially used constant ±2 shifts, breaking rating.test.ts assertions about relative strength. Fixed with logistic expected-outcome model.

## Phase 3: Checkpoint Serialization
**Status:** Consolidated into Phase 1.4 (complete)

## Phase 4: Visualization

### 4.1 Tree Path in Lineage Graph
**Status:** Complete

**Files modified:**
- `src/lib/services/evolutionVisualizationActions.ts` — Extended `LineageData` with `treeDepth`, `revisionAction`, `treeSearchPath`. Lineage action extracts tree metadata from checkpoint and builds winning path set by walking from best leaf to root.
- `src/components/evolution/LineageGraph.tsx` — Added `treeSearchPath` prop. Winning tree edges get gold color + 3px stroke. Pruned tree branches get dashed/dimmed edges (opacity 0.25, dasharray 4,3). Updated VariantCard call with tree info.
- `src/components/evolution/VariantCard.tsx` — Added `treeDepth` and `revisionAction` props. When present, shows depth and action in a border-separated footer row. Added `tree_search_*` strategies to STRATEGY_PALETTE (gold for edit_dimension, pink for creative, etc.).
- `src/components/evolution/tabs/LineageTab.tsx` — Passes `treeSearchPath` through to LineageGraph.

### 4.2 New "Tree" Tab on Run Detail Page
**Status:** Complete

**Files created:**
- `src/components/evolution/tabs/TreeTab.tsx` — Dedicated tree search visualization with D3 depth-layered layout, zoom/pan, node sizing by depth, gold winning path, pruned branch dimming, edge labels (revision action type/dimension), click-to-inspect node detail panel, multi-tree selector.

**Files modified:**
- `src/lib/services/evolutionVisualizationActions.ts` — Added `TreeSearchData` type and `getEvolutionRunTreeSearchAction` server action (7th action). Extracts tree states and results from latest checkpoint.
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Added "Tree" tab to tab bar (6th tab, between Lineage and Budget). Imports and renders TreeTab component.

**Design decisions:**
- Used `useMemo` for `winnerPathIds` and `nodeById` to prevent D3 re-renders on every React render
- Tree nodes display depth level (D0, D1, D2...) inside circles; gold fill for winning path, copper for active, faded for pruned
- Edge labels show revision dimension (for edit_dimension) or action type (for others)

## Phase 5: Article Bank Integration

### 5.1 Generation Method Config
**Status:** Complete

**Files modified:**
- `src/config/promptBankConfig.ts` — Added `'tree_search'` to `GenerationMethodType` union. Added full-mode evolution method entry (`evolution_tree_search` label, mode: 'full') alongside existing minimal evolution entry.

## Documentation Updates
**Status:** Complete

**Files modified:**
- `docs/feature_deep_dives/tree_of_thought_revisions.md` — Filled stub with complete documentation: overview, algorithm, beam collapse mitigation, error handling, pipeline integration, visualization, configuration, key files, testing, related docs
- `docs/feature_deep_dives/evolution_pipeline.md` — Added TreeSearchAgent to agent interaction table, added tree_search_enabled feature flag, added treeSearchAgent.ts to agents file table, added treeOfThought/ files section, updated promptBankConfig description
- `docs/feature_deep_dives/iterative_editing_agent.md` — Added cross-reference to tree_of_thought_revisions.md
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Updated run detail to 6 tabs, added TreeTab.tsx to components table, updated server actions to 7 (added getEvolutionRunTreeSearchAction), updated lineage action description
- `docs/feature_deep_dives/comparison_infrastructure.md` — Updated method count (4→5), updated coverage matrix (30→45 cells)
