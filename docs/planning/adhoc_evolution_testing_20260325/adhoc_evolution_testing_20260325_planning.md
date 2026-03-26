# Adhoc Evolution Testing Plan

## Background
Exploratory testing with 16 parallel Playwright agents found 67 issues across the evolution admin dashboard. This plan fixes the 5 P0 critical bugs and 22 P1 medium issues (bugs + UX).

## Requirements (from GH Issue #826)
- Fix all P0 critical bugs (5 items)
- Fix all P1 medium bugs (9 items) and medium UX issues (13 items)
- Run lint, tsc, build, and unit tests after each phase
- Write unit tests for fixed code

## Problem
The evolution admin dashboard has broken row actions, incorrect cost calculations, field name mismatches, inconsistent error handling, and numerous UX issues that degrade the admin experience.

## Options Considered
1. **Fix all 67 issues** — too large for one project; P2 (accessibility + polish) deferred to a follow-up
2. **Fix P0 only** — leaves many visible UX issues unfixed
3. **Fix P0 + P1** — best balance of impact vs scope (27 fixes across ~20 files)

**Chosen: Option 3** — Fix P0 + P1 (27 items). P2 accessibility and polish tracked separately.

## Phased Execution Plan

### Phase 0: Consolidate EntityListPage + RegistryPage (architectural)

The Entity base class (`evolution/src/lib/core/Entity.ts`) already declares `actions`, `renameField`, `editConfig`, `createConfig`, and `executeAction()` — full CRUD infrastructure. But only Prompts and Strategies pages use it (via `RegistryPage`). The other 5 list pages use `EntityListPage` directly and reimplement ~30 lines of identical state management boilerplate without any action support.

#### Design decisions

**No archive — delete only.** Archive adds complexity (3 different column patterns, cascade ambiguity, filter UX) for little value in an admin tool. All entities support delete with full recursive cascade. Soft-delete can be added later if needed.

**All child cascades are `delete`.** When a parent is deleted, all children are recursively deleted. No nullify, no restrict. This is simple and prevents orphaned data. Entities that currently use `restrict` (Strategy, Prompt) will check for children and show a confirmation with the count before proceeding.

#### Entity action matrix (after Phase 0):

| Entity | Rename | Edit | Create | Delete | Custom |
|--------|--------|------|--------|--------|--------|
| Prompt | Yes | Yes | Yes | Yes (confirm: shows child count) | — |
| Strategy | Yes | Yes | Yes | Yes (confirm: shows child count) | — |
| Run | — | — | — | Yes (cascades: variants, invocations, logs, metrics) | Kill (cancel active) |
| Experiment | Yes | — | — | Yes (cascades: runs → their children) | Cancel (fail active runs via RPC) |
| Variant | — | — | — | Yes (cascades: arena comparisons, metrics) | — |
| Invocation | — | — | — | — (read-only, deleted via run cascade) | — |

#### Delete cascade tree:

```
Delete Prompt
  └─ Delete all Experiments (via prompt_id)
       └─ Delete all Runs (via experiment_id)
            └─ (run cascade below)
  └─ Delete all standalone Runs (via prompt_id, no experiment)
       └─ (run cascade below)

Delete Strategy
  └─ Delete all Runs (via strategy_id)
       └─ (run cascade below)

Delete Experiment
  └─ Delete all Runs (via experiment_id)
       └─ (run cascade below)

Delete Run
  └─ Delete all Variants (via run_id)
       └─ Delete arena_comparisons (entry_a OR entry_b)
       └─ Delete metrics (entity_type='variant', entity_id)
  └─ Delete all Invocations (via run_id)
  └─ Delete all Logs (via run_id)
  └─ Delete metrics (entity_type='run', entity_id)

Delete Variant
  └─ Delete arena_comparisons (entry_a OR entry_b)
  └─ Delete metrics (entity_type='variant', entity_id)
```

**0a. Fix Entity.executeAction('delete') cascade + create generic server action**

**Critical bug in Entity.executeAction('delete')**: The base class checks `restrict` children but **ignores `delete` cascade declarations**. It just does `DELETE FROM table WHERE id = ?` without cleaning up children. Since the DB has no FK CASCADE constraints on most evolution tables, this orphans child rows.

Fix `Entity.ts` executeAction('delete') (lines 134-148):
```ts
if (key === 'delete') {
  // Recursively delete all children first
  for (const child of this.children) {
    const childEntity = getEntity(child.childType);
    const { data: childRows } = await db.from(childEntity.table)
      .select('id').eq(child.foreignKey, id);
    for (const row of childRows ?? []) {
      await childEntity.executeAction('delete', row.id, db);
    }
  }
  // Mark parent metrics stale (they were computed including this entity)
  for (const parent of this.parents) {
    const row = await db.from(this.table).select(parent.foreignKey).eq('id', id).single();
    const parentId = (row.data as Record<string, unknown> | null)?.[parent.foreignKey] as string | undefined;
    if (parentId) {
      await db.from('evolution_metrics')
        .update({ stale: true, updated_at: new Date().toISOString() })
        .eq('entity_type', parent.parentType)
        .eq('entity_id', parentId);
    }
  }
  // Clean up this entity's own metrics (logical FK, no DB cascade)
  await db.from('evolution_metrics')
    .delete()
    .eq('entity_type', this.type)
    .eq('entity_id', id);
  // Clean up logs
  if (this.logQueryColumn) {
    await db.from('evolution_logs')
      .delete()
      .eq(this.logQueryColumn, id);
  }
  await db.from(this.table).delete().eq('id', id);
  return;
}
```

Update all entity child declarations to use `cascade: 'delete'`:
- `ExperimentEntity.ts`: change `{ childType: 'run', foreignKey: 'experiment_id', cascade: 'nullify' }` → `cascade: 'delete'`
- `StrategyEntity.ts`: change `{ childType: 'run', foreignKey: 'strategy_id', cascade: 'restrict' }` → `cascade: 'delete'`
- `PromptEntity.ts`: change both children from `cascade: 'restrict'` → `cascade: 'delete'`

Add `VariantEntity` override for arena comparisons (not a registered entity type):
```ts
async executeAction(key: string, id: string, db: SupabaseClient): Promise<void> {
  if (key === 'delete') {
    await db.from('evolution_arena_comparisons').delete().or(`entry_a.eq.${id},entry_b.eq.${id}`);
  }
  return super.executeAction(key, id, db);
}
```

Remove `archiveColumn`, `archiveValue` from all entity subclasses. Remove archive/unarchive actions from all entities. Remove "Include archived" filter from runs page. Remove `archived` filter from dashboard queries.

**Generic server action**: New `evolution/src/services/entityActions.ts`
- Single `adminAction` that receives `{ entityType, entityId, actionKey, payload? }`, looks up the entity via `getEntity(entityType)`, and calls `entity.executeAction(actionKey, entityId, db, payload)`.
- For delete actions: before executing, count all descendants (recursive) and include in the confirm message so the UI can show "Delete this experiment? This will also delete 3 runs, 12 variants, 8 invocations."
- Unit test: `evolution/src/services/entityActions.test.ts` — mock `getEntity()` and verify routing.

**Integration test**: New `src/__tests__/integration/entity-actions.integration.test.ts`
- Uses real Supabase (service role)
- Seeds test data via existing helpers from `evolution-test-helpers.ts`
- Test matrix:

  | Entity | Action | Verify |
  |--------|--------|--------|
  | Prompt | rename | `name` column updated |
  | Prompt | delete (no children) | row removed |
  | Prompt | delete (with experiment+runs) | prompt, experiment, runs, variants, invocations, logs, metrics all deleted |
  | Prompt | delete (verify no orphans) | query all child tables → 0 rows |
  | Strategy | rename | `name` column updated |
  | Strategy | delete (no children) | row removed |
  | Strategy | delete (with runs) | strategy, runs, variants, invocations, logs, metrics all deleted |
  | Strategy | delete (verify no orphans) | query all child tables → 0 rows |
  | Run | delete | run, variants, invocations, logs, metrics deleted |
  | Run | delete (verify no orphans) | query variants/invocations/logs/metrics → 0 rows |
  | Run | cancel (kill) | `status` → `'cancelled'` |
  | Experiment | rename | `name` column updated |
  | Experiment | cancel | calls `cancel_experiment` RPC, verify child runs failed |
  | Experiment | delete | experiment, runs, variants, invocations, logs, metrics all deleted |
  | Experiment | delete (verify no orphans) | query all child tables → 0 rows |
  | Variant | delete | variant deleted, arena comparisons deleted, metrics deleted |
  | Variant | delete (verify no orphans) | query arena_comparisons → 0 rows |
  | Run | delete (stale parent metrics) | after deleting run, verify strategy metrics have `stale=true` |
  | Run | delete (stale experiment metrics) | after deleting run from experiment, verify experiment metrics have `stale=true` |

- Cleanup: Extend `cleanupEvolutionData()`:
  1. Add `experimentIds?: string[]` to `CleanupOptions`
  2. Add `variantIds?: string[]` to `CleanupOptions`
  3. Add `evolution_metrics` cleanup by `entity_id`
  4. FK-safe order: arena_comparisons → metrics → invocations → logs → variants → runs → experiments → strategies → prompts
- Auto-skip: `evolutionTablesExist()` guard
- Test isolation: Each `describe` block seeds and cleans independently

**0b. Merge RegistryPage's features into EntityListPage**
- Files: `evolution/src/components/evolution/EntityListPage.tsx`, `evolution/src/components/evolution/RegistryPage.tsx`
- Add these optional props to `EntityListPage`:
  - `loadData?: (filters, page, pageSize) => Promise<{ items: T[]; total: number }>` — when provided, EntityListPage manages state internally (items, loading, page, filterValues). When omitted, existing controlled pattern works.
  - `rowActions?: EntityAction<T>[]` — EntityListPage appends an `_actions` column with `skipLink: true` (fixing P0 1a architecturally). Action buttons call `executeEntityAction`. Buttons with `confirm` show ConfirmDialog. Buttons with `danger` get error styling.
  - `headerAction?: { label: string; onClick: () => void }` — renders create button in header.
  - `formDialog?` and `confirmDialog?` — same interface as RegistryPage currently exposes.
  - `breadcrumbs?: Array<{ label: string; href?: string }>` — renders EvolutionBreadcrumb.
  - `onActionComplete?: () => void` — reload callback after action execution.
- Also add `skipLink?: boolean` to `ColumnDef` in `EntityTable.tsx`. When true, the cell renders without the `<Link>` wrapper.
- Delete `RegistryPage.tsx` after migration — it becomes redundant.

**0c. Migrate all 7 list pages to enhanced EntityListPage**
- Each page drops its manual `useState`/`useEffect`/`useCallback` boilerplate and passes `loadData` + `rowActions` instead.
- Pages: runs, experiments, invocations, variants, arena, prompts, strategies.
- Prompts and strategies switch from `RegistryPage` to `EntityListPage`.
- Runs page keeps its `renderTable` (RunsTable) but gains `rowActions` for Kill/Delete.
- Experiments page gains Cancel/Delete actions.
- Variants page gains Delete action.
- Invocations page stays read-only (empty actions array).
- Arena page stays read-only for topics.

### Phase 1: P0 Critical Bugs (4 remaining fixes — 1a is now part of Phase 0)

**Note:** P0 item 1a (row action buttons) is architecturally resolved by Phase 0b (skipLink + action column in EntityListPage).

**1b. Strategy budget field name mismatch**
- File: `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx`
- Fix: Line 27 interface and line 80 conditional — change `budgetCapUsd` to `budgetUsd`. The DB stores V2StrategyConfig (from `schemas.ts:283`) which uses `budgetUsd`. Verified: StrategyConfigDisplay is only rendered with V2StrategyConfig.
- Test: Unit test that config with `budgetUsd: 2.0` renders the budget row.

**1c. Strategy 404 leaks raw DB error**
- File: `evolution/src/services/strategyRegistryActions.ts`
- Fix: Line ~90 — check `error.code === 'PGRST116'` (no rows) → throw `'Strategy not found'`. Other errors → throw `'Failed to load strategy'`.
- Test: Unit test for both error paths.

**1d. Dashboard cost metrics use mismatched populations**
- File: `evolution/src/services/evolutionVisualizationActions.ts`
- **IMPORTANT**: The `evolution_run_costs` view was DROPPED by migration `20260323000004`. Existing code on lines 90 and 118 is already broken.
- Fix: Replace with `evolution_metrics` queries using `entity_type='run'` and `metric_name='cost'`, filtered to the same run population as statusQuery via `.in('entity_id', filteredRunIds)`.
- Test: Unit test + verify `evolution-visualization.integration.test.ts` passes.

**1e. Dashboard Recent Runs hardcodes budget/explanation**
- Files: `src/app/admin/evolution-dashboard/page.tsx`, `evolution/src/services/evolutionVisualizationActions.ts`
- Fix (4 code files + 1 test file):
  1. `evolutionVisualizationActions.ts`: add `budget_cap_usd`, `explanation_id` to recentQuery select + DashboardData type + return mapping
  2. `evolution-dashboard/page.tsx`: replace `budget_cap_usd: 0` → `r.budget_cap_usd ?? 0`, `explanation_id: null` → `r.explanation_id ?? null`
  3. `page.test.tsx`: update mock recentRuns with new fields
- Test: `npx tsc --noEmit` to verify full type chain.

### Phase 2: P1 Medium Bugs (9 fixes)

**2a. "Hide test content" inconsistent on Experiments/Strategies**
- Files: `experiments/page.tsx`, `strategies/page.tsx`
- Fix: Add join-based filtering on strategy name containing `[TEST]`.

**2b. Prompt cross-link shows raw UUID, links to list**
- File: `runs/[runId]/page.tsx`
- Fix: Fetch prompt name via join in `getEvolutionRunByIdAction`. Use prompt name as label, `/admin/evolution/prompts/${prompt_id}` as href.

**2c. Inconsistent 404 handling (runs and arena)**
- Files: `runs/[runId]/page.tsx`, `arena/[topicId]/page.tsx`
- Fix: Create shared `NotFoundCard` component (client-side, can't use `notFound()`). Renders breadcrumb + "Back to Evolution Dashboard" link.

**2d. Duplicate "Runs" column on strategies list**
- File: `strategies/page.tsx`
- Fix: Remove `run_count` from `baseColumns` (already in metric columns).

**2e. Dashboard status counts include archived but Recent Runs doesn't**
- File: `evolutionVisualizationActions.ts`
- Fix: Both queries use the same filter (no archived filter needed since we're removing archive).

**2f. Arena leaderboard null crash risk on mu/sigma**
- File: `arena/[topicId]/page.tsx`
- Fix: Add null guards: `entry.mu != null ? entry.mu.toFixed(1) : 'N/A'`.

**2g. Whitespace-only prompt names accepted**
- File: `arenaActions.ts`
- Fix: `.trim().min(1)` on name field in all 3 prompt schemas.

**2h. Redundant "Experiment" breadcrumb**
- File: `experiments/[experimentId]/page.tsx`
- Fix: Remove `{ label: 'Experiment' }` from breadcrumb items.

### Phase 3: P1 Medium UX (13 fixes)

**3a. Table columns truncated** — Add `overflow-x-auto` wrapper, increase strategy label max-width.

**3b. Experiment name truncated** — Add `min-w-0 flex-shrink-0` + title tooltip.

**3c. Leaderboard rank positional** — Compute Elo-based rank before sorting.

**3d. Default sort always ascending** — Change to `setSortDir('desc')` for new columns.

**3e. Null costs sort to top** — Direction-aware comparator (nulls always last):
```ts
const mult = sortDir === 'desc' ? -1 : 1;
sorted.sort((a, b) => {
  const av = a[sortKey], bv = b[sortKey];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string') return mult * av.localeCompare(bv as string);
  return mult * ((av as number) - (bv as number));
});
```

**3f. Variant preview single-expand** — Change `useState<string | null>` → `useState<Set<string>>`.

**3g. Run detail missing cost metric** — Verify `evolution_metrics` query; show "$0.00" for zero cost.

**3h. No Runs tab on strategy detail** — Add tab using `listEvolutionRunsAction` with `strategy_id` filter.

**3i. Invocations Run ID links to invocation** — Resolved by Phase 0b `skipLink`. Run ID column renders its own `<Link>`.

**3j. Wizard review missing prompt** — Add "Prompt" row to review summary.

**3k. Wizard stepper not clickable** — Make completed labels clickable: `onClick={() => setStep(i)}`.

**3l. Logs context disconnected** — Render inline `<tr colSpan>` below clicked row instead of after table.

**3m. Match history unused** — Wire `getVariantMatchHistoryAction` to query `evolution_arena_comparisons`. Add "Matches" tab to variant detail.

## Testing

### Per-Phase Checks
- `npm run lint`, `npx tsc --noEmit`, `npm run build` after each phase
- `npm test` for unit tests after each phase
- Commit each phase separately for selective revert

### Affected E2E Specs
- `admin-prompt-registry.spec.ts` — Phase 0 (row actions, delete)
- `admin-strategy-registry.spec.ts` — Phase 0, 2d
- `admin-evolution-dashboard.spec.ts` — Phase 1d/1e
- `admin-evolution-arena-detail.spec.ts` — Phase 3c/3d/3e
- `admin-evolution-experiments-list.spec.ts` — Phase 2h, 2a
- `admin-evolution-strategy-detail.spec.ts` — Phase 3h
- `admin-evolution-variants.spec.ts` — Phase 3m
- `admin-evolution-filter-consistency.spec.ts` — Phase 2a
- `admin-evolution-error-states.spec.ts` — Phase 2c

### Integration Tests
- **NEW** `entity-actions.integration.test.ts` — Phase 0a: 19-case matrix covering every entity × action with cascade + stale metrics verification
- `evolution-visualization.integration.test.ts` — Phase 1d: verify after dashboard query changes

## Rollback Plan
- Each phase committed separately → `git revert <commit>` for any phase
- Phase 0 `skipLink` is additive (defaults false) — safe to revert
- Phase 3 items are all independent — any single fix can be reverted

## Documentation Updates
- `evolution/docs/visualization.md` — new tabs (Runs on strategy, Matches on variant)
- `evolution/docs/reference.md` — new `executeEntityAction` server action
- `evolution/docs/entities.md` — updated entity action matrix, cascade tree
