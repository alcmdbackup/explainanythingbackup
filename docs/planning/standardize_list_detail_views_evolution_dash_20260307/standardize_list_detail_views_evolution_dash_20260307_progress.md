# Standardize List Detail Views Evolution Dash Progress

## Phase 1: Shared Components - COMPLETED

### Work Done
Created 7 shared components + test utilities:
- `EntityDetailHeader` - Presentational header with title, ID, links, status badge, actions
- `MetricGrid` - Shared metrics display (2-5 columns, default/card variants, CI intervals)
- `EntityTable` - Generic sortable table with ColumnDef, clickable rows, sort indicators
- `EntityListPage` - List page wrapper with title, filters, table, pagination
- `EntityDetailTabs` + `useTabState` - Controlled tab bar with URL sync and legacy mapping
- `RelatedRunsTab` - Discriminated union (strategyId | experimentId | promptId)
- `RelatedVariantsTab` - Discriminated union (runId | invocationId)
- Test utilities: `mockNextNavigation()`, fixture factories

All 53 Phase 1 tests pass. Barrel exports updated in `index.ts`.

### Issues Encountered
- TSC error in RelatedRunsTab: cast `status` to `EvolutionRunStatus`
- RelatedVariantsTab test: needed `getAllByText` due to EntityTable Link wrappers
- Added `promptId` filter to `getEvolutionRunsAction` for RelatedRunsTab

## Phase 2a-2f: Detail Page Integration - COMPLETED

### Work Done
Migrated all 6 detail pages to use shared components:
- **Variant detail**: Server shell → `VariantDetailContent` client component
- **Invocation detail**: Server shell → `InvocationDetailContent` client component
- **Prompt detail**: Refactored to use EntityDetailHeader + EntityDetailTabs
- **Strategy detail**: Server shell → `StrategyDetailContent` client component
- **Experiment detail**: Server shell → `ExperimentDetailContent` client component
- **Run detail**: Refactored inline tab bar → EntityDetailTabs with `useTabState`

### Issues Encountered
- Unused import cleanup needed after migrations (buildExplanationUrl, buildInvocationUrl, etc.)
- Prompt test: tab-content testId collision with EntityDetailTabs; used `getByText` instead
- EntityTable duplicate rendering bug; fixed with single rendering path

## Phase 2g-2l: List Page Integration - COMPLETED (partial)

### Work Done
Migrated read-only list pages:
- **Invocations list**: Converted to EntityListPage with runId, agent, status filters
- **Variants list**: Converted to EntityListPage with runId, agent, winner filters

### Intentionally Kept As-Is
- **Runs list**: Uses custom RunsTable with Trigger/Kill action buttons, date range filter
- **Strategies list**: Complex CRUD (create/edit/clone/archive/delete), expandable rows, custom sorting
- **Prompts list**: Complex CRUD (add/edit/archive/delete), expandable runs rows, confirm dialogs
- **Experiments list**: Thin wrapper around ExperimentHistory component

These pages have inline CRUD operations, action buttons, and expandable detail rows that don't fit EntityListPage's read-only model. The detail pages (Phase 2a-2f) already provide the standardized view for each entity.

## Phase 3: Cleanup - COMPLETED

### Work Done
Deleted deprecated components:
- `ExperimentDetailTabs.tsx` + test (replaced by EntityDetailTabs in ExperimentDetailContent)
- `VariantOverviewCard.tsx` + test (replaced by EntityDetailHeader + MetricGrid in VariantDetailContent)

### Verification
- TSC: Clean (no errors)
- Lint: Only pre-existing warnings
- Build: Successful
- Tests: 2176 evolution tests pass, 143 test suites
