# Fix Test Filtering Evolution Further Research

## Problem Statement
The evolution dashboard overview page was missing the test content filter entirely. Additionally, the runs, variants, and invocations list pages show 0 results on initial load when "Hide test content" is checked — even though the checkbox is checked and the filter value is correctly passed to the server action. The root cause is **not** a React state issue but a PostgREST query failure.

## Requirements (from GH Issue)
1. Fix: evolution dashboard overview page missing test content filter entirely (done in Phase 1)
2. Fix: runs list page initial load shows 0 results with filter enabled
3. Fix: invocations list page initial load shows 0 results with filter enabled
4. Fix: variants list page same issue (nested inner join)
5. Drop duplicate FK constraint causing PostgREST ambiguity
6. Add regression tests for each fix to prevent future breakage

## High Level Summary

### Root Cause: HTTP 300 — Ambiguous FK Relationship (PGRST201)

Verified via direct PostgREST queries against staging using `scripts/check-staging-filter.mjs`.

There are **two FK constraints** from `evolution_runs.strategy_id` → `evolution_strategies.id`:
- `evolution_runs_strategy_config_id_fkey` — legacy, pre-existing (not in any migration)
- `fk_runs_strategy` — added in migration `20260324000001` (PR #811)

When PostgREST encounters `evolution_strategies!inner(name)` in the select expression, it finds two FK paths and returns **HTTP 300** with error code `PGRST201`:
```
"hint": "Try changing 'evolution_strategies' to one of the following:
  'evolution_strategies!evolution_runs_strategy_config_id_fkey',
  'evolution_strategies!fk_runs_strategy'"
```

The Supabase JS client treats HTTP 300 as an error → `adminAction` catches it → returns `{ success: false }` → page shows 0 results with no error message.

### Why Toggling Fixes It

- Checkbox starts **checked** → `filterTestContent: true` → action uses `!inner` join → PostgREST 300 → error → 0 results
- User **unchecks** → `filterTestContent: false` → action uses plain `SELECT *` → HTTP 200 → data shows
- User **re-checks** → same `!inner` join → same 300 error → 0 results again

So toggling "off" shows data (no join needed), but toggling "on" still fails. The user's perception was that toggling "fixed" it because unchecking showed data.

### Secondary Finding: No [TEST] Strategies on Staging

Strategy names on staging: `"Test"`, `"New strategy"` — neither contains the literal `[TEST]` substring. The `%[TEST]%` ilike pattern requires square brackets. Even if the query worked, nothing would be filtered on staging.

### Staging Data Summary
- 7 total runs, all non-archived
- 2 strategies, neither with `[TEST]` in name
- All runs have non-null `strategy_id`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — `[TEST]` prefix convention docs
- evolution/docs/architecture.md — evolution pipeline architecture

## Code Files Read
- evolution/src/services/evolutionActions.ts — getEvolutionRunsAction, listVariantsAction
- evolution/src/services/invocationActions.ts — listInvocationsAction
- evolution/src/services/evolutionVisualizationActions.ts — getEvolutionDashboardDataAction
- evolution/src/services/adminAction.ts — adminAction factory
- evolution/src/components/evolution/EntityListPage.tsx — filter bar UI
- evolution/src/components/evolution/RegistryPage.tsx — registry page pattern
- src/app/admin/evolution/runs/page.tsx — runs list page
- src/app/admin/evolution/invocations/page.tsx — invocations list page
- src/app/admin/evolution/variants/page.tsx — variants list page
- src/app/admin/evolution/strategies/page.tsx — strategies page (uses RegistryPage)
- src/app/admin/evolution/prompts/page.tsx — prompts page (uses RegistryPage)
- src/app/admin/evolution-dashboard/page.tsx — main dashboard
- supabase/migrations/20260324000001_entity_evolution_phase0.sql — FK constraint addition
- supabase/migrations/20260322000006_evolution_fresh_schema.sql — schema indexes
