# Assess Test Coverage Evolution V2 Plan

## Background
Evaluate test coverage for the evolution v2 system across all testing tiers (unit, integration, E2E). The evolution pipeline includes complex code paths for pipeline execution, arena comparisons, cost optimization, visualization, and strategy experiments. This project will audit existing tests, identify coverage gaps, and produce a prioritized report of areas needing additional test coverage.

## Requirements (from GH Issue #727)
1. Audit all evolution v2 code files and map them to existing unit tests
2. Audit evolution integration tests for coverage gaps
3. Audit evolution E2E tests for admin evolution UI flow coverage
4. Identify untested services, components, and code paths
5. Produce a coverage gap report with prioritized recommendations
6. Identify any dead code or unused exports in evolution modules

## Problem
The evolution v2 system has 1,525 test cases across 129 files but suffers from critical gaps: `adminAction.ts` (the factory powering ALL admin server actions) has zero tests, 49 source files have no coverage at all, 6 integration test files listed in docs don't exist, and 13 production pages lack E2E tests. Additionally, 69 testing rule violations were found including 42 brittle selectors, 9 POM methods missing post-action waits, and a test order dependency in manual-experiment integration tests. The `service-test-mocks.ts` helper was created but never adopted, leading to 3 duplicate mock implementations.

## Options Considered

### Option A: Fix Everything at Once
Write all ~388 tests, fix all 69 violations, remove dead code, update docs in one large PR.
- **Pros:** Complete coverage in one pass
- **Cons:** Massive PR, impossible to review, high risk of merge conflicts, blocks other work

### Option B: Phased Approach by Priority (CHOSEN)
Address findings in 7 phases ordered by risk/impact. Each phase is independently testable and committable.
- **Pros:** Incremental value, reviewable PRs, can stop at any phase
- **Cons:** More commits, must maintain backward compatibility between phases

### Option C: Separate Projects per Tier
Split into 3 projects: unit tests, integration tests, E2E tests.
- **Pros:** Focused scope per project
- **Cons:** Cross-cutting concerns (mock consolidation, doc fixes) span all tiers

## Phased Execution Plan

### Phase 1: Critical Infrastructure Tests + Bug Fixes (~53 tests)
**Goal:** Test the untested foundations that everything else depends on. Fix bugs that cause flakiness.

**1a. Fix test isolation bugs (0 new tests, fixes existing)**
- Fix `_evoExplTableExists` module-level cache in `evolution/src/testing/evolution-test-helpers.ts:172` — reset to null in a `beforeAll` or use `jest.isolateModules()`
- Fix LogsTab global URL mock leak — move `jest.restoreAllMocks()` from inside tests (lines 217, 250) to `afterEach` in `evolution/src/components/evolution/tabs/LogsTab.test.tsx`
- Fix `manual-experiment.integration.test.ts` order dependency — refactor tests 2-4 to create their own experiments or use `beforeEach`

**1b. adminAction.ts tests (~20 tests)**
- File: `evolution/src/services/adminAction.test.ts` (new)
- Test arity detection: zero-arg handler (handler.length=1), single-arg handler (handler.length=2)
- Test auth flow: successful requireAdmin(), auth failure throws, Next.js router error re-thrown
- Test Supabase client injection: client created and passed to handler
- Test error handling: caught errors wrapped in ActionResult, error context includes action name
- Test logging: withLogging wrapper applied, serverReadRequestId wraps outer function
- Test success path: zero-arg and single-arg both return `{ success: true, data, error: null }`

**1c. experimentActionsV2.ts tests (~25 tests)**
- File: `evolution/src/services/experimentActionsV2.test.ts` (new)
- Test each of 5 actions: createExperimentAction, addRunToExperimentAction, getExperimentAction, listExperimentsAction, cancelExperimentAction
- Test UUID validation: invalid UUID rejected for each action
- Test error handling: DB errors wrapped in ActionResult
- Test getExperimentAction: nested runs select, metrics computation, 404 for missing experiment
- Test listExperimentsAction: optional status filter, synthetic runCount
- Test cancelExperimentAction: RPC call verification

**1d. shared.ts tests (~8 tests)**
- File: `evolution/src/services/shared.test.ts` (new)
- Test validateUuid(): valid v4, invalid v3 (strict), valid v3 (loose), invalid format, empty string, uppercase, wrong variant (strict)
- Test UUID_REGEX and UUID_V4_REGEX pattern correctness

**Verification:** `npm test -- --testPathPattern="adminAction|experimentActionsV2|shared" && npm run test:integration`

---

### Phase 2: Core V2 Library Gaps + Mock Consolidation (~35 tests)
**Goal:** Fill gaps in the V2 core library and establish consistent mock patterns.

**2a. arena.ts unit tests (~15 tests)**
- File: `evolution/src/lib/v2/arena.test.ts` (new)
- Test loadArenaEntries(): loads active entries with ratings, empty result, default mu/sigma for null values, skips archived
- Test syncToArena(): filters arena entries from pool, converts mu to Elo scale, builds match results with winner/draw, RPC call shape, empty pool handled
- Test isArenaEntry(): true for fromArena=true, false for missing/false flag, type guard narrowing

**2b. compose.test.ts expansion (~5 tests)**
- File: `evolution/src/lib/v2/compose.test.ts` (extend existing)
- Test multi-round: generate → rank → evolveVariants → rank across 2 iterations
- Test pool growth: verify pool size increases per iteration
- Test parent lineage: parentIds chain correctly across iterations
- Test convergence cascade: sigma narrows, convergence detected
- Test budget pressure: budgetFraction increases in later iterations

**2c. Consolidate service test mocks**
- Adopt `evolution/src/testing/service-test-mocks.ts` in:
  - `evolutionActions.test.ts` — replace inline createChainMock()
  - `evolutionVisualizationActions.test.ts` — replace inline createChainMock()
  - `evolutionRunnerCore.test.ts` — replace inline createChainMock()
- Fix arenaActions.test.ts table-aware mock to verify table names in `.from()` calls
- Document mock patterns in service-test-mocks.ts JSDoc

**Verification:** `npm test -- --testPathPattern="arena|compose|evolutionActions|evolutionVisualization|evolutionRunner|arenaActions"`

---

### Phase 3: High-Risk Component Tests (~75 tests)
**Goal:** Cover the visualization components and shared UI components with highest regression risk.

**3a. LineageTab.tsx tests (~25 tests)**
- File: `evolution/src/components/evolution/tabs/LineageTab.test.tsx` (new)
- Test view toggle: buttons only shown when tree data exists, switching between Full DAG and Pruned Tree
- Test data loading: lineage + tree search data on mount, error handling, empty states
- Test TreeGraph: winner path highlighting, node positioning, zoom transform, node selection panel
- Test TreeContent: multiple tree selector, tree stats display, revision action path
- Mock D3 (already configured in jest.config.js), mock visualization actions

**3b. EloTab.tsx tests (~15 tests)**
- File: `evolution/src/components/evolution/tabs/EloTab.test.tsx` (new)
- Test data loading: load on mount, re-fetch on refreshKey, loading skeleton, error state
- Test top-N filtering: initial=5, slider changes, correct filtering by final Elo, muted non-top variants
- Test chart data: sigma band CI calculations (mu ± 1.96*sigma), Y-axis domain (floor to nearest 50)
- Test empty state: "No rating data" message
- Mock Recharts via next/dynamic, mock visualization actions

**3c. RunsTable.tsx tests (~20 tests)**
- File: `evolution/src/components/evolution/RunsTable.test.tsx` (new)
- Test rendering: columns, header row, body rows, actions column conditional
- Test budget warnings: >=90% "!!" red, 80-90% "!" orange, <80% none
- Test progress bar: active runs show bar, color coding by percentage
- Test loading/empty states: TableSkeleton, EmptyState
- Test pagination: maxRows slicing, "View all N" link
- Test row click: router.push vs custom onRowClick

**3d. RegistryPage.tsx tests (~15 tests)**
- File: `evolution/src/components/evolution/RegistryPage.test.tsx` (new)
- Test initial render: breadcrumbs, title, header action button
- Test data loading: loadData on mount/filter/page changes, error toast
- Test filters: value change resets page to 1, triggers loadData
- Test pagination: page change triggers loadData
- Test row actions: visibility checks, danger styling, onClick calls
- Test dialog integration: FormDialog + ConfirmDialog rendering and submission

**Verification:** `npm test -- --testPathPattern="LineageTab|EloTab|RunsTable|RegistryPage"`

---

### Phase 4: Admin Page Tests (~65 tests)
**Goal:** Cover the two largest untested admin pages and other critical admin components.

**4a. strategies/page.tsx tests (~25 tests)**
- File: `src/app/admin/evolution/strategies/page.test.tsx` (new)
- Test CRUD: load strategies, create from blank, create from preset, edit, clone with "(Copy)" name
- Test lifecycle: archive, unarchive, delete (only predefined with 0 runs)
- Test filters: status (all/active/archived), origin (admin/system/experiment/batch), pipeline type
- Test sorting: name, run_count, avg_final_elo, avg_elo_per_dollar with asc/desc toggle
- Test form validation: name required, agent validation, budget bounds (0.01-1.00), iterations (1-100)
- Test UI states: loading skeleton, empty state, error banner, dialog open/close
- Mock all 9 server actions

**4b. arena/page.tsx tests (~20 tests)**
- File: `src/app/admin/evolution/arena/page.test.tsx` (new)
- Test topic CRUD: load topics, create topic with prompt, archive/unarchive, delete with confirmation
- Test GenerateArticleDialog: topic selector (__new__ option), model selection, generate → preview → view topic
- Test CrossTopicSummary: cards display when summaries >= 2, metrics rendering
- Test PromptBankSummary: coverage percentage, Run Comparisons with progress, method summary table
- Test show archived toggle, graceful degradation when cross-topic/bank data fails
- Mock all 10 server actions

**4c. ExperimentStatusCard + ExperimentDetailContent (~14 tests)**
- File: `src/app/admin/evolution/_components/ExperimentStatusCard.test.tsx` (new, ~8 tests)
- File: `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.test.tsx` (new, ~6 tests)
- Test status polling, cancel action, tabs, MetricGrid

**4d. StrategyDetailContent + VariantDetailContent (~6 tests)**
- File: `src/app/admin/evolution/strategies/[strategyId]/StrategyDetailContent.test.tsx` (new, ~3 tests)
- File: `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` (new, ~3 tests)

**Verification:** `npm test -- --testPathPattern="strategies/page|arena/page|ExperimentStatusCard|ExperimentDetailContent|StrategyDetailContent|VariantDetailContent"`

---

### Phase 5: Rule Violations + POM Fixes (~0 new tests, fixes existing)
**Goal:** Fix all 58 unacknowledged testing rule violations.

**5a. Fix Rule 12 — POM waits after actions (9 fixes)**
- `ResultsPage.ts`: Add waits to clickResetTags(), clickRewriteButton(), openRewriteDropdown(), clickRewriteWithTags(), clickEditWithTags(), acceptDiff(), rejectDiff()
- `LoginPage.ts`: Add navigation/response wait to login(), loginWithRememberMe()
- `AdminContentPage.ts`: Add per-checkbox wait in selectExplanations() loop

**5b. Fix Rule 3 — Brittle selectors (42 fixes)**
- Add data-testid attributes to components for tab buttons, suggestion panel buttons, form labels
- Priority hotspots:
  - `suggestions-test-helpers.ts:178` — affects 8 test files, fix "Get Suggestions" button selector
  - `admin-evolution-visualization.spec.ts` — 6 tab button selectors
  - `admin-prompt-registry.spec.ts` — 13 getByText calls
  - `admin-article-variant-detail.spec.ts` — 7 getByText calls
  - Accept/reject diff buttons (✓/✕ symbols) — 4 selectors across 2 files

**5c. Fix Rule 2 — Unacknowledged sleeps (4 fixes)**
- Add eslint-disable comments with justification to:
  - `request-id-propagation.integration.test.ts:269`
  - `session-id-propagation.integration.test.ts:115`
  - `streaming-api.integration.test.ts:94,167`

**5d. Fix Rule 8 — Missing eslint-disable (1 fix)**
- Add eslint-disable comment to `admin-experiment-detail.spec.ts:138`

**5e. Fix Rule 1 — Shared state (1 fix)**
- `admin-content.spec.ts:118` — move testExplanation creation into individual test scope

**Verification:** `npm run lint && npm run test:e2e -- --grep "@critical"`

---

### Phase 6: Agent Detail Components + Remaining Unit Tests (~80 tests)
**Goal:** Cover all 13 agent detail components and remaining untested files.

**6a. Agent detail components (~50 tests total, ~3-5 per component)**
- Create test files for all 13 in `evolution/src/components/evolution/agentDetails/`:
  - CalibrationDetail, GenerationDetail, RankingDetail, ReflectionDetail, IterativeEditingDetail
  - DebateDetail (highest priority — complex nested conditionals), EvolutionDetail, MetaReviewDetail
  - OutlineGenerationDetail, ProximityDetail, SectionDecompositionDetail, TreeSearchDetail, TournamentDetail
- For each: test basic rendering with fixture data, conditional elements, error states
- Use shared fixtures from `evolution/src/testing/executionDetailFixtures.ts`

**6b. Remaining untested components (~14 tests)**
- `PhaseIndicator.tsx` (~4 tests) — phase styling, progress display
- `VariantCard.tsx` (~8 tests) — strategy color, winner star, tree depth
- `FormDialog.tsx` (~4 tests) — open/close, field rendering, validation

**6c. V1 core untested files (~10 tests)**
- `validation.ts` (~5 tests) — validateStateContracts(), validateStateIntegrity(), validatePoolAppendOnly()
- `configValidation.ts` (~3 tests) — model allowlist, budget caps
- `budgetRedistribution.ts` (~2 tests) — agent classification, dependency rules

**6d. ComparisonCache gaps (~4 tests)**
- Different modes maintain separate entries
- Stress test at MAX_CACHE_SIZE=500
- Text hash caching reuse

**Verification:** `npm test -- --testPathPattern="agentDetails|PhaseIndicator|VariantCard|FormDialog|validation|configValidation|budgetRedistribution|comparisonCache"`

---

### Phase 7: E2E Expansion + Documentation + Cleanup (~40 E2E tests)
**Goal:** Cover uncovered production pages, fix E2E stability, update docs, remove dead code.

**7a. High-priority E2E tests (~10 tests)**
- `error.tsx` E2E (2 tests) — error display, reset button
- `account-disabled` E2E (2 tests) — render with/without reason
- `start-experiment` E2E (4-5 tests) — form submission, status card, cancel

**7b. Medium-priority E2E tests (~25 tests)**
- `/admin/costs` E2E (6-7 tests) — summary, date range, backfill, kill switch
- `/admin/audit` E2E (5-6 tests) — load, filter, export
- `/admin/settings` E2E (4-5 tests) — feature flags CRUD
- `/admin/evolution/invocations` E2E (4-5 tests) — list, filter, detail navigation
- User settings E2E (3-4 tests) — theme, mode, persistence

**7c. Fix E2E stability**
- Fix `admin-arena.spec.ts` shared state — isolate delete test from row count test
- Fix `admin-evolution-visualization.spec.ts` — add old data cleanup to seed function

**7d. Documentation updates**
- Fix `testing_setup.md` — remove 6 non-existent integration test file references, correct total count from 26 to 24, remove `admin-elo-optimization.spec.ts` and `admin-hall-of-fame.spec.ts` references
- Update `testing_setup.md` test statistics with new counts after all phases
- Update `testing_overview.md` test statistics if counts changed

**7e. Dead code removal**
- Delete `evolution/src/services/experimentActions.ts` (V1, 8 dead actions)
- Delete `evolution/src/services/experimentActions.test.ts` (847 lines, tests dead code)
- Verify no imports reference V1 before deletion

**Verification:** `npm run lint && npm run tsc && npm run build && npm test && npm run test:integration && npm run test:e2e -- --grep "@critical"`

---

## Testing

### New Test Files Created (by phase)
| Phase | New Test Files | New Tests |
|-------|---------------|-----------|
| 1 | adminAction.test.ts, experimentActionsV2.test.ts, shared.test.ts | ~53 |
| 2 | arena.test.ts + compose.test.ts expansion | ~20 + mock consolidation |
| 3 | LineageTab.test.tsx, EloTab.test.tsx, RunsTable.test.tsx, RegistryPage.test.tsx | ~75 |
| 4 | strategies/page.test.tsx, arena/page.test.tsx, + 4 component tests | ~65 |
| 5 | (fixes only, no new tests) | 0 |
| 6 | 13 agent detail tests + 3 component tests + 4 core tests | ~80 |
| 7 | ~8 E2E spec files | ~40 |
| **Total** | **~30 new test files** | **~333 new tests** |

### Existing Tests Modified
- `compose.test.ts` — expanded with multi-round tests
- `LogsTab.test.tsx` — fix mock cleanup
- `manual-experiment.integration.test.ts` — fix order dependency
- `evolution-test-helpers.ts` — fix cache bug
- 9 POM files — add post-action waits
- ~15 component files — add data-testid attributes
- 4 integration test files — add eslint-disable comments
- 2 E2E spec files — fix stability issues

### Manual Verification
- After Phase 5: run full E2E suite locally to verify POM fixes don't break existing tests
- After Phase 7: run nightly-equivalent suite against local build

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/testing_setup.md` — Remove 6 non-existent integration test references, remove 2 non-existent E2E test references, update test statistics (counts, file listings), add new test files to directory structure
- `docs/docs_overall/testing_overview.md` — Update test statistics after all phases complete
- `docs/feature_deep_dives/admin_panel.md` — Update E2E testing section with new admin specs
