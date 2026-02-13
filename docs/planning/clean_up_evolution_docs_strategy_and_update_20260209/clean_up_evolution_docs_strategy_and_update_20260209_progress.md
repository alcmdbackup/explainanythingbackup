# Clean Up Evolution Docs Strategy And Update Progress

## Phase 1: Create folder structure, reference.md, and README.md
### Work Done
- Created `docs/evolution/` and `docs/evolution/agents/` directories
- Wrote `reference.md` extracting all cross-cutting content from `evolution_pipeline.md`:
  - Configuration block with full DEFAULT_EVOLUTION_CONFIG
  - Tiered model routing explanation
  - Feature flags table (all 8 flags + cron flag note)
  - Budget caps table with explicit percentages
  - Budget enforcement (CostTracker, FIFO reservation, pause behavior)
  - Format enforcement (FORMAT_VALIDATION_MODE env var)
  - Edge cases & guards (min pool sizes, format failures, budget edge cases, short articles)
  - Run summary (EvolutionRunSummary schema fields)
  - Database schema (8 evolution + 4 hall of fame tables)
  - Key files master index (core, shared, agents, comparison, tree of thought, section decomposition, integration points)
  - Usage examples (queuing, running, admin UI)
  - CLI commands (batch runner, local CLI, prompt-based seeding)
  - Production deployment (database setup, monitoring)
  - Observability (OpenTelemetry, structured logging, heartbeat, cost attribution)
  - Testing (unit, integration, E2E test inventory)
- Wrote `README.md` with:
  - Recommended reading order (12 docs)
  - Document map (ASCII tree)
  - Two rating systems callout (OpenSkill vs Elo)
  - Code layout reference

### Issues Encountered
None

### User Clarifications
None

## Phase 2: Migrate core docs
### Work Done
- Created `architecture.md` from evolution_pipeline.md §§ 1-3 (Pipeline Orchestration, Two-Phase Design, Two Modes, Append-Only Pool, Checkpoint/Resume, Error Recovery, Stopping Conditions, Data Flow Diagram, Known Gaps)
- Created `data_model.md` from evolution_framework.md (moved intact, added Related Documentation)
- Created `rating_and_comparison.md` from evolution_pipeline.md §§ rating/comparison (OpenSkill, Swiss Tournament, Stratified Opponents, Adaptive Calibration, LLM Cache, Position Bias, NEW Comparison Methods section)
- Commit: `4c79279`

### Issues Encountered
None

### User Clarifications
None

## Phase 3: Migrate agent docs
### Work Done
- Created `agents/overview.md` — AgentBase framework, ExecutionContext, async parallelism, 12-agent interaction table, format validation, ranking agents
- Created `agents/generation.md` — from outline_based_generation_editing.md, deduplicated config/flags/budget (link to reference.md)
- Created `agents/editing.md` — merged iterative_editing_agent.md + hierarchical_decomposition_agent.md, shared design pattern intro, fixed budget cap from 10% to correct 5% (verified in source code)
- Created `agents/tree_search.md` — from tree_of_thought_revisions.md, deduplicated config (link to reference.md)
- Created `agents/support.md` — NEW doc from source code analysis covering 5 previously undocumented agents: ReflectionAgent, DebateAgent, EvolutionAgent, ProximityAgent, MetaReviewAgent
- Commit: `443434a`

### Issues Encountered
- Budget cap discrepancy: iterative_editing_agent.md claimed 10% but code has `iterativeEditing: 0.05` (5%). Fixed in agents/editing.md.

### User Clarifications
None

## Phase 4: Migrate infrastructure docs
### Work Done
- Created `hall_of_fame.md` from comparison_infrastructure.md (moved intact, updated links)
- Created `cost_optimization.md` from elo_budget_optimization.md (moved intact, updated links)
- Created `visualization.md` from evolution_pipeline_visualization.md (moved intact, added Related Documentation — was orphan doc)
- Commit: `2b788c7`

### Issues Encountered
None

### User Clarifications
None

## Phase 5: Update external references
### Work Done
- Updated `docs/docs_overall/architecture.md` — 3 evolution links updated, added "Evolution System" callout
- Updated `docs/docs_overall/getting_started.md` — added evolution/ row, adjusted count 24→15
- Updated `docs/docs_overall/instructions_for_updating.md` — adjusted count 17→15, added evolution/ section
- Updated `docs/feature_deep_dives/admin_panel.md` — added evolution doc links to 4 route descriptions
- Updated `docs/feature_deep_dives/testing_setup.md` — added 3 evolution reference links
- Updated `docs/docs_overall/environments.md` — added evolution link to batch runner section
- Commit: `000bf4e`

### Issues Encountered
None

### User Clarifications
None

## Phase 6: Update doc-mapping.json
### Work Done
- Updated all 19 evolution-related entries from `docs/feature_deep_dives/` → `docs/evolution/` paths
- Added 8 new entries for previously unmapped agent files (iterative, section, diffComparison, treeSearch, debate, reflect, metaReview)
- Fixed `treeOfThought*.ts` glob to `treeOfThought/**` (directory match)
- Validated JSON syntax
- Commit: `0da3803`

### Issues Encountered
None

### User Clarifications
None

## Phase 7: Delete old files and verify
### Work Done
- Ran cross-reference grep for all 9 old file paths — remaining references only in historical `docs/planning/` files (correct, not updated)
- Verified zero stale references in active docs (docs_overall, evolution, doc-mapping.json)
- Verified all 12 new docs have "## Related Documentation" sections (no orphans)
- Deleted all 9 old evolution files via `git rm`:
  - comparison_infrastructure.md
  - elo_budget_optimization.md
  - evolution_framework.md
  - evolution_pipeline.md
  - evolution_pipeline_visualization.md
  - hierarchical_decomposition_agent.md
  - iterative_editing_agent.md
  - outline_based_generation_editing.md
  - tree_of_thought_revisions.md

### Issues Encountered
None

### User Clarifications
None

## Summary
- **Total commits**: 7 (one per phase)
- **New files**: 13 docs in `docs/evolution/` (README + 12 content docs)
- **Deleted files**: 9 old docs from `docs/feature_deep_dives/`
- **Updated files**: 7 external docs + doc-mapping.json
- **Net line change**: ~2,006 lines removed from feature_deep_dives, ~2,400 lines added to evolution/ (increase due to new agents/support.md and deduplication replaced by explicit cross-references)
- **Bug fix**: Budget cap corrected from 10% to 5% for iterativeEditing agent
