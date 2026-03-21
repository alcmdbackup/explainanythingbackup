# Hide Evolution Tests Staging Prod Plan

## Background
Test data created by integration/E2E tests persists in the database and clutters evolution admin list views. The `cleanupEvolutionData()` function is never called and intentionally skips strategies/prompts. Test helpers use inconsistent naming (`test_strategy_*`, `Test Prompt *`, `[TEST] *`). The admin content page already has a "Filter test content" checkbox pattern we can replicate.

## Requirements (from GH Issue #748)
- Hide all entities with the word "test" from list views in admin UI
- This includes experiments, prompts, strategies, variants, etc.
- Evaluate if missing any others
- Fix `cleanupEvolutionData()` to be called and to clean up all entity types
- Standardize all test data to use `[TEST]` prefix

## Problem
Evolution admin list views (prompts, strategies, experiments, runs, variants, invocations, arena topics) show test data mixed with real data. Test data accumulates because cleanup functions are never wired up and intentionally skip certain entity types. Test helpers use inconsistent naming patterns, making it hard to filter. This creates noise for admins trying to manage the evolution pipeline.

## Decisions (from open questions)
1. **Filter pattern**: `%[TEST]%` (case-insensitive) + standardize all test helpers to use `[TEST]` prefix
2. **Filter scope**: Direct-name entities only (prompts, strategies, experiments, arena topics). Runs/variants/invocations are excluded — they don't have name fields and filtering via JOINs adds complexity for little value
3. **Dashboard**: Keep inclusive (don't exclude test data from stat cards/cost aggregates)
4. **Default state**: Checkbox checked by default (hide test content)
5. **Cleanup**: Fix `cleanupEvolutionData()` + standardize `[TEST]` prefix in all test helpers

## Options Considered

### Option A: Add `is_test` boolean column to all evolution tables
- Pros: Clean DB-level filtering, no pattern matching
- Cons: Requires migration, backfill, and updating all test helpers to set the flag
- **Rejected**: Over-engineered for UI-level filtering

### Option B: Filter by name pattern in server actions (chosen)
- Pros: No migration needed, matches existing adminContent.ts pattern, reversible
- Cons: Pattern matching is slightly slower than boolean
- **Selected**: Simplest approach, proven pattern. Only applied to entities with direct name/title columns

### Option C: Client-side filtering only
- Pros: No server changes
- Cons: Pagination breaks (page shows fewer items), total counts wrong
- **Rejected**: Bad UX

## Phased Execution Plan

### Phase 1: Standardize `[TEST]` prefix in test helpers
**Goal**: All test data uses consistent `[TEST]` naming so the filter catches everything.

**Files to modify:**
- `evolution/src/testing/evolution-test-helpers.ts`
  - `createTestStrategyConfig()`: Change `name` from `test_strategy_${suffix}` to `[TEST] strategy_${suffix}`, `label` from `Test strategy` to `[TEST] Strategy`
  - `createTestPrompt()`: Change `title` from `Test Prompt ${suffix}` to `[TEST] Prompt ${suffix}`, `prompt` from `test_prompt_${suffix}` to `[TEST] prompt_${suffix}`
  - `createTestExperiment()` (if exists): Change `name` to use `[TEST]` prefix
  - `createTestEvolutionRun()`: No name field, no change needed
  - `createTestVariant()`: No name field, no change needed

**Tests**: Run all evolution unit + integration tests to verify naming changes don't break anything.

### Phase 2: Fix `cleanupEvolutionData()`
**Goal**: Test data gets properly cleaned up after test runs.

**Files to modify:**
- `evolution/src/testing/evolution-test-helpers.ts`
  - Expand `cleanupEvolutionData()` to also delete `evolution_strategy_configs` and `evolution_arena_topics` (currently skipped with a comment saying "callers should clean them up explicitly")
  - Accept strategy/prompt IDs as parameters for targeted cleanup

- Integration test files that create evolution data — wire `cleanupEvolutionData()` into `afterAll`/`afterEach`:
  - `src/__tests__/integration/evolution-actions.integration.test.ts`
  - `src/__tests__/integration/evolution-cost-attribution.integration.test.ts`
  - `src/__tests__/integration/evolution-cost-estimation.integration.test.ts`
  - `src/__tests__/integration/evolution-infrastructure.integration.test.ts`
  - `src/__tests__/integration/evolution-outline.integration.test.ts`
  - `src/__tests__/integration/evolution-pipeline.integration.test.ts`
  - `src/__tests__/integration/evolution-tree-search.integration.test.ts`
  - `src/__tests__/integration/evolution-visualization.integration.test.ts`
  - `src/__tests__/integration/strategy-resolution.integration.test.ts`
  - `src/__tests__/integration/hall-of-fame-actions.integration.test.ts`

**Tests**: Run all integration tests, verify cleanup runs without errors.

### Phase 3: Add `filterTestContent` to direct-name entities (Prompts, Strategies, Experiments)
**Goal**: List pages for entities with name/title columns get a "Filter test content" checkbox.

#### 3a: Add checkbox support to FilterDef + EntityListPage
- `evolution/src/components/evolution/EntityListPage.tsx`
  - Extend `FilterDef` interface: add `type: 'checkbox'` option with `defaultChecked?: boolean`
  - Add checkbox rendering in filter bar (follows ExplanationTable pattern)
  - Checkbox label from `FilterDef.label`, default from `FilterDef.defaultChecked`

#### 3b: Prompts page (RegistryPage-based)
- `evolution/src/services/arenaActions.ts` — `listPromptsAction`: Add `filterTestContent?: boolean` to input, add `.not('title', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/prompts/page.tsx` — Add checkbox FilterDef, map to server action param in `loadData`

#### 3c: Strategies page (RegistryPage-based)
- `evolution/src/services/strategyRegistryActionsV2.ts` — `listStrategiesAction`: Add `filterTestContent?: boolean` to input, add `.not('name', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/strategies/page.tsx` — Add checkbox FilterDef, map to server action param in `loadData`

#### 3d: Experiments page (custom ExperimentHistory)
- `evolution/src/services/experimentActionsV2.ts` — `listExperimentsAction`: Add `filterTestContent?: boolean` to input, add `.not('name', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` — Add checkbox state (default `true`), pass to action

#### 3e: Arena Topics page (EntityListPage-based)
- `evolution/src/services/arenaActions.ts` — `getArenaTopicsAction`: Add `filterTestContent?: boolean`, add `.not('title', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/arena/page.tsx` — Add checkbox FilterDef

#### 3f: Start Experiment form dropdowns
- `evolution/src/services/experimentActionsV2.ts` — `getPromptsAction` and `getStrategiesAction`: Add `filterTestContent?: boolean`, filter when true
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — Pass `filterTestContent: true` to both actions (always hide test content in selection dropdowns, no checkbox needed)

**Tests**: Unit tests for each modified server action verifying the filter. Unit tests for EntityListPage checkbox rendering.

### Phase 4: Lint, build, test, verify
- Run `npm run lint`, `npx tsc --noEmit`, `npm run build`
- Run all unit tests (`npm test`)
- Run integration tests (`npm run test:integration`)
- Manual verification on staging: confirm checkboxes appear, default to checked, test entities hidden, toggling shows them

## Testing

### Unit Tests (new)
- `EntityListPage.test.tsx` — Checkbox FilterDef renders correctly, fires onChange
- `arenaActions.test.ts` — `listPromptsAction` with filterTestContent excludes `[TEST]` titles
- `strategyRegistryActionsV2.test.ts` — `listStrategiesAction` with filterTestContent excludes `[TEST]` names
- `experimentActionsV2.test.ts` — `listExperimentsAction` with filterTestContent excludes `[TEST]` names

### Unit Tests (modified)
- Any existing tests for evolution-test-helpers.ts that reference old naming patterns

### Integration Tests
- Existing evolution integration tests should pass with updated naming + cleanup wiring
- Verify cleanup actually removes test strategies/prompts after test suite completes

### Manual Verification
- Browse each evolution list page on staging
- Confirm checkbox present and checked by default
- Confirm test entities hidden
- Uncheck — confirm test entities appear
- Start Experiment form: confirm test prompts/strategies not in dropdowns

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/testing_setup.md` - Document `[TEST]` prefix convention for evolution entities, updated cleanupEvolutionData behavior
- `docs/feature_deep_dives/admin_panel.md` - Document filter test content checkbox on evolution pages
- `evolution/docs/evolution/reference.md` - Update testing section with cleanup and naming conventions
