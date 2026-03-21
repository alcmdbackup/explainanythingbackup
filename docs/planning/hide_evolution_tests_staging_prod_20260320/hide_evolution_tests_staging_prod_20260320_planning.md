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
Evolution admin list views (prompts, strategies, experiments, arena topics) show test data mixed with real data. Test data accumulates because cleanup functions are never wired up and intentionally skip certain entity types. Test helpers use inconsistent naming patterns, making it hard to filter. This creates noise for admins trying to manage the evolution pipeline.

## Decisions (from open questions)
1. **Filter pattern**: `%[TEST]%` (case-insensitive) + standardize all test helpers to use `[TEST]` prefix. Only `[TEST]` is filtered — E2E tests using other prefixes like `[E2E]` are NOT affected by this filter
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
  - `createTestStrategyConfig()`: Change `name` from `test_strategy_${suffix}` to `[TEST] strategy_${suffix}`, change `label` from `Test strategy` to `[TEST] Strategy`
  - `createTestPrompt()`: Change `title` from `Test Prompt ${suffix}` to `[TEST] Prompt ${suffix}`, change `prompt` from `test_prompt_${suffix}` to `[TEST] prompt_${suffix}`
  - `createTestExperiment()` (if exists): Change `name` to use `[TEST]` prefix
  - `createTestEvolutionRun()`: No name field, no change needed
  - `createTestVariant()`: No name field, no change needed

- E2E test files that seed evolution data — verify they already use `[TEST]` prefix or update:
  - `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — already uses `[TEST]` prefix
  - `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — check naming
  - `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — check naming
  - `src/__tests__/e2e/specs/09-admin/admin-prompt-registry.spec.ts` — check naming
  - `src/__tests__/e2e/specs/09-admin/admin-strategy-budget.spec.ts` — check naming

**Tests**: Run all evolution unit + integration tests to verify naming changes don't break anything.

### Phase 2: Fix `cleanupEvolutionData()`
**Goal**: Test data gets properly cleaned up after test runs.

**Files to modify:**
- `evolution/src/testing/evolution-test-helpers.ts`
  - Expand `cleanupEvolutionData()` signature to accept strategy/prompt IDs:
    ```typescript
    // Current signature:
    async function cleanupEvolutionData(supabase: SupabaseClient, explanationIds: string[], extraRunIds?: string[]): Promise<void>
    // New signature (backward-compatible via options object):
    interface CleanupOptions {
      explanationIds?: string[];
      runIds?: string[];
      strategyIds?: string[];
      promptIds?: string[];
    }
    async function cleanupEvolutionData(supabase: SupabaseClient, options: CleanupOptions): Promise<void>
    ```
  - Delete order (FK-safe): invocations → variants → runs → strategy_configs → arena_topics
  - **Backward compatibility**: The only existing call site is `evolution-run-costs.integration.test.ts` which does manual cleanup (not via `cleanupEvolutionData()`). Since `cleanupEvolutionData()` is never actually called anywhere in the codebase, there are no existing callers to break. We can safely change the signature to the options object without a compatibility bridge. Update the one integration test to use the new options-based signature.
  - Use `afterAll` (not `afterEach`) since test data is created once in `beforeAll` and shared across tests — matches existing pattern in `evolution-run-costs.integration.test.ts`
  - Cleanup errors: log warning but don't throw (matches existing pattern) to avoid masking test failures

- Only 1 integration test file exists that creates evolution data:
  - `src/__tests__/integration/evolution-run-costs.integration.test.ts` — already has `afterAll` cleanup for runs/invocations; add strategy cleanup using the expanded `cleanupEvolutionData()`

**Note**: The original plan listed 10 integration test files — only `evolution-run-costs.integration.test.ts` exists. The other 9 were hallucinated.

**Tests**: Run integration tests, verify cleanup runs without errors and strategies/prompts are removed.

### Phase 3: Add `filterTestContent` to direct-name entities (Prompts, Strategies, Experiments, Arena Topics)
**Goal**: List pages for entities with name/title columns get a "Filter test content" checkbox.

#### 3a: Add checkbox support to FilterDef + EntityListPage + RegistryPage

**EntityListPage.tsx** (`evolution/src/components/evolution/EntityListPage.tsx`):
- Extend `FilterDef` interface: add `type: 'checkbox'` to the union (`'select' | 'text' | 'checkbox'`), add optional `defaultChecked?: boolean`
- Add checkbox rendering in the filter bar. When `type === 'checkbox'`:
  ```tsx
  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
    <input
      type="checkbox"
      checked={filterValues?.[filter.key] === 'true'}
      onChange={(e) => onFilterChange?.(filter.key, e.target.checked ? 'true' : 'false')}
      className="rounded"
    />
    {filter.label}
  </label>
  ```
- Checkbox value stored as string `'true'`/`'false'` in `filterValues: Record<string, string>` to maintain type compatibility

**RegistryPage.tsx** (`evolution/src/components/evolution/RegistryPage.tsx`):
- Initialize `filterValues` state from `config.filters` — for any `FilterDef` with `type: 'checkbox'` and `defaultChecked: true`, set initial value to `'true'`:
  ```tsx
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of config.filters) {
      if (f.type === 'checkbox' && f.defaultChecked) {
        defaults[f.key] = 'true';
      }
    }
    return defaults;
  });
  ```
- This ensures checkbox is checked on first render and `loadData` receives `filterTestContent: 'true'` on initial load

#### 3b: Prompts page (RegistryPage-based)
- `evolution/src/services/arenaActions.ts` — `listPromptsAction`: Add `filterTestContent?: boolean` to input schema. When true, add `.not('title', 'ilike', '%[TEST]%')` to query. This uses the same Supabase PostgREST `.not()` method proven in `adminContent.ts` line 99: `query = query.not('explanation_title', 'ilike', '%[TEST]%')`
- `src/app/admin/evolution/prompts/page.tsx` — Add checkbox FilterDef `{ key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true }`. In `loadData`, convert string to boolean: `filterTestContent: filters.filterTestContent === 'true'`

#### 3c: Strategies page (RegistryPage-based)
- `evolution/src/services/strategyRegistryActionsV2.ts` — `listStrategiesAction`: Add `filterTestContent?: boolean` to input, add `.not('name', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/strategies/page.tsx` — Same checkbox FilterDef pattern as prompts, convert in `loadData`

#### 3d: Experiments page (custom ExperimentHistory)
- `evolution/src/services/experimentActionsV2.ts` — `listExperimentsAction`: Add `filterTestContent?: boolean` to input, add `.not('name', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` — This component manages its own filter state (not RegistryPage). Changes:
  - Add state: `const [filterTestContent, setFilterTestContent] = useState(true);`
  - Render checkbox inline with existing status `<select>` dropdown (same row, right side):
    ```tsx
    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
      <input type="checkbox" checked={filterTestContent}
        onChange={(e) => setFilterTestContent(e.target.checked)} className="rounded" />
      Hide test content
    </label>
    ```
  - Add `filterTestContent` to the `loadExperiments` dependency array and pass to action: `listExperimentsAction({ status, filterTestContent })`

#### 3e: Arena Topics page (EntityListPage-based)
- `evolution/src/services/arenaActions.ts` — `getArenaTopicsAction`: Add `filterTestContent?: boolean`, add `.not('title', 'ilike', '%[TEST]%')` when true
- `src/app/admin/evolution/arena/page.tsx` — This page uses EntityListPage directly (not RegistryPage). It manages its own `filterValues` state. Change initialization from `{ status: '' }` to `{ status: '', filterTestContent: 'true' }` so the checkbox starts checked. Add checkbox FilterDef to the filters array.

#### 3f: Start Experiment form dropdowns
- `evolution/src/services/experimentActionsV2.ts` — `getPromptsAction` and `getStrategiesAction`: Add `filterTestContent?: boolean`, filter when true
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — Pass `filterTestContent: true` to both actions (always hide test content in selection dropdowns, no checkbox needed)
- **E2E test impact**: E2E tests (`admin-strategy-crud.spec.ts`, `admin-prompt-registry.spec.ts`, etc.) create test data via the admin UI, not via dropdowns. The Start Experiment form filtering won't affect E2E tests because they don't use the experiment creation flow to seed data.

**Supabase `.not()` API confirmation**: The `.not(column, operator, value)` method is part of the Supabase PostgREST client. It generates `column=not.ilike.*pattern*` in the query string. Already used in production at `src/lib/services/adminContent.ts:99`. No SQL injection risk — the pattern is a literal string, not user input.

**Tests**: Unit tests for each modified server action verifying the filter. Unit tests for EntityListPage checkbox rendering.

### Phase 4: Lint, build, test, verify
- Run `npm run lint`, `npx tsc --noEmit`, `npm run build`
- Run all unit tests (`npm test`)
- Run integration tests (`npm run test:integration`)
- Manual verification on staging: confirm checkboxes appear, default to checked, test entities hidden, toggling shows them

## Rollback Plan

All changes are additive (new optional params, new UI checkbox). No migrations, no schema changes. Each phase is independently revertable:

**Phase 1 rollback** (naming): Revert `[TEST]` prefix in test helpers. Update any assertions that match on new patterns. No other code depends on the prefix yet.

**Phase 2 rollback** (cleanup): Revert `cleanupEvolutionData()` expansion. Keep existing cleanup scope. Investigate FK constraint issues if cleanup fails.

**Phase 3 rollback** (UI + server filtering): Three levels of surgical rollback:
1. **Full revert**: Remove checkbox FilterDefs from page configs + remove `filterTestContent` param from server actions. All code paths restored.
2. **Server-only revert**: Keep checkbox UI but remove `.not()` filter from server actions. Checkbox renders but has no effect (graceful degradation).
3. **UI-only revert**: Remove checkbox from pages but keep server-side filter param. Server actions still accept the param but nobody passes it (no visible change).

Phases 1-3 are independent — reverting Phase 3 doesn't require reverting Phase 1 or 2.

## Testing

### Unit Tests (new)

**Component tests:**
- `EntityListPage.test.tsx` — Checkbox FilterDef renders correctly, fires onChange with `'true'`/`'false'` string values

**Server action tests** — follow existing mock pattern from `evolution/src/services/*.test.ts` files. Each test:
1. Creates a mock Supabase client with chainable methods (`.from().select().not().order()...`)
2. Spies on `.not()` method to verify it's called with correct args
3. Verifies that when `filterTestContent: true`, the query includes `.not('column', 'ilike', '%[TEST]%')`
4. Verifies that when `filterTestContent: false` or undefined, `.not()` is NOT called

```typescript
// Example mock pattern (reused across all server action tests):
const mockQuery = {
  select: jest.fn().mockReturnThis(),
  not: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
};
const mockSupabase = { from: jest.fn().mockReturnValue(mockQuery) };
```

Tests:
- `arenaActions.test.ts` — `listPromptsAction` with `filterTestContent: true` calls `.not('title', 'ilike', '%[TEST]%')`
- `strategyRegistryActionsV2.test.ts` — `listStrategiesAction` with `filterTestContent: true` calls `.not('name', 'ilike', '%[TEST]%')`
- `experimentActionsV2.test.ts` — `listExperimentsAction` with `filterTestContent: true` calls `.not('name', 'ilike', '%[TEST]%')`
- `arenaActions.test.ts` — `getArenaTopicsAction` with `filterTestContent: true` calls `.not('title', 'ilike', '%[TEST]%')`
- `experimentActionsV2.test.ts` — `getPromptsAction` and `getStrategiesAction` with `filterTestContent: true` apply filter

### Unit Tests (modified)
- Any existing tests for evolution-test-helpers.ts that reference old naming patterns (`test_strategy_`, `Test Prompt`, `Test strategy`)
- Existing server action tests that may assert on unfiltered result counts

### Integration Tests
- `evolution-run-costs.integration.test.ts` — verify expanded cleanup removes strategy configs
- Verify cleanup runs in `afterAll` without masking test failures

### E2E Tests (impact check)
- `admin-arena.spec.ts` — already uses `[TEST]` prefix, should be unaffected
- `admin-strategy-crud.spec.ts`, `admin-strategy-registry.spec.ts`, `admin-prompt-registry.spec.ts` — These E2E tests create data via the admin UI with names that may or may not contain `[TEST]`. The filter only hides entities matching `%[TEST]%` (case-insensitive). E2E tests that use `[E2E]` or other prefixes are NOT affected. If any E2E test seeds data with `[TEST]` in the name AND then asserts it's visible in the list, it must first uncheck the "Hide test content" checkbox. Evaluate each file during implementation.

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
