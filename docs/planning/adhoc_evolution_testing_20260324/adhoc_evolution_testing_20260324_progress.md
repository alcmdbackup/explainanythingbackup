# Adhoc Evolution Testing Progress

## Phase 1: Critical Bugs
### Work Done
- **F32**: Wrapped `computeExperimentMetrics` in try/catch in `getExperimentAction` — returns default empty metrics on failure instead of crashing the page
- **F1/F3**: Fixed RegistryPage infinite re-render loop — `config` (new object every render) was in useCallback deps, causing infinite fetch. Used `useRef` for `config.loadData` to stabilize
- **F19**: Added error banner on run detail page when `status === 'failed'` with `error_message` — red border banner with error text
- **F38**: Computed per-variant match counts from `matchHistory` in `syncToArena` instead of hardcoding 0. Counts winner/loser appearances with confidence > 0
- **F24/F43**: Added `|| '—'` fallback for empty `agent_name` in VariantsTab and VariantDetailContent

### Tests Added
- `experimentActions.test.ts`: F32 resilience test
- `runs/[runId]/page.test.tsx`: F19 error banner tests (2)
- `persistRunResults.test.ts`: F38 match count tests (2)
- `VariantsTab.test.tsx`: F24/F43 agent name fallback test
- `RegistryPage.test.tsx`: F1/F3 render stability test
- All 94 tests passing, lint clean, build passes

### Issues Encountered
- Workflow hook `track-prerequisites.sh` only had `TodoWrite` matcher, not `TaskCreate`. Fixed `.claude/settings.json` to add `TaskCreate` matcher.

## Phase 2: Critical UX
### Work Done
- **F34/F47**: Already working — experiments/strategies pages have `getRowHref`, F32 fix enables experiment detail
- **F21**: Added cross-links (Strategy, Experiment, Prompt) to run detail EntityDetailHeader
- **F16**: Already implemented — ExperimentForm has per-strategy run count inputs + max(20) server-side validation
- **F5/F50**: Created `loading.tsx` files for 7 evolution routes using existing TableSkeleton
- **F4**: Added explicit `text-xs font-ui font-medium` and `<span>` wrapper to EntityTable column headers for a11y

## Phase 3: High-Priority Bugs
### Work Done
- **F31**: Updated experiment status filter from [Active, Cancelled, All] to [All, Draft, Running, Completed, Cancelled]
- **F2**: Renamed base "Cost" column to "Spent" in RunsTable to avoid duplicate with metric column
- **F26**: Added `.filter(Boolean)` to strategy names in VariantsTab dropdown
- **F22**: Added proper ARIA roles (tablist/tab/tabpanel), aria-selected, aria-controls, arrow key navigation to EntityDetailTabs
- **F35**: Arena page shows `totalCount={loading ? undefined : topics.length}` to hide count during loading

## Phase 4: High-Priority UX Polish
### Work Done
- **F37**: Added `stripMarkdownTitle()` helper, applied to arena leaderboard content column
- **F36/F45**: Added `formatElo()` helper, applied in arena leaderboard for consistent integer display
- **F10**: Added `filterTestContent` param to dashboard action, "Hide test content" toggle on dashboard page
- **F33**: Created `src/app/admin/evolution/not-found.tsx` for evolution-scoped 404
- **F40/F46**: Reordered variant detail tabs (Content first), hide empty Evolution Metrics on arena topic
- **F11**: Fixed sidebar overlap with flex layout + overflow-y-auto

## Phase 5: Minor Issues
### Work Done
- **F6**: Default experiment filter set to "All" (value 'all')
- **F7**: Strategy Label column truncated to single line with max-w-[200px] and title tooltip
- **F8/F44**: Standardized ALL breadcrumb roots to "Evolution" across ~13 pages
- **F9**: Already had `danger: true` on Delete action in prompts
- **F12**: Validation errors only shown after first "Next" click (added `submitted` state)
- **F14**: Step indicator now shows "Setup", "Strategies", "Review" labels
- **F17**: Already filtering test strategies via `filterTestContent: true`
- **F18**: Added "Select all" / "Deselect all" checkbox in wizard step 2
- **F20**: Entity ID now copyable (click to copy with visual feedback)
- **F25**: Renamed "View" → "Preview", "Full" → "Detail" in VariantsTab
- **F27**: Added `runStatus` prop to VariantsTab, shows warning banner when run failed
- **F29**: Iteration filter dynamically expands beyond 20 based on actual log data
- **F30**: Log timestamps now show "Mar 24, 4:12 PM" format via Intl.DateTimeFormat
- **F42**: Arena cost column shows "N/A" with tooltip explaining unavailability
- **F51**: Deferred (keyboard shortcuts)

## Phase 6: Structural UX
### Work Done
- **F41**: Added client-side column sorting to arena leaderboard (click headers, asc/desc toggle)
- **F48**: Removed Created By column from strategies list (raw UUID not useful)
- **F15/F28**: Deferred (HMR loops — root cause fixed in Phase 1 RegistryPage fix)

## Phase 7: Test Suite
### Work Done
- Created ESLint rule `no-duplicate-column-labels` with 5 tests
- Updated `require-test-cleanup` with `evolution-test-data-factory` pattern
- Added to `package.json` test:eslint-rules script
- Created 5 new E2E specs + 1 accessibility spec in `src/__tests__/e2e/specs/09-admin/`
- Extended existing `admin-experiment-wizard.spec.ts` with 2 new tests
- All 1449 unit tests passing, build clean, ESLint rules passing
