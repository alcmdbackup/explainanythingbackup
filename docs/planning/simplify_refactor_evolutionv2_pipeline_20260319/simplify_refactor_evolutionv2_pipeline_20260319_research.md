# Simplify Refactor Evolutionv2 Pipeline Research

## Problem Statement
Look for opportunities to further simplify and refactor our evolution V2 pipeline, which is already very different from our old V1 pipeline.

## Requirements (from GH Issue #740)
Look for ways to streamline and simplify our evolution V2 pipeline.

## High Level Summary

**Verified after rebase onto latest main (includes 10K LOC admin UI PR).**

The evolution module totals ~27K LOC (17.6K production + 9.4K test). The V2 pipeline (~2,507 LOC in `evolution/src/lib/v2/`) is the **sole production pipeline**. V1 core/ retains ~1,648 LOC, of which ~247 LOC is definitively dead and another ~400 LOC is only alive because the runner uses V1 wrappers that double-wrap V2 internals (a key simplification opportunity).

**Four categories of work identified:**
1. **Dead code removal** — Delete dead V1 files, dead types, dead features, dead service (~500+ LOC)
2. **Runner V1→V2 migration** — Replace V1 costTracker/llmClient/logger in runner with raw provider pattern, making V2 fully self-contained
3. **Service consolidation** — Merge duplicated arena/prompt actions, extract shared query helpers (~335 LOC savings)
4. **V2 code simplification** — Extract phase executor, share prompt templates, merge cost functions (~120-140 LOC savings)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/visualization.md

## Code Files Read (via 24 research agents, 6 rounds — 3 initial + 3 verification)

### V2 Pipeline Core (2,507 LOC — all UNCHANGED after rebase)
- `evolution/src/lib/v2/evolve-article.ts` (320 LOC) — Main orchestration loop
- `evolution/src/lib/v2/rank.ts` (609 LOC) — Triage + Swiss fine-ranking (largest module)
- `evolution/src/lib/v2/generate.ts` (117 LOC) — Variant generation
- `evolution/src/lib/v2/evolve.ts` (163 LOC) — Mutation/crossover
- `evolution/src/lib/v2/runner.ts` (196 LOC) — Run lifecycle (minor defensive changes post-rebase)
- `evolution/src/lib/v2/finalize.ts` (204 LOC) — DB persistence
- `evolution/src/lib/v2/arena.ts` (114 LOC) — Arena integration
- `evolution/src/lib/v2/cost-tracker.ts` (71 LOC) — Budget tracking
- `evolution/src/lib/v2/llm-client.ts` (135 LOC) — LLM wrapper with retry
- `evolution/src/lib/v2/invocations.ts` (72 LOC) — Agent invocation tracking
- `evolution/src/lib/v2/run-logger.ts` (57 LOC) — Structured logging
- `evolution/src/lib/v2/seed-article.ts` (83 LOC) — Seed article generation
- `evolution/src/lib/v2/strategy.ts` (45 LOC) — Strategy config helpers
- `evolution/src/lib/v2/types.ts` (63 LOC) — V2-specific types
- `evolution/src/lib/v2/index.ts` (99 LOC) — Barrel exports

### V1 Core (1,648 LOC — dead code audit, VERIFIED post-rebase)
- `core/costTracker.ts` — LIVE (used by runner, but V2 has own equivalent; runner double-wraps)
- `core/llmClient.ts` — LIVE (used by runner, but creates V1 client passed to V2 which re-wraps)
- `core/logger.ts` — LIVE (used by runner, but V2 creates own logger internally)
- `core/costEstimator.ts` — **DEAD** (only re-exported, never imported)
- `core/configValidation.ts` — **DEAD** (only re-exported, never imported)
- `core/validation.ts` — **DEAD** (not even re-exported, zero imports)
- `core/agentToggle.ts` — **DEAD** (only re-exported, never imported)
- `core/budgetRedistribution.ts` — **DEAD** (only consumers are dead costEstimator + agentToggle)
- `core/strategyConfig.ts` — PARTIALLY LIVE (types imported by dead `strategyFormUtils.ts`; V2 has own implementation)
- `core/seedArticle.ts` — **DEAD** (zero imports found in verification)
- `core/jsonParser.ts` — **DEAD** (zero imports found in verification)
- `config.ts` — LIVE (resolveConfig used by runner)

### Shared Utilities (V1-defined, V2-consumed, ~585 LOC — VERIFIED V2-only)
- `core/rating.ts` (69 LOC) — OpenSkill rating math, 15 references
- `comparison.ts` (146 LOC) — Pairwise comparison with bias mitigation
- `core/reversalComparison.ts` (40 LOC) — 2-pass reversal logic
- `core/comparisonCache.ts` (96 LOC) — Match result caching
- `agents/formatValidator.ts` (90 LOC) — Format validation
- `agents/formatRules.ts` (9 LOC) — Static format rules
- `core/textVariationFactory.ts` (27 LOC) — TextVariation creation
- `core/errorClassification.ts` (44 LOC) — Transient error detection
All confirmed: zero admin UI imports, V2-only consumers.

### Services (2,451 LOC — **7 NEW files added by admin UI PR**)
**New (all pure V2, zero V1 deps):**
- `evolutionActions.ts` (476 LOC) — Runs, variants, logs, cost breakdown, kill
- `strategyRegistryActionsV2.ts` (231 LOC) — Strategy CRUD
- `variantDetailActions.ts` (207 LOC) — Variant detail, lineage chain
- `arenaActions.ts` (202 LOC) — Arena topics, entries, comparisons
- `evolutionVisualizationActions.ts` (172 LOC) — Dashboard metrics
- `promptRegistryActionsV2.ts` (164 LOC) — Prompt CRUD (**duplicates arenaActions on same table**)
- `invocationActions.ts` (87 LOC) — Invocation listing

**Existing:**
- `evolutionRunnerCore.ts` (137 LOC) — CRITICAL, unchanged
- `experimentActionsV2.ts` (127 LOC) — Experiment CRUD
- `costAnalytics.ts` (501 LOC) — Cost analytics
- `adminAction.ts` (65 LOC) — Action factory
- `evolutionRunClient.ts` (57 LOC) — **DEAD** (never imported by UI)
- `shared.ts` (25 LOC) — Utilities

### Admin UI Pages (3,435 LOC — NEW)
- 16 routes across runs, strategies, prompts, arena, experiments, variants, invocations
- All import exclusively from V2 services, zero V1 dependencies

### UI Components (3,445 LOC — mix of new and existing)
- Shared components: RegistryPage, EntityListPage, EntityTable, RunsTable, FormDialog, etc.

### Types & Config (1,093 LOC)
- `types.ts` (835 LOC) — Mixed V1/V2 types, UNCHANGED post-rebase
- `config.ts` (91 LOC) — Config defaults, LIVE
- Barrel `index.ts` — 6 unused type exports identified

## Key Findings (VERIFIED post-rebase)

### 1. V2 Is Sole Production Pipeline ✓ CONFIRMED
No changes. V1 pipeline fully deleted. All admin UI, API triggers, and batch runners use V2 exclusively.

### 2. Dead V1 Files — Safe to Delete ✓ CONFIRMED
**Files with zero production imports (safe to delete with their tests):**
- `core/validation.ts` + test
- `core/configValidation.ts` + test
- `core/costEstimator.ts` + test
- `core/agentToggle.ts`
- `core/budgetRedistribution.ts` + test (cascade: only consumers are dead files above)
- `core/seedArticle.ts` + test (zero imports confirmed in verification)
- `core/jsonParser.ts` + test (zero imports confirmed in verification)
- `services/evolutionRunClient.ts` + test
- `strategies/strategyFormUtils.ts` (imports V1 types but functions never called)

### 3. Runner Double-Wrapping — NEW FINDING
**Critical discovery:** `evolutionRunnerCore.ts` creates V1 costTracker + V1 logger + V1 llmClient, wraps the llmClient in a thin provider, passes it to `executeV2Run()`, which internally creates V2 costTracker + V2 llmClient. **Two cost trackers exist simultaneously; the V1 one is never used by V2.**

**Fix:** Replace all V1 imports in runner with a simple raw LLM provider function. V2 already handles cost tracking, logging, and LLM wrapping internally. This would:
- Eliminate V1 costTracker, llmClient, logger imports from runner
- Make `core/costTracker.ts`, `core/llmClient.ts`, `core/logger.ts` deletable
- Make V2 fully self-contained

### 4. Service Duplication — NEW FINDING
**arenaActions.ts + promptRegistryActionsV2.ts both CRUD the same `evolution_arena_topics` table.** Overlap:
- List: both have list/get actions
- Create: both insert into same table
- Archive: both update status='archived'
- promptRegistry has UPDATE + DELETE that arena lacks

**Other service patterns to extract:**
- Batch enrichment pattern repeated 8+ times (~40 LOC savings)
- Pagination + filtering pattern repeated 6+ times (~60 LOC savings)
- UUID validation done manually 30+ times (should use Zod)
- Variant lineage chain uses N+1 queries (should use recursive CTE)

### 5. types.ts Dead Types ✓ CONFIRMED
Still removable: CalibrationExecutionDetail, TournamentExecutionDetail, RankingExecutionDetail, 'calibration'/'tournament' in AgentName union. No new references from admin UI.

### 6. Dead Features ✓ CONFIRMED
- **agentModels** — Still dead, no new UI
- **singleArticle mode** — Still dead, no V2 implementation
- **TreeSearch agent** — Still no implementation file

### 7. V2 Code Simplification ✓ CONFIRMED (all files UNCHANGED)
All previously identified opportunities remain valid:
- evolve-article.ts: 3x duplicated phase error handling → extract `executePhase()` helper
- rank.ts: duplicated triage/fine-ranking rating update logic
- generate.ts + evolve.ts: 7 prompt templates with 60-80% boilerplate → share via `prompts.ts`
- llm-client.ts: duplicate cost estimation functions → merge
- finalize.ts: double-loop strategy aggregation → single reduce pass

### 8. Admin UI Component Duplication — NEW FINDING
- StatusBadge + STATE_BADGES defined 3 times across experiment components
- MetricCard component duplicated 3 times with minor variations
- 14 identical error.tsx files (11-12 LOC each)
- Detail page loading pattern repeated 7 times → extract `useDetailPageLoad` hook

### 9. Barrel Export Cleanup
Main `index.ts` has 6 unused type exports: PipelinePhase, GenerationStep, GenerationStepName, DiffMetrics, EloAttribution, AgentAttribution.

### 10. Documentation Significantly Outdated
**High priority:**
- `cost_optimization.md` references ExecutionContext, checkpoint/restore, claims 11 agents (V2 has 3 operations)
- `data_model.md` uses V1 agent names in lineage examples, references EXPANSION phase
**Medium priority:**
- `reference.md` has outdated code examples
- `visualization.md` doesn't describe the new admin UI

## Open Questions (RESOLVED)

1. **Runner V1 imports** — RESOLVED: Should be eliminated. V2 internally creates its own cost tracker/logger. Runner should just pass a raw LLM provider.
2. **strategyConfig.ts** — RESOLVED: Admin UI imports types from it via `strategyFormUtils.ts`, but `strategyFormUtils.ts` functions are never called (dead code). Can be deleted after removing that file.
3. **config.ts resolveConfig** — Still LIVE, used by runner. Could move into V2 but low priority.
4. **Scope boundary** — Docs updates should happen in this project where they're directly impacted by code changes. Major doc rewrites can be deferred to /finalize.
5. **budgetRedistribution.ts** — RESOLVED: Only consumers are dead costEstimator + agentToggle. Safe to delete in cascade.

## Quantified Impact Summary

| Category | LOC Savings | Effort | Risk |
|----------|-------------|--------|------|
| Delete dead V1 files + tests | ~500 | Low | Zero |
| Runner V1→V2 migration | ~100 (net, after adding raw provider) | Medium | Low |
| Merge arena/prompt services | ~150 | Low | Low |
| Extract service query helpers | ~100 | Low | Low |
| V2 code simplification | ~120-140 | Medium | Low |
| Types cleanup | ~80 | Low | Low |
| Barrel export cleanup | ~10 | Trivial | Zero |
| Admin UI component dedup | ~200 | Low | Low |
| **Total** | **~1,260-1,280** | **~3-5 days** | **Low** |
