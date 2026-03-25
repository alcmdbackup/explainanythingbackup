# Small UI Fixes Evolution Research

## Problem Statement
There are small UI fixes I want to make.

## Requirements (from GH Issue #809)
- Experiments list view still looks different (cards vs. rows in other list view tables) from other list views
- [ce267827](https://explainanything-2tbna8crw-acs-projects-dcdb9943.vercel.app/admin/evolution/runs/ce267827-38ce-469e-ae4c-cefa6b5c7483) hidden by "hide test content" in stage - probably shouldn't be the case

## High Level Summary

### Issue 1: Experiments list uses cards instead of table rows

The experiments list page (`src/app/admin/evolution/experiments/page.tsx`) uses `EntityListPage` with a custom `renderTable` prop that renders card-style `<div>` elements instead of a standard `<table>`. All other list pages use one of two patterns:

1. **Standard columns pattern** (variants, invocations): Pass `columns` prop to `EntityListPage`, which renders via `EntityTable` — a proper HTML `<table>` with `<thead>`/`<tbody>`.
2. **Custom RunsTable pattern** (runs): Pass `renderTable` prop that renders `RunsTable` — still a proper HTML `<table>`, just with specialized budget progress bars.

The experiments page is the only one using `renderTable` with card-style divs (`space-y-2` container, bordered div per row). It should be converted to use the standard `columns` prop pattern like variants/invocations.

**Data available from `listExperimentsAction`:** `id`, `name`, `status`, `created_at`, `runCount`. The cancel button (currently inline in the card) would need to become a column or row action.

**Template to follow:** `src/app/admin/evolution/invocations/page.tsx` — the simplest standard list page using `columns` + `EntityListPage`.

### Issue 2: Run ce267827 hidden by "Hide test content" filter

**Root cause: The filter is completely broken due to query size overflow.**

The run's strategy is **"New strategy"** (id: `28772da4`) — it does NOT contain `[TEST]`. The experiment is "new experiment" and the prompt is "Federal reserve" — neither contains `[TEST]`. So the `[TEST]` filter should NOT hide this run.

However, there are **~1000 `[TEST]` strategy rows** in the database (residue from integration tests). The `getEvolutionRunsAction` in `evolution/src/services/evolutionActions.ts` (line 197-219):
1. Fetches ALL strategy IDs with `[TEST]` in the name (~1000 UUIDs)
2. Builds a `NOT IN (uuid1, uuid2, ..., uuid1000)` clause — a 37KB string
3. This exceeds PostgREST's URL/query size limit → **Bad Request error**
4. The error causes the entire query to fail → **no runs returned at all**

**Verified via direct queries:**
- With filter: `count: null, error: Bad Request` — broken
- Without filter: `count: 582, includes ce267827: true` — works fine

**This means "Hide test content" hides ALL runs on staging, not just test ones.**

**Fix approach:** Replace the client-side ID list with a DB-side subquery or RPC. Two options:
1. Use Supabase `.not()` with a subquery pattern (if supported)
2. Create a Postgres RPC that does `WHERE strategy_id NOT IN (SELECT id FROM evolution_strategies WHERE name ILIKE '%[TEST]%')`
3. Also consider: periodic cleanup of [TEST] rows from integration tests

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/visualization.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/entities.md
- evolution/docs/README.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/cost_optimization.md
- evolution/docs/reference.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md

## Code Files Read

### Issue 1 (Experiments list)
- `src/app/admin/evolution/experiments/page.tsx` — experiments list page (card-based renderTable)
- `evolution/src/components/evolution/EntityListPage.tsx` — wrapper with columns vs renderTable logic
- `evolution/src/components/evolution/EntityTable.tsx` — standard table component (ColumnDef interface)
- `evolution/src/components/evolution/RunsTable.tsx` — specialized runs table (still HTML table)
- `evolution/src/components/evolution/EvolutionStatusBadge.tsx` — status badge colors/icons
- `src/app/admin/evolution/invocations/page.tsx` — template: simplest standard list page
- `src/app/admin/evolution/variants/page.tsx` — template: standard columns pattern
- `src/app/admin/evolution/runs/page.tsx` — runs list with RunsTable pattern
- `src/app/admin/evolution/prompts/page.tsx` — RegistryPage pattern (CRUD)
- `src/app/admin/evolution/strategies/page.tsx` — RegistryPage pattern (CRUD)
- `evolution/src/services/experimentActions.ts` — listExperimentsAction (returns id, name, status, created_at, runCount)

### Issue 2 (Hidden run)
- `src/app/admin/evolution/runs/page.tsx` — filter definition with defaultChecked: true
- `evolution/src/services/evolutionActions.ts:197-219` — getEvolutionRunsAction: fetches [TEST] strategy IDs then builds NOT IN clause (BUG: 1000 IDs = 37KB → PostgREST Bad Request)
- `evolution/src/services/experimentActions.ts` — listExperimentsAction: direct name ILIKE (no ID list issue)
- `evolution/src/services/strategyRegistryActions.ts` — strategy filter: direct name ILIKE (no issue)
- `evolution/src/services/arenaActions.ts` — arena filter: direct title ILIKE (no issue)
- **Only the RUNS filter has this bug** — it's the only one that does a 2-step ID lookup instead of direct name filtering
