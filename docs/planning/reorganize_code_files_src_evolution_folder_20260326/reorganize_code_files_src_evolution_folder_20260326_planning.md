# Reorganize Code Files Src Evolution Folder Plan

## Background
Reorganize the files in the evolution folder for better organization and maintainability. The current file structure has grown organically and needs a clearer layout with better module boundaries. Also consolidate misplaced evolution docs from `docs/` into `evolution/docs/`.

## Requirements (from GH Issue #TBD)
1. Reorganize `components/evolution/` — split 49 root files into logical subdirectories
2. Consolidate `EvolutionStatusBadge` and `StatusBadge` into a single unified component using theme variables
3. Move misplaced evolution docs from `docs/feature_deep_dives/` into `evolution/docs/`
4. Fix barrel exports (metrics, pipeline) to act as stable API layer
5. Minor lib/ cleanup: move 2 misplaced utils, clarify ops/ naming
6. Leave `lib/core/` as-is (well-structured framework-vs-implementation split)
7. Services stay flat (13 files is manageable, zero cross-deps)
8. File consolidation: delete deprecated code, merge tiny files, inline single-use components

## Problem
The evolution `components/evolution/` directory has 49 files at root level mixing page shells, tables, primitives, visualizations, dialogs, and context providers. Two overlapping status badge components (`EvolutionStatusBadge` using theme variables, `StatusBadge` using raw Tailwind classes) cause confusion. Two evolution-specific docs are misplaced in `docs/feature_deep_dives/` instead of `evolution/docs/`. Barrel exports for metrics and pipeline are underutilized with missing exports, making internal reorganization riskier than necessary.

## Options Considered
- [x] **Option A: Subdirectory grouping for components**: Split into tables/, sections/, primitives/, visualizations/, dialogs/, context/ — clear mental model, reduces root from 49 to ~9 files
- [x] **Option B: Full monorepo extraction**: Separate evolution into its own package — overkill, adds tooling complexity for no benefit
- [x] **Option C: Flat with barrel-only improvement**: Keep files flat, just fix barrels — doesn't solve navigation/discoverability

## Phased Execution Plan

### Phase 0: Prep — Consolidate Badges, Merge/Delete Small Files, Migrate Imports

**Rollback strategy:** Commit after each sub-step group below. Each commit produces a working build. If a step fails, `git reset --hard HEAD~1` reverts to last good state.

#### 0a. Migrate deep-path imports to barrel paths
- [x] Enumerate all direct (non-barrel) imports from `src/app/` into `evolution/src/components/evolution/` — known: 13x `EvolutionErrorBoundary`, 7x `TableSkeleton`, 3x `StatusBadge`, 3x `FormDialog`, 2x `ConfirmDialog`
- [x] Migrate direct imports to use barrel where possible (grep for `@evolution/components/evolution/` excluding `/index`)
- [x] **Exception:** 13 `error.tsx` files use `export { default } from '@evolution/components/evolution/EvolutionErrorBoundary'` (Next.js error boundary convention requires default export re-export). These CANNOT migrate to barrel (barrel uses named exports only). Leave these as deep paths for now — they will be updated to the new path in Phase 1.
- [x] Note: `lib/metrics/index.ts` and `lib/pipeline/index.ts` already export all needed items (verified) — no barrel additions needed there
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

#### 0b. Consolidate StatusBadge
- [x] Merge `StatusBadge.tsx` into `EvolutionStatusBadge.tsx` → unified `StatusBadge.tsx` supporting all 7 badge variants (`run-status`, `entity-status`, `pipeline-type`, `generation-method`, `invocation-status`, `experiment-status`, `winner`) using CSS custom properties (theme variables) instead of raw Tailwind classes. Keep `outlined` style and pulse dot features from old StatusBadge.
- [x] Write unified `StatusBadge.test.tsx` covering all 7 variants, outlined style, and pulse dot
- [x] Update all imports from old `StatusBadge`/`EvolutionStatusBadge` → new unified `StatusBadge`
- [x] Delete old `EvolutionStatusBadge.tsx` and `EvolutionStatusBadge.test.tsx`
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

#### 0c. Delete dead/deprecated code
- [x] Delete `components/evolution/ElapsedTime.tsx` + `ElapsedTime.test.tsx` (zero importers outside barrel — dead code, not single-use)
- [x] Delete `components/evolution/EloSparkline.tsx` + `EloSparkline.test.tsx` (zero importers outside barrel — dead code, not single-use)
- [x] Remove `ElapsedTime` and `EloSparkline` from barrel `index.ts`
- [x] Delete deprecated `experiments/evolution/analysis.ts` + `analysis.test.ts` (zero importers, replaced by experimentMetrics.ts)
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

#### 0d. Merge tiny files
- [x] Merge `lib/pipeline/infra/errors.ts` (14 lines, 1 class) → `lib/types.ts`; delete `errors.ts`; merge `errors.test.ts` into existing types test or delete if covered
- [x] Merge `lib/ops/orphanedReservations.ts` (8 lines, 1 function) → `lib/ops/watchdog.ts`; merge test accordingly
- [x] Merge `lib/metrics/computations/execution.ts` (11 lines, 2 functions) → `lib/metrics/computations/finalization.ts`; merge `execution.test.ts` into `finalization.test.ts`
- [x] Inline `lib/core/agentMetrics.ts` (24 lines) → `computeFormatRejectionRate` into `agents/GenerationAgent.ts`, `computeTotalComparisons` into `agents/RankingAgent.ts`; delete `agentMetrics.ts`
- [x] Update all affected imports
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

#### 0e. Move misplaced files
- [x] Move `experiments/evolution/experimentMetrics.ts` + test → `lib/metrics/experimentMetrics.ts` (metrics logic, not experiment config)
- [x] Move `config/promptBankConfig.ts` + test → `lib/config/promptBankConfig.ts` (eliminate orphan `config/` directory)
- [x] Move `pipeline/__tests__/rankPartialResults.test.ts` → colocate in `pipeline/loop/` (orphan test dir)
- [x] Update all affected imports
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

### Phase 1: Component Subdirectories

**Rollback strategy:** Single commit for all moves. If `tsc` fails, `git reset --hard HEAD~1`.

- [x] Create subdirectories: `tables/`, `sections/`, `primitives/`, `visualizations/`, `dialogs/`, `context/`
- [x] Move files (with colocated tests) per grouping table:
  - `tables/`: EntityTable, RunsTable, TableSkeleton
  - `sections/`: EntityDetailHeader, EntityDetailTabs + useTabState (keep colocated — tightly coupled), InputArticleSection, VariantDetailPanel
  - `primitives/`: StatusBadge (unified), MetricGrid, EmptyState, NotFoundCard, EvolutionBreadcrumb
  - `visualizations/`: LineageGraph, TextDiff, VariantCard
  - `dialogs/`: FormDialog, ConfirmDialog
  - `context/`: AutoRefreshProvider
- [x] **Remaining at root** (page-level shells, not UI primitives): `EntityDetailPageClient.tsx`, `EntityListPage.tsx`, `EvolutionErrorBoundary.tsx`, `index.ts`
- [x] **Existing subdirectories unchanged:** `tabs/`, `variant/`, `agentDetails/` — already well-organized, their direct imports are unaffected by root-level moves
- [x] Update barrel `index.ts` to import from new subdirectory paths
- [x] Update 13 `error.tsx` deep imports: `@evolution/components/evolution/EvolutionErrorBoundary` paths are unchanged (file stays at root)
- [x] Update any remaining direct (non-barrel) imports that weren't migrated in Phase 0a
- [x] Verify internal cross-imports within components (e.g., RunsTable imports TableSkeleton/EmptyState — update relative paths)
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

### Phase 2: Minor lib/ Cleanup

**Rollback strategy:** Single commit. `git reset --hard HEAD~1` if needed.

- [x] Move `lib/utils/frictionSpots.ts` + test → `lib/pipeline/loop/frictionSpots.ts`
- [x] Move `lib/utils/metaFeedback.ts` + test → `lib/pipeline/loop/metaFeedback.ts`
- [x] Rename `lib/ops/` → `lib/maintenance/` (includes watchdog + merged orphanedReservations)
- [x] Update all imports
- [x] Run `tsc --noEmit`, lint, build, unit tests; commit

### Phase 3: Doc Consolidation
- [x] Move `docs/feature_deep_dives/evolution_logging.md` → `evolution/docs/logging.md`
- [x] Merge `docs/feature_deep_dives/evolution_metrics.md` stub into existing `evolution/docs/metrics.md` (or delete stub)
- [x] Update `evolution/docs/README.md` to reference new `logging.md`
- [x] Update any cross-references in `docs/docs_overall/` pointing to old paths
- [x] Update `_status.json` relevantDocs paths

### Phase 4: Verify & Clean Up
- [x] Run full test suite: unit, integration, E2E
- [x] Verify `npm run test:integration:evolution` pattern still works
- [x] Verify `npm run test:v1-regression` pattern still works — confirm `execution.test.ts` coverage migrated to `finalization.test.ts` is still matched
- [x] Audit dynamic imports: `grep -r "await import\|require(" --include='*.ts' --include='*.tsx' evolution/src/` — verify each resolves after moves
- [x] Update `.claude/doc-mapping.json` if doc paths changed
- [x] Update `package.json` test script patterns if `evolution/src/lib/` paths shifted

## Testing

### Unit Tests
- [x] `evolution/src/components/evolution/primitives/StatusBadge.test.tsx` — unified badge renders all 7 variants, respects theme variables, supports outlined + pulse dot
- [x] Deleted test files: `ElapsedTime.test.tsx`, `EloSparkline.test.tsx`, `analysis.test.ts`, `errors.test.ts` (or merged), `execution.test.ts` (merged into finalization.test.ts), `orphanedReservations.test.ts` (merged into watchdog.test.ts)
- [x] All existing colocated component tests pass from new subdirectory paths
- [x] All existing lib/ tests pass after utils move and file merges

### Integration Tests
- [x] Existing integration tests pass without changes (use `@evolution/` aliases)

### E2E Tests
- [x] Evolution admin pages render correctly with reorganized components (tag-based `@evolution` filtering)

### Manual Verification
- [x] Verify status badges render correctly across all evolution admin pages (runs, experiments, strategies, arena, invocations)

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run `npx playwright test --grep @evolution` — all evolution admin page specs pass
- [x] Visual check: status badges on runs list page show correct colors/icons/pulse

### B) Automated Tests
- [x] `npm run test` — all unit tests pass
- [x] `npm run test:integration:evolution` — all integration tests pass
- [x] `npm run build` — production build succeeds
- [x] `tsc --noEmit` — no type errors

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/evolution_logging.md` — move to `evolution/docs/logging.md`
- [x] `docs/feature_deep_dives/evolution_metrics.md` — merge into `evolution/docs/metrics.md` or delete
- [x] `evolution/docs/README.md` — add logging.md reference
- [x] `evolution/docs/reference.md` — update file paths if any referenced files move
- [x] `evolution/docs/visualization.md` — update component paths if referenced

## Review & Discussion

### Iteration 1 (3 agents, all scored 3/5)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 2 gaps |
| Architecture & Integration | 3/5 | 3 gaps |
| Testing & CI/CD | 3/5 | 3 gaps |

**Critical gaps found and resolved:**
1. **ElapsedTime & EloSparkline are dead code** — Research incorrectly identified as "single importer". Both have zero consumers outside barrel+tests. **Fix:** Changed from "inline" to "delete" in Phase 0c.
2. **Barrel exports already fixed** — `lib/metrics/index.ts` and `lib/pipeline/index.ts` already export all needed items. **Fix:** Removed stale "add missing exports" tasks, added note that barrels are verified current.
3. **EvolutionErrorBoundary missing from plan** — Imported directly by ~12 error.tsx files, not in barrel. **Fix:** Added to Phase 0a (add to barrel + migrate imports) and Phase 1 (move to primitives/).
4. **Test files for deleted/merged components not addressed** — **Fix:** Added explicit list of deleted/merged test files to Testing section, and explicit test merge steps in Phase 0d.
5. **No rollback plan** — **Fix:** Added rollback strategy per phase (commit after each sub-step group, `git reset --hard HEAD~1` to revert).

**Additional minor fixes applied:**
- Phase 0 split into sub-steps (0a-0e) with commit boundaries
- useTabState kept colocated with EntityDetailTabs in sections/
- Phase 4 dynamic import audit now has explicit grep command
- Phase 4 now checks package.json test patterns and v1-regression coverage

### Iteration 2 (3 agents: Security 4/5, Architecture 4/5, Testing 4/5)

**Critical gaps found and resolved:**
1. **EvolutionErrorBoundary default export can't barrel-migrate** — 13 error.tsx files use `export { default }` (Next.js convention). **Fix:** Removed barrel-migration for this component, added explicit exception note in Phase 0a. error.tsx files keep deep paths (unchanged since file stays at root).
2. **Existing subdirectories unaccounted for** — tabs/, variant/, agentDetails/ with 11 components never mentioned. **Fix:** Added explicit "Existing subdirectories unchanged" note to Phase 1.
3. **EvolutionErrorBoundary misplaced in primitives/** — It's a page-level error boundary, not a UI atom. **Fix:** Moved to "Remaining at root" alongside EntityDetailPageClient and EntityListPage. 13 error.tsx deep paths now need no update at all.

### Iteration 3 — CONSENSUS REACHED (5/5 all agents)

| Perspective | Score |
|-------------|-------|
| Security & Technical | 5/5 |
| Architecture & Integration | 5/5 |
| Testing & CI/CD | 5/5 |

**Minor notes from final review (non-blocking):**
- NotFoundCard.tsx has no colocated test — accept or add test during Phase 1
- Phase 0d rankPartialResults.test.ts imports from errors.ts — must update in 0d before moving in 0e
- useTabState.test.tsx is the file that moves with EntityDetailTabs (useTabState itself is defined inside EntityDetailTabs.tsx)
- Phase 1 "Update 13 error.tsx deep imports" is a no-op since EvolutionErrorBoundary stays at root — can remove that line during execution
