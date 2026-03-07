# Docs Update Evolution Plan

## Background
Update all 16 evolution pipeline documentation files to ensure they accurately reflect the current codebase. Additionally, deprecate all references to the L8 orthogonal array / Taguchi fractional factorial experimentation system, as the project has switched to a manual experimentation approach.

## Requirements (from GH Issue #649)
- Update all 16 evolution docs (under `evolution/docs/evolution/`) to match current codebase state
- Deprecate L8/Taguchi fractional factorial experimentation references in `strategy_experiments.md`
- Update `strategy_experiments.md` to reflect the manual experimentation system
- Update any cross-references to L8 experimentation in other evolution docs (architecture.md, reference.md, cost_optimization.md, etc.)
- Ensure all file paths, test counts, migration lists, and configuration values are current
- Verify all cross-doc links are valid

## Problem
7 rounds of research (28 agents) identified 75+ discrepancies across all 16 evolution docs. The L8 Taguchi fractional factorial experiment system was fully replaced by a manual experiment system (Mar 4-5, 2026), but `strategy_experiments.md` still documents the old L8 system entirely. Per-agent budget caps were deprecated (global-only enforcement now), plateau/degenerate stopping conditions were removed, and 10+ referenced files no longer exist. Multiple cross-doc links are broken, test counts are outdated, server action counts are wrong, and 6+ new admin pages are undocumented.

## Options Considered

### Option A: Surgical fixes only
Fix only the specific discrepancies found in research. Minimal risk, but may leave docs inconsistent in tone/structure.

### Option B: Full rewrite of affected sections (CHOSEN)
For each doc, read it alongside the code, fix all identified discrepancies, and ensure internal consistency. Rewrite `strategy_experiments.md` entirely for manual experiments. Remove references to non-existent files rather than creating placeholder docs.

### Option C: Full rewrite of all 16 docs
Rewrite every doc from scratch. Highest quality but unnecessary — many docs are largely accurate and only need targeted updates.

## Decisions on Open Questions

1. **strategy_experiments.md** → Full rewrite for manual experiments. Mark L8 as deprecated in a brief "Legacy" section at the bottom.
2. **Removed article/ components** → Remove from docs (they were deleted from codebase, not coming back).
3. **adaptiveAllocation.ts** → Remove all references (never implemented).
4. **hall_of_fame.md** → Don't create. Fix broken link in generation.md to point to `arena.md`.
5. **article_detail_view.md** → Don't create. Remove broken link from README.md.

## Phased Execution Plan

### Phase 1: Critical fixes — Broken links, non-existent files, corrupted anchors
**Scope:** Fix all cross-doc links and references to non-existent files. These are the most visible issues.

**Files to edit:**
- `editing.md` line 9 — Fix corrupted anchor link (repeated "diffcomparisontsdiffcomparison...")
- `generation.md` line 179 — Change `../hall_of_fame.md` → `../arena.md`
- `README.md` line 26 — Remove broken link to `article_detail_view.md`
- `README.md` lines 31-48 — Add `entity_diagram.md` and `strategy_experiments.md` to Document Map
- `architecture.md` — Change `hallOfFameIntegration.ts` → `arenaIntegration.ts`
- `data_model.md` line 61 — Change `unifiedExplorerActions.ts` → `evolutionVisualizationActions.ts`
- `reference.md` — Remove references to non-existent files (articleDetailActions.ts, evolutionBatchActions.ts, llmSemaphore.ts, run-strategy-experiment.ts)
- `reference.md` — Remove article detail page route reference
- `visualization.md` — Remove 4 non-existent article/ components

**Commit:** `docs: fix broken links and remove references to non-existent files`

### Phase 2: Strategy experiments rewrite (L8 → Manual)
**Scope:** Rewrite `strategy_experiments.md` for manual experiment system. Update L8 cross-references in other docs.

**Files to edit:**
- `strategy_experiments.md` — Full rewrite:
  - Document manual experiment workflow (create → configure runs → start → cron driver → analysis)
  - Document `createManualExperimentAction()`, `addRunToExperimentAction()`, `startManualExperimentAction()`
  - Document `computeManualAnalysis()` (per-run Elo/cost comparison)
  - Document cron driver state machine (`experiment-driver/route.ts`)
  - Document budget constraints (MAX_RUN_BUDGET_USD=$1.00, MAX_EXPERIMENT_BUDGET_USD=$10.00)
  - Add brief "Legacy: L8/Taguchi System" section at bottom noting deprecation
  - Document new admin pages: `/admin/evolution/experiments`, `/admin/evolution/start-experiment`
- `architecture.md` — Remove/update any L8 experiment references
- `cost_optimization.md` — Remove/update any L8 experiment references
- `reference.md` — Update experiment-related config and file references

**Commit:** `docs: rewrite strategy_experiments.md for manual experiment system`

### Phase 3: Config, stopping conditions, and budget system
**Scope:** Update config values, stopping conditions, and budget documentation across all affected docs.

**Files to edit:**
- `architecture.md`:
  - Update stopping conditions to 3 only (remove plateau, degenerate)
  - Update pipeline.ts LOC (652 → 809)
  - Document FlowCritique special out-of-band dispatch
- `reference.md`:
  - Update `maxIterations` default (15 → 50)
  - Update `budgetCapUsd` to note MAX_RUN_BUDGET_USD=$1.00 hard cap
  - Mark `budgetCaps` as deprecated (not active)
  - Mark `plateau` as deprecated
  - Update auto-clamping formula (remove `plateau.window` reference)
- `cost_optimization.md`:
  - Remove `adaptiveAllocation.ts` references (lines 130, 232, 237)
  - Remove `computeAdaptiveBudgetCaps()` description (lines 128-142)
  - Update `budgetRedistribution.ts` description (gutted, only agent classification)
  - Add MAX_RUN_BUDGET_USD and MAX_EXPERIMENT_BUDGET_USD hard caps
  - Fix "per-agent model overrides not yet wired" → actually functional
  - Document budget event audit log table if not already covered
- `rating_and_comparison.md`:
  - Fix "sequentially" → "concurrently" for run2PassReversal (uses Promise.all)

**Commit:** `docs: update config values, stopping conditions, and budget system`

### Phase 4: Server action counts, test counts, and key files
**Scope:** Update all numerical counts and file inventories.

**Files to edit:**
- `visualization.md` — Update action count 13 → 14, add listInvocationsAction
- `reference.md`:
  - Update evolutionVisualizationActions count (13 → 15)
  - Update evolutionActions count (11 → 10, remove non-existent actions)
  - Update variantDetailActions count (4 → 5, add getVariantLineageChainAction)
  - Add ~25 undocumented files to Key Files section
- `agents/generation.md` — Update test count 16 → 19
- `agents/editing.md`:
  - Update iterativeEditingAgent test count 21 → 35
  - Update sectionDecompositionAgent test count 9 → 12
  - Update parser+stitcher test count 22 → 23
  - Fix ProximityAgent embedding description ("character frequency" → "word-trigram frequency histogram")
- `agents/tree_search.md` — Update test count 17 → 19
- `agents/flow_critique.md`:
  - Document normalizeScore() formula (quality: `(score-1)/9`, flow: `score/5`)
  - Document CROSS_SCALE_MARGIN=0.05
  - Document special out-of-band dispatch handling
- `agents/overview.md` — Clarify "12 agents" vs 13 table rows (FlowCritique is standalone)
- `visualization.md`:
  - Update vis action unit test count 7 → 33
  - Update integration test count 8 → 11
  - Update AutoRefreshProvider test count 6 → 10
  - Update TimelineTab test count 18 → 20
  - Update E2E visualization test count 5 → 7
  - Update variant detail E2E count 9 → 6
  - Update revisionActions test count 12 → 19

**Commit:** `docs: update action counts, test counts, and key files inventory`

### Phase 5: Data model, migrations, and new admin pages
**Scope:** Update migration lists, document new admin pages, fix entity diagram if needed.

**Files to edit:**
- `data_model.md`:
  - Fix migration 12 timestamp (20260222000002 → 20260222100003)
  - Fix migration 13 timestamp (20260222000003 → 20260222100004)
  - Add missing migration 20260304000003_manual_experiment_design.sql
  - Add evolution_budget_events table (migration 20260306000001)
  - Add arena rename migrations (20260221000002, 20260303000005)
- `arena.md` line 108 — Fix migration filename (20260303000001 → 20260303000005)
- `visualization.md`:
  - Document 6 new admin pages (Strategy Registry, Prompt Registry, Invocations, Variants, Experiments, Start Experiment)
  - Document 3 new components (RunsTable.tsx, ElapsedTime.tsx, EvolutionBreadcrumb.tsx)
  - Document run detail enhancements (budget bar, ETA, phase indicator)
  - Document analysis page additions (RecommendedStrategyCard, Pareto chart)
- `entity_diagram.md` — Verify ER diagram still accurate (Round 6 confirmed it is)

**Commit:** `docs: update migrations, document new admin pages and components`

### Phase 6: Instructions for updating + final cross-doc verification
**Scope:** Fix the meta-documentation and do a final link verification pass.

**Files to edit:**
- `docs/docs_overall/instructions_for_updating.md`:
  - Update file count 13 → 16
  - Remove `hall_of_fame.md` from list
  - Add `entity_diagram.md`, `strategy_experiments.md`, `agents/flow_critique.md`
- Final pass: grep all evolution docs for remaining "hall of fame", "Hall of Fame", "L8", "factorial", "Taguchi" references and fix any stragglers
- Final pass: verify all cross-doc links resolve to actual files

**Commit:** `docs: update instructions_for_updating.md and verify all cross-doc links`

## Testing

This is a docs-only change. No code changes, no tests to write or modify.

**Verification checklist:**
- [ ] All cross-doc links resolve (grep for `](../` and `](./` patterns, verify targets exist)
- [ ] No remaining references to non-existent files (factorial.ts, factorRegistry.ts, hallOfFameIntegration.ts, articleDetailActions.ts, unifiedExplorerActions.ts, adaptiveAllocation.ts, llmSemaphore.ts, evolutionBatchActions.ts)
- [ ] No remaining "Hall of Fame" references (except in Arena rename migration context)
- [ ] No remaining active L8/Taguchi/factorial references (except deprecated legacy section)
- [ ] All test counts match actual test file contents
- [ ] All server action counts match actual exports
- [ ] Config values match `config.ts` defaults
- [ ] Migration list matches actual `supabase/migrations/` directory

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` - Fix broken link, update Document Map
- `evolution/docs/evolution/architecture.md` - Fix file references, stopping conditions, LOC, FlowCritique dispatch
- `evolution/docs/evolution/data_model.md` - Fix file reference, migration timestamps
- `evolution/docs/evolution/rating_and_comparison.md` - Fix concurrent vs sequential
- `evolution/docs/evolution/arena.md` - Fix migration filename
- `evolution/docs/evolution/cost_optimization.md` - Remove adaptive allocation, update budget system
- `evolution/docs/evolution/visualization.md` - Action counts, new pages/components, test counts
- `evolution/docs/evolution/entity_diagram.md` - Verify accuracy (confirmed OK)
- `evolution/docs/evolution/strategy_experiments.md` - Full rewrite for manual experiments
- `evolution/docs/evolution/reference.md` - Config values, file inventory, action counts, deprecated fields
- `evolution/docs/evolution/agents/overview.md` - Clarify agent count
- `evolution/docs/evolution/agents/generation.md` - Fix broken link, test count
- `evolution/docs/evolution/agents/editing.md` - Fix corrupted anchor, test counts, embedding description
- `evolution/docs/evolution/agents/tree_search.md` - Test count
- `evolution/docs/evolution/agents/support.md` - Minor embedding description fix
- `evolution/docs/evolution/agents/flow_critique.md` - normalizeScore formula, CROSS_SCALE_MARGIN, dispatch docs
- `docs/docs_overall/instructions_for_updating.md` - File count, doc list
