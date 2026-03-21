# Hide Evolution Tests Staging Prod Research

## Problem Statement
Hide all entities with the word "test" from list views in admin UI. This includes experiments, prompts, strategies, variants, etc. Evaluate if any others are missing.

## Requirements (from GH Issue #748)
- Hide all entities with the word "test" from list views in admin UI
- This includes experiments, prompts, strategies, variants, etc.
- Evaluate if missing any others

## High Level Summary

Test data created by integration/E2E tests persists in the database and clutters evolution admin list views. The root cause is that `cleanupEvolutionData()` intentionally does NOT delete strategies and prompts (treated as "shareable fixtures"), and the function itself is never actually called from any test. This means test strategies, prompts, experiments, runs, variants, and invocations accumulate indefinitely.

An existing "Filter test content" checkbox pattern exists in the admin content page (`ExplanationTable.tsx` + `adminContent.ts`) that filters `[TEST]` from explanation titles. This pattern should be replicated across all evolution list pages.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/environments.md - Environment configs, CI/CD workflows
- docs/feature_deep_dives/testing_setup.md - Four-tier test strategy, evolution test helpers
- docs/docs_overall/testing_overview.md - Test rules, tagging, CI workflows
- docs/feature_deep_dives/admin_panel.md - Admin UI, sidebar switching, existing filter patterns
- evolution/docs/evolution/README.md - V2 pipeline overview
- evolution/docs/evolution/visualization.md - Admin dashboard components
- evolution/docs/evolution/reference.md - Config, schema, testing reference

## Code Files Read
- `evolution/src/testing/evolution-test-helpers.ts` - Test data factories (naming patterns)
- `src/testing/utils/integration-helpers.ts` - TEST_PREFIX constant, cleanup
- `src/lib/services/adminContent.ts` - Existing filterTestContent implementation
- `src/components/admin/ExplanationTable.tsx` - Existing filter checkbox UI
- `evolution/src/components/evolution/EntityListPage.tsx` - FilterDef interface, filter rendering
- `evolution/src/components/evolution/EntityTable.tsx` - Presentation-only table
- `evolution/src/components/evolution/RegistryPage.tsx` - Config-driven list page with loadData
- `src/app/admin/evolution/prompts/page.tsx` - RegistryPage-based prompt list
- `src/app/admin/evolution/strategies/page.tsx` - RegistryPage-based strategy list
- `src/app/admin/evolution/experiments/page.tsx` - ExperimentHistory wrapper
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` - Experiment list with status filter
- `src/app/admin/evolution/_components/ExperimentForm.tsx` - Start experiment form with prompt/strategy dropdowns
- `src/app/admin/evolution/runs/page.tsx` - Custom runs table
- `src/app/admin/evolution/variants/page.tsx` - EntityListPage-based variant list
- `src/app/admin/evolution/invocations/page.tsx` - EntityListPage-based invocation list
- `src/app/admin/evolution/arena/page.tsx` - EntityListPage-based arena topics
- `src/app/admin/evolution-dashboard/page.tsx` - Dashboard with stat cards and recent runs
- `evolution/src/services/evolutionActions.ts` - getEvolutionRunsAction, listVariantsAction
- `evolution/src/services/arenaActions.ts` - listPromptsAction, getArenaTopicsAction
- `evolution/src/services/strategyRegistryActionsV2.ts` - listStrategiesAction
- `evolution/src/services/experimentActionsV2.ts` - listExperimentsAction, getPromptsAction, getStrategiesAction
- `evolution/src/services/invocationActions.ts` - listInvocationsAction
- `evolution/src/services/evolutionVisualizationActions.ts` - getEvolutionDashboardDataAction
- `supabase/migrations/20260315000001_evolution_v2.sql` - V2 schema

## Key Findings

### 1. Complete Inventory of Evolution List Pages (8 pages + dashboard)

| Page | Component Pattern | Server Action | Entity Name Field | Test Filter Complexity |
|------|------------------|---------------|-------------------|----------------------|
| Prompts | RegistryPage | `listPromptsAction` | `title` (direct) | Easy |
| Strategies | RegistryPage | `listStrategiesAction` | `name` (direct) | Easy |
| Experiments | ExperimentHistory (custom) | `listExperimentsAction` | `name` (direct) | Easy |
| Arena Topics | EntityListPage | `getArenaTopicsAction` | `title` (direct) | Easy |
| Runs | Custom table | `getEvolutionRunsAction` | None (use strategy_name, experiment enrichment) | Medium |
| Variants | EntityListPage | `listVariantsAction` | None (use run→strategy enrichment) | Medium |
| Invocations | EntityListPage | `listInvocationsAction` | None (use run_id relation) | Medium |
| Arena Entries | Custom (topic detail) | `getArenaEntriesAction` | None (use topic title) | Medium |
| Dashboard | Custom | `getEvolutionDashboardDataAction` | None (aggregates) | Medium |

### 2. Test Data Naming Patterns

Test data uses INCONSISTENT naming — not always `[TEST]` prefix:

| Source | Strategy Name | Prompt/Topic Title | Experiment Name |
|--------|--------------|-------------------|-----------------|
| `evolution-test-helpers.ts` | `test_strategy_${ts}_${rand}` | `Test Prompt ${ts}_${rand}` | N/A |
| Integration tests | `[TEST] cost-test-strategy` | `[TEST] Topic ${testId}` | N/A |
| E2E tests | N/A | `[TEST] Arena E2E Topic` | N/A |
| Manual testing | Varies (user-created) | Varies | Varies |

**Recommended filter**: Case-insensitive match on `test` anywhere in name/title. This catches:
- `[TEST] ...` prefix (integration/E2E convention)
- `test_strategy_...` (test helper convention)
- `Test Prompt ...` (test helper convention)
- Any manually created test entities

### 3. Existing Filter Pattern (Reference Implementation)

**adminContent.ts** (line 98-100):
```typescript
if (filterTestContent) {
  query = query.not('explanation_title', 'ilike', '%[TEST]%');
}
```

**ExplanationTable.tsx**: Checkbox defaults to `true` (checked), resets pagination on toggle.

### 4. DB Schema — Direct vs JOIN-based Filtering

| Table | Direct Name Column | Can Filter Directly |
|-------|-------------------|-------------------|
| `evolution_strategy_configs` | `name`, `label` | YES |
| `evolution_arena_topics` | `title`, `prompt` | YES |
| `evolution_experiments` | `name` | YES |
| `evolution_runs` | None | NO — needs strategy/experiment enrichment |
| `evolution_variants` | None | NO — needs run→strategy enrichment |
| `evolution_agent_invocations` | None | NO — needs run relation |
| `evolution_arena_entries` | None | NO — needs topic relation |

### 5. Component Architecture for Filtering

**FilterDef** (EntityListPage.tsx) only supports `'select' | 'text'` types — **no checkbox type**. Options:
1. Add `'checkbox'` type to FilterDef (preferred — reusable)
2. Use a select filter with "Yes/No" options (simpler, no component changes)
3. Add checkbox outside FilterDef in each page (follows ExplanationTable pattern)

**RegistryPage** passes filters as `Record<string, string>` to `loadData()` — boolean must be stringified.

### 6. Additional Surfaces That Need Filtering

Beyond list pages, test entities also appear in:
- **Start Experiment form** (`ExperimentForm.tsx`): Prompt and strategy dropdowns use `getPromptsAction({ status: 'active' })` and `getStrategiesAction({ status: 'active' })` — test prompts/strategies appear in selection
- **Dashboard stat cards**: Run counts and cost aggregates include test runs
- **Dashboard recent runs**: Shows test runs with their strategy names

### 7. Root Cause of Persistent Test Data

`cleanupEvolutionData()` in evolution-test-helpers.ts:
- Is **never called** from any test file
- Even if called, intentionally skips `evolution_strategy_configs` and `evolution_arena_topics`
- Integration tests create test strategies/prompts but never clean them up

## Open Questions

1. **Filter keyword**: Should we filter on case-insensitive `test` (broad — catches all patterns) or specifically `[TEST]` (narrow — only catches prefixed entities)? Recommend: case-insensitive `test` in name/title since test helpers use `test_strategy_*` and `Test Prompt *` patterns, not `[TEST]`.
2. **Runs/variants/invocations**: Should these be filtered by their linked experiment/strategy names, or should we only filter the "root" entities (prompts, strategies, experiments) and let runs/variants/invocations inherit visibility? The latter is simpler but leaves test runs visible on the runs page.
3. **Dashboard aggregates**: Should dashboard stat cards (total runs, total cost) exclude test runs? This changes the metrics but gives a cleaner view.
4. **Default state**: Should the filter checkbox default to checked (hide test content) matching the ExplanationTable pattern?
5. **Cleanup improvement**: Should we also fix `cleanupEvolutionData()` to actually be called and to clean up strategies/prompts? This is orthogonal but would reduce future accumulation.
