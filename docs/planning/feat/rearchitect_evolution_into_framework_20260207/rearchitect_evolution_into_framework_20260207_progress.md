# Rearchitect Evolution Into Framework Progress

## Phase 1: Data Model Migrations
### Work Done
- Created 6 SQL migrations (20260207000001-000006):
  - 1a: `prompt_metadata` — difficulty_tier, domain_tags, status on article_bank_topics
  - 1b: `prompt_fk_on_runs` — prompt_id UUID FK on content_evolution_runs
  - 1c: `strategy_formalization` — is_predefined BOOLEAN, pipeline_type TEXT on strategy_configs
  - 1d: `pipeline_type_on_runs` — pipeline_type TEXT on content_evolution_runs
  - 1e: `hall_of_fame_rank` — rank INT on article_bank_entries, expanded generation_method CHECK
  - 1f: `explorer_composite_indexes` — composite index on (prompt_id, pipeline_type, strategy_config_id)
- Updated TypeScript types:
  - `EvolutionRun` in evolutionActions.ts: added prompt_id, pipeline_type, strategy_config_id
  - `PipelineType` in types.ts: 'full' | 'minimal' | 'batch'
  - `PromptMetadata` in types.ts: full prompt registry row type
  - `StrategyConfigRow` in strategyConfig.ts: DB row with is_predefined, pipeline_type
- Extended strategyConfig.test.ts with 7 new tests (30 total, all pass)
  - Critical invariant: is_predefined and pipeline_type NOT in hashStrategyConfig
  - Type-level tests for StrategyConfigRow, PromptMetadata, PipelineType
- tsc, lint, build all pass

### Issues Encountered
- Planning folder was at `docs/planning/rearchitect_evolution_into_framework_20260207/` but workflow hook expected `docs/planning/feat/rearchitect_evolution_into_framework_20260207/` (matching full branch name including prefix). Fixed by moving the folder.

## Phase 2: Prompt Registry
### Work Done
- Created `src/lib/services/promptRegistryActions.ts` with CRUD actions:
  - `getPromptsAction` — list with status filter, normalizes null domain_tags/status
  - `createPromptAction` — case-insensitive uniqueness check, metadata (title, difficulty_tier, domain_tags)
  - `updatePromptAction` — partial update, re-checks uniqueness on prompt text change
  - `archivePromptAction` — soft-archive via status column
  - `deletePromptAction` — soft-delete via deleted_at, guards against deletion if runs exist
  - `resolvePromptByText` — exported helper for auto-link and CLI
- Added auto-link logic in `pipeline.ts` `finalizePipelineRun()`:
  - Strategy 1: via article_bank_entries.topic_id where evolution_run_id matches
  - Strategy 2: via explanation title → article_bank_topics.prompt match
  - Non-fatal on failure (logs warning)
- Created `scripts/backfill-prompt-ids.ts` for one-time backfill of existing runs
- Created `promptRegistryActions.test.ts` — 11 tests, all pass
  - Uses Proxy-based Supabase mock for fluent query builder chains
- tsc, lint, build all pass

### Issues Encountered
- Initial simple mock approach failed (4/10 tests). Rewrote using Proxy-based `createQueryChain` that makes any chain thenable.
- `Function` type lint error in test mocks — fixed with eslint-disable comments.

## Phase 3: Strategy Formalization
### Work Done
- Created migration `20260207000007_strategy_lifecycle.sql`:
  - Adds `status TEXT DEFAULT 'active'` and `created_by TEXT DEFAULT 'system'` to strategy_configs
  - CHECK constraints for both columns
- Updated `StrategyConfigRow` in strategyConfig.ts with `status` and `created_by` fields
- Created `src/lib/services/strategyRegistryActions.ts` with full CRUD:
  - `getStrategiesAction` — list with filters (status, isPredefined, pipelineType), normalizes pre-migration rows
  - `getStrategyDetailAction` — single strategy by ID
  - `createStrategyAction` — hash-based dedup (promotes existing auto-created strategy if hash matches)
  - `cloneStrategyAction` — copies config from source, delegates to create for hash dedup
  - `archiveStrategyAction` — guard: only predefined strategies
  - `deleteStrategyAction` — guard: predefined + zero runs
  - `getStrategyPresets()` — 3 built-in presets (Economy, Balanced, Quality)
  - `getStrategyPresetsAction` — server action wrapper
- Created `strategyRegistryActions.test.ts` — 18 tests, all pass
- Updated existing strategyConfig.test.ts to include status/created_by fields — 30 tests pass
- tsc, lint, build all pass

### Issues Encountered
- Existing StrategyConfigRow test was missing new status/created_by fields — quick fix.

## Phase 4: Pipeline Type + Hall of Fame
### Work Done
- **Pipeline type auto-population** in `pipeline.ts`:
  - `executeMinimalPipeline` sets `pipeline_type = 'minimal'` on run start
  - `executeFullPipeline` sets `pipeline_type = 'full'` on run start
- **Top-3 hall-of-fame feeding** via `feedHallOfFame()` in `pipeline.ts`:
  - Called at end of `finalizePipelineRun()` after `autoLinkPrompt`
  - Gets top 3 variants by rating from `state.getTopByRating(3)`
  - Resolves topic_id: prefers `prompt_id` already linked on run, falls back to explanation title match
  - Upserts into `article_bank_entries` with `rank 1, 2, 3`, using `evolution_run_id + rank` as natural key (dedup via unique index from migration 000005)
  - `generation_method = 'evolution_winner'` for rank 1, `'evolution_top3'` for ranks 2-3
  - Initializes Elo ratings using actual ordinal scores (not fixed 1200)
  - Handles < 3 variants gracefully (inserts only available)
  - Non-fatal on failure (logs warning)
- **linkStrategyConfig skip logic**: When `strategy_config_id` is already set on the run (pre-selected strategy), skips auto-creation and only updates aggregates via RPC
- Created `hallOfFame.test.ts` — 7 tests, all pass:
  - Feeds top 3 when prompt_id linked
  - Skips when no topic resolves
  - Handles < 3 variants
  - Skips when pool empty
  - Pipeline type minimal/full tracking
  - Pre-linked strategy skips auto-creation
- All existing pipeline tests (25) still pass
- tsc, lint, build all pass

### Issues Encountered
- None.

## Phase 5: Unified Dimensional Explorer
### Work Done
- Created `src/lib/services/unifiedExplorerActions.ts` with 4 server actions:
  - `getUnifiedExplorerAction` — Table mode with 3 units of analysis:
    - **Run view**: filtered runs with prompt/strategy label enrichment, aggregation bar
    - **Article view**: all variants (not just bank), hall-of-fame rank enrichment, content preview
    - **Task view**: per-agent metrics with prompt text enrichment, sorted by elo_per_dollar
  - `getExplorerMatrixAction` — Pivot grid with row × column dimensions:
    - Supports all dimension pairs (prompt, strategy, pipelineType, agent), constraint rowDim ≠ colDim
    - 5 metrics: avgElo, totalCost, runCount, avgEloDollar, successRate
    - Sparse cells — only combinations with data returned
  - `getExplorerTrendAction` — Time-series with dimension grouping:
    - Day/week/month bucketing via `truncateToTimeBucket`
    - Top 10 dimension values + "Other" aggregation
    - All 5 metrics supported per time bucket
  - `getExplorerArticleDetailAction` — Lazy-loaded article expansion:
    - Full content, parent content, lineage chain (walks parent chain, max 10 depth)
- Attribute filter resolution (`resolveAttributeFilters`):
  - difficultyTiers → prompt IDs via `.in('difficulty_tier', tiers)`
  - domainTags → prompt IDs via `.overlaps('domain_tags', tags)`
  - models → strategy IDs via in-memory filter on config JSONB
  - budgetRange → strategy IDs via min/max budget filter
  - Attribute + entity filters compose via `intersectIds` (AND intersection)
- All filter values use parameterized Supabase queries (no string interpolation)
- Created `unifiedExplorerActions.test.ts` — 15 tests, all pass:
  - Run/article/task view results, empty results, DB errors
  - Hall-of-fame rank enrichment in article view
  - Matrix: prompt × strategy cells, rowDim ≠ colDim guard, empty data
  - Trend: time series grouping, top-10 + Other aggregation, empty data
  - Article detail: lineage chain, not-found case
  - Attribute filter resolution (difficulty tier)
- tsc, lint, build all pass

### Issues Encountered
- 5 `let` → `const` lint errors (variables assigned once in conditional blocks but never reassigned) — quick fix.

## Phase 6: Enforcement + Iteration Loop
### Work Done
- **Run trigger contract update** in `evolutionActions.ts`:
  - `queueEvolutionRunAction` now accepts `{ explanationId?, promptId?, strategyId?, budgetCapUsd? }`
  - Validates `promptId` against `article_bank_topics` (active, not deleted)
  - Validates `strategyId` against `strategy_configs`
  - Uses strategy's `budgetCapUsd` as default when no explicit override provided
  - Requires at least `explanationId` or `promptId` (guard against completely empty input)
  - Fully backward compatible: existing callers passing `{ explanationId }` continue to work
- **NOT NULL enforcement migration** `20260207000008_enforce_not_null.sql`:
  - Safety gate: aborts with clear error if backfill incomplete (NULL FKs on completed runs) or queue not drained (in-flight runs)
  - Only applied after all migration, backfill, and drain prerequisites are met
  - Sets `prompt_id` and `strategy_config_id` to NOT NULL
- Created `runTriggerContract.test.ts` — 7 tests, all pass:
  - Backward compat with explanationId only
  - Prompt + strategy validation (accept valid, reject non-existent)
  - Required field guard
  - Strategy budget cap fallback
  - Explicit budget override
- tsc, lint, build all pass
- **All 113 tests pass across 7 test suites**

### Issues Encountered
- Wrong mock path for `logAdminAction` — it's in `auditLog.ts` not `adminLogging.ts`. Quick fix.

## Post-Review Gap Fixes
### Work Done (from 4-agent review findings)
- **Added `updateStrategyAction`** to strategyRegistryActions.ts:
  - Partial update of label, description, config, pipelineType
  - Guard: only `is_predefined = true` strategies can be edited
  - Config hash collision detection (rejects if new hash collides with another row)
  - Version-on-edit: if config changed and `run_count > 0`, archives old row and creates new version
  - Updates in place when zero runs or no config change
- **Added config JSONB prompt matching** as first strategy in autoLinkPrompt (pipeline.ts):
  - Reads `content_evolution_runs.config` JSONB column for a `prompt` field
  - Case-insensitive match against `article_bank_topics.prompt`
  - Inserted before existing bank-entry and explanation-title strategies (3 strategies total now)
- **Added 7 new tests for updateStrategyAction** in strategyRegistryActions.test.ts (25 total)
- **Added autoLinkPrompt config JSONB test** in hallOfFame.test.ts (8 total)
- **Created backfill-prompt-ids.test.ts** — 6 tests covering both strategies, idempotency, error handling
- tsc, lint, build all pass
- **All 127 tests pass across 8 test suites**

### Issues Encountered
- None.

## Summary
All 6 phases implemented + post-review gap fixes. Total deliverables:
- **8 SQL migrations** (000001–000008)
- **4 new server action files**: promptRegistryActions, strategyRegistryActions, unifiedExplorerActions, (+ updates to evolutionActions)
- **1 backfill script**: scripts/backfill-prompt-ids.ts
- **8 test files**: 127 tests total, all passing
- **Pipeline core updates**: feedHallOfFame, pipeline_type tracking, linkStrategyConfig skip logic, autoLinkPrompt (3-strategy config JSONB + bank entry + explanation title)
- **Type updates**: PipelineType, PromptMetadata, StrategyConfigRow extensions, EvolutionRun extensions
