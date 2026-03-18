# Assess Test Coverage Evolution V2 Research

## Problem Statement
Evaluate test coverage for the evolution v2 system across all testing tiers (unit, integration, E2E). The evolution pipeline includes complex code paths for pipeline execution, arena comparisons, cost optimization, visualization, and strategy experiments. This project will audit existing tests, identify coverage gaps, and produce a prioritized report of areas needing additional test coverage.

## Requirements (from GH Issue #727)
1. Audit all evolution v2 code files and map them to existing unit tests
2. Audit evolution integration tests for coverage gaps
3. Audit evolution E2E tests for admin evolution UI flow coverage
4. Identify untested services, components, and code paths
5. Produce a coverage gap report with prioritized recommendations
6. Identify any dead code or unused exports in evolution modules

---

## High Level Summary

The evolution v2 system has **1,525 test cases** across **~129 test files** (98 in evolution/, 31 in src/). Coverage is strong for V2 core library and V1 shared modules, but has significant gaps in integration tests, admin pages, agent detail components, and critical infrastructure.

### Key Statistics
| Category | Test Files | Test Cases | Coverage |
|----------|-----------|------------|----------|
| V2 Core Unit | 16 | 157 | Excellent (2 untested: arena.ts, errors.ts) |
| V1 Core Unit | 13 | 299 | Excellent (4 V1-only untested) |
| Service Unit | 14 | 281 | Good (4 services untested) |
| Component Unit | 35 | 283 | Good (22 components untested) |
| Shared/Utils | 7 | 68 | Good |
| Scripts | 8 | 149 | Good |
| Admin Pages | 24 | 125 | Moderate (18+ pages untested) |
| Integration | 4 | 34 | **WEAK** (6 listed in docs don't exist) |
| E2E | 7 | 36+ | Moderate |
| Config/Experiments | 3 | 44 | Good |
| **TOTAL** | **~129** | **1,525** | |

### Critical Findings

1. **Documentation is outdated**: `testing_setup.md` lists 6 evolution integration test files that don't exist. Also lists `admin-elo-optimization.spec.ts` and `admin-hall-of-fame.spec.ts` that don't exist. Docs claim 26 integration tests but only 24 exist.

2. **49 source files have NO test coverage** (see detailed breakdown below)

3. **`adminAction.ts` has zero tests** — factory function powering ALL admin server actions (auth, logging, error handling). Critical infrastructure with arity detection, auth wrapping, and error response shaping.

4. **`experimentActions.ts` (V1) is dead code** — 8 actions never imported in UI. Fully superseded by `experimentActionsV2.ts`, which also has no tests.

5. **Integration test coverage is the weakest tier** — only 4 evolution integration tests exist (34 test cases) for a system with 80+ server actions.

6. **`compose.test.ts` has only 2 substantive tests** — no multi-round pipeline composition tests exist anywhere.

7. **Zero checkpoint recovery tests** — no test saves a checkpoint and restores it.

8. **7 skipped tests** — 5 in experimentMetrics.test.ts (V1 checkpoint logic removed in V2), 2 in evolutionRunnerCore.test.ts (V1 pipeline).

9. **`service-test-mocks.ts` created but never used** — 3 duplicate `createChainMock()` implementations across test files instead.

10. **Test isolation risks** — `_evoExplTableExists` module-level cache causes test order dependency. LogsTab global URL mock not reset in afterEach. Untracked per-test fixtures create orphaned data.

---

## Detailed Coverage Gap Analysis

### 1. Files WITHOUT Test Coverage (49 total)

#### V2 Core Library (2 files)
| File | Status | Risk |
|------|--------|------|
| `evolution/src/lib/v2/arena.ts` | ACTIVE (used in runner.ts) — exports loadArenaEntries, syncToArena, isArenaEntry | Medium |
| `evolution/src/lib/v2/errors.ts` | ACTIVE (used in generate.ts) — BudgetExceededWithPartialResults class | Low (tested indirectly) |

#### Services (4 files)
| File | Status | Risk | Tests Needed |
|------|--------|------|-------------|
| `evolution/src/services/adminAction.ts` | **CRITICAL INFRASTRUCTURE** — factory wrapping auth + logging + error handling with arity detection | **Critical** | ~20 tests |
| `evolution/src/services/experimentActionsV2.ts` | ACTIVE V2 replacement — 5 actions used throughout UI (create, addRun, get, list, cancel) | **High** | ~25 tests |
| `evolution/src/services/experimentHelpers.ts` | ACTIVE — extractTopElo() utility | Low (tested indirectly) | 2-3 tests |
| `evolution/src/services/shared.ts` | ACTIVE (83+ refs) — ActionResult type, validateUuid(), UUID regexes | **High** | ~8 tests |

#### Components — Top Level (6 files)
| File | LOC | Risk | Tests Needed |
|------|-----|------|-------------|
| `RunsTable.tsx` | 267 | **High** — generic table with budget warnings, progress bars, pagination | ~20 |
| `RegistryPage.tsx` | 180 | **High** — config-driven CRUD with dialogs, pagination, filters | ~18 |
| `EntityDetailPageClient.tsx` | ~60 | Medium | ~5 |
| `FormDialog.tsx` | ~50 | Low | ~4 |
| `PhaseIndicator.tsx` | 37 | Low | ~4 |
| `VariantCard.tsx` | 73 | Low-Medium | ~8 |

#### Components — Agent Details (13 files, none tested)
| File | LOC | Risk |
|------|-----|------|
| CalibrationDetail.tsx | 50 | Medium |
| GenerationDetail.tsx | 40 | Low |
| RankingDetail.tsx | 68 | Medium |
| ReflectionDetail.tsx | 38 | Low |
| IterativeEditingDetail.tsx | 59 | Medium |
| **DebateDetail.tsx** | 69 | **Medium-High** (complex nested conditionals) |
| EvolutionDetail.tsx | 57 | Medium |
| MetaReviewDetail.tsx | 51 | Low |
| OutlineGenerationDetail.tsx | 43 | Low-Medium |
| ProximityDetail.tsx | 22 | Low |
| SectionDecompositionDetail.tsx | 47 | Medium |
| TreeSearchDetail.tsx | 50 | Low-Medium |
| TournamentDetail.tsx | 49 | Medium |

Note: Parent component AgentExecutionDetailView.test.tsx covers basic rendering dispatch but not individual detail component logic.

#### Components — Tabs (2 files)
| File | LOC | Risk | Tests Needed |
|------|-----|------|-------------|
| **EloTab.tsx** | 159 | **HIGH** — Recharts with data transforms, sigma band CI calculations, range slider, async loading | ~15 |
| **LineageTab.tsx** | 373 | **VERY HIGH** — D3.js tree visualization, zoom/pan, tree search toggle, node selection, 3 async operations | ~25 |

#### Admin Pages (18+ files)
| File | LOC | Risk | Tests Needed |
|------|-----|------|-------------|
| **strategies/page.tsx** | 942 | **VERY HIGH** — 5 components, 9 server actions, 3 dialogs, 4 sort fields, 3 filters | ~25 |
| **arena/page.tsx** | 692 | **VERY HIGH** — 6 components, 10 server actions, 3 dialogs, multi-step generate flow | ~20 |
| ExperimentStatusCard.tsx | 197 | Medium — status polling, cancel action | ~8 |
| ExperimentDetailContent.tsx | 135 | Medium — tabs, cancel, MetricGrid | ~6 |
| StrategyDetailContent.tsx | 158 | Medium — tabs, metrics | ~6 |
| VariantDetailContent.tsx | 90 | Medium — tabs, status badges | ~5 |
| runs/[runId]/compare/page.tsx | 125 | Medium — TextDiff, stats | ~4 |
| StrategyMetricsSection.tsx | 14 | Low | ~2 |
| + 10 more page.tsx wrapper files | ~20-50 each | Low | ~2 each |

#### V1 Core (4 files, not re-exported to V2)
| File | LOC | Risk |
|------|-----|------|
| validation.ts | 127 | Medium — validateStateContracts(), validateStateIntegrity(), validatePoolAppendOnly() |
| configValidation.ts | 123 | Medium — config + model allowlist validation |
| agentToggle.ts | 37 | Low — pure toggle utility |
| budgetRedistribution.ts | 75 | Medium — agent dependency graph |

### 2. Integration Test Gaps

**Existing (4 files, 34 tests):**
- `evolution-actions.integration.test.ts` — 12 tests (queue, get, kill, config)
- `evolution-infrastructure.integration.test.ts` — 8 tests (claims, heartbeat, split-brain)
- `evolution-explanations.integration.test.ts` — 8 tests (dual-column FKs, cleanup)
- `strategy-resolution.integration.test.ts` — 5 tests (hash dedup, created_by)
- Also: `arena-actions.integration.test.ts` — 10 tests (arena CRUD, Elo, comparisons)
- Also: `experiment-metrics.integration.test.ts`, `manual-experiment.integration.test.ts`, `strategy-archiving.integration.test.ts`

**Missing integration coverage for:**
- Cost attribution accuracy (estimated vs actual)
- Cost estimation predictions
- Evolution pipeline end-to-end (generate→rank→evolve→finalize)
- Outline generation pipeline
- Tree search checkpoint round-trip
- Visualization data actions (14+ actions, 0 integration tests)
- Arena sync atomicity (sync_to_arena RPC)
- Experiment state machine transitions (pending→running→analyzing→completed)
- Watchdog recovery paths (stale running/claimed detection)
- Checkpoint save and resume across runs

### 3. E2E Test Gaps

**Existing (7 files, ~55 tests):**
- `admin-evolution.spec.ts` — 5 tests (page load, filters, variants panel)
- `admin-evolution-visualization.spec.ts` — 7 tests (dashboard, tabs, lineage, timeline)
- `admin-strategy-registry.spec.ts` — 2 tests (page load, origin filter)
- `admin-article-variant-detail.spec.ts` — 5 tests (overview, lineage, breadcrumb)
- `admin-arena.spec.ts` — 17 tests (leaderboard, entries, prompt bank, cost chart; 2 skipped)
- `admin-elo-optimization.spec.ts` — **DOES NOT EXIST** (listed in docs)
- `admin-hall-of-fame.spec.ts` — **DOES NOT EXIST** (hall of fame = arena, tested in admin-arena.spec.ts)

**Missing E2E flows:**
- Run lifecycle (queue → running → completed)
- Experiment creation and execution end-to-end
- Strategy CRUD (create, edit, clone, archive, delete)
- Variant comparison and diff viewing
- Cost optimization dashboard interactions
- Elo optimization page (no E2E exists)
- Error states and empty states

**E2E Stability Risks:**
- `admin-arena.spec.ts` — shared state between tests (test 8 deletes entry, affects test 7's row count assumption); hardcoded row indices based on Elo ordering
- `admin-evolution-visualization.spec.ts` — no old data cleanup in seed function (only afterAll)
- All specs use direct DB inserts (not test-data-factory.ts)

### 4. Dead Code Identified

| File | Status | Recommendation |
|------|--------|---------------|
| `experimentActions.ts` (V1) | DEAD — 8 actions never imported in UI, 847-line test file also dead | Remove along with test file |

### 5. Unit Test Coverage Strengths

**Well-tested areas (14+ tests each):**
- `rank.test.ts` (24) — triage, fine-ranking, convergence, budget pressure
- `evolve-article.test.ts` (25) — full pipeline, all stop reasons, config validation
- `finalize.test.ts` (17) — persistence, summary computation, baseline tracking
- `strategy.test.ts` (17) — config hashing, labeling, model shortening
- `cost-tracker.test.ts` (15) — reserve-before-spend, parallel scenarios
- `evolve.test.ts` (14) — mutation, crossover, diversity triggers
- V1 core: strategyConfig (56), costTracker (42), formatValidationRules (38), costEstimator (37)

**Coverage gaps within tested files:**
- `compose.test.ts` has only 2 substantive tests (missing multi-round generate→rank→evolve→rank)
- No checkpoint recovery tests anywhere (5 skipped in experimentMetrics.test.ts)
- ComparisonCache: no tests for different modes, stress at MAX_CACHE_SIZE=500, text hash caching
- No Swiss pairing algorithm validation in rank.test.ts

### 6. Test Quality Issues

#### Mock Quality
- **`service-test-mocks.ts` created but never used** — provides `createSupabaseChainMock()` and `setupServiceTestMocks()` but all 4 service test files have their own duplicate `createChainMock()` implementations
- **Arena mock fragile to query reordering** — `arenaActions.test.ts` uses call-index-based table-aware mock; if code reorders `.from()` calls, tests fail silently
- **evolutionRunnerCore.test.ts** has stateful count query detection — complex but fragile

#### Test Isolation Risks
| Risk | Severity | File |
|------|----------|------|
| `_evoExplTableExists` module-level cache | **CRITICAL** — test order dependency | evolution-test-helpers.ts:172 |
| LogsTab global URL mock not reset in afterEach | **MEDIUM** — mock leak | LogsTab.test.tsx:201 |
| Untracked per-test fixtures (prompts/strategies) | **MEDIUM** — orphaned DB rows | evolution-actions.integration.test.ts |
| Mock re-application workaround after clearAllMocks | **MEDIUM** — fragile | evolution-actions.integration.test.ts:90 |
| jest.restoreAllMocks() inside tests instead of afterEach | **MEDIUM** — leak on failure | LogsTab.test.tsx:217,250 |

#### Skipped Tests (7 total)
| File | Count | Reason | Action |
|------|-------|--------|--------|
| experimentMetrics.test.ts | 5 | V1 checkpoint API removed in V2 | Keep skipped; consider rewriting eloPer$ test for V2 |
| evolutionRunnerCore.test.ts | 2 (in 1 suite) | V1 maxDurationMs replaced by V2 executeV2Run | Keep skipped |

---

## Prioritized Recommendations

### P0 — Critical (write first)
1. **`adminAction.ts` tests** (~20 tests) — arity detection, auth enforcement, error response shaping, Next.js router error re-throw
2. **`experimentActionsV2.ts` tests** (~25 tests) — all 5 V2 actions, UUID validation, state transitions, error handling
3. **`shared.ts` tests** (~8 tests) — validateUuid() edge cases, UUID regex variants
4. **Fix `_evoExplTableExists` cache** — reset in test setup or use `jest.isolateModules()`
5. **Fix testing_setup.md** — remove 6 non-existent integration test references, correct file counts

### P1 — High Priority
6. **`arena.ts` unit tests** (~15 tests) — loadArenaEntries, syncToArena, isArenaEntry
7. **`compose.test.ts` expansion** (~5 tests) — multi-round generate→rank→evolve→rank pipeline
8. **`strategies/page.tsx` tests** (~25 tests) — CRUD dialogs, presets, agent validation, sorting
9. **`arena/page.tsx` tests** (~20 tests) — topic CRUD, generate dialog, prompt bank, comparison
10. **`LineageTab.tsx` tests** (~25 tests) — D3 rendering, tree toggle, node selection
11. **`EloTab.tsx` tests** (~15 tests) — chart data transforms, top-N filtering, sigma bands
12. **Consolidate service test mocks** — adopt `service-test-mocks.ts` across all service tests
13. **Fix LogsTab mock leak** — move jest.restoreAllMocks() to afterEach

### P2 — Medium Priority
14. **`RunsTable.tsx` tests** (~20 tests) — budget warnings, progress bars, pagination
15. **`RegistryPage.tsx` tests** (~18 tests) — dialog orchestration, pagination, filters
16. **`validation.ts` tests** — state contract + integrity guards (3 functions)
17. **Agent detail components** (~3-5 tests each, ~50 total for all 13) — conditional rendering, data display
18. **`ExperimentStatusCard.tsx` + `ExperimentDetailContent.tsx`** (~14 tests)
19. **Checkpoint recovery integration test** — save state, restore, verify continuity
20. **E2E: strategy CRUD flow** — create, edit, clone, archive, delete
21. **Fix arena E2E shared state** — isolate test 8 (delete) from test 7 (row count)

### P3 — Low Priority
22. **Remaining admin page.tsx wrapper files** (~2 tests each, ~20 total)
23. **V1 core untested files** (validation.ts, configValidation.ts, agentToggle.ts, budgetRedistribution.ts)
24. **ComparisonCache mode variants + stress tests**
25. **Remove dead code** — `experimentActions.ts` V1 + its test file
26. **`PhaseIndicator.tsx`, `FormDialog.tsx`, `VariantCard.tsx`** (~16 tests total)
27. **E2E: experiment end-to-end flow**, error states, cost optimization dashboard

### Estimated Test Count Summary
| Priority | New Tests |
|----------|----------|
| P0 | ~53 |
| P1 | ~115 |
| P2 | ~120 |
| P3 | ~60 |
| **Total** | **~348 new tests** |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/feature_deep_dives/error_handling.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/request_tracing_observability.md

### Evolution Docs (via agents)
- evolution/docs/evolution/README.md, architecture.md, data_model.md
- evolution/docs/evolution/visualization.md, arena.md, cost_optimization.md
- evolution/docs/evolution/reference.md, strategy_experiments.md, hall_of_fame.md

## Code Files Read (via 24 research agents across 6 rounds)

### Round 1 — Broad Exploration
- All evolution/src/lib/v2/*.ts (18 files) — source + tests
- All evolution/src/lib/core/*.ts (17 files) — source + tests
- All evolution/src/services/*.ts (18 files) — source + tests
- All evolution/src/components/evolution/**/*.tsx (~70 files)
- All src/app/admin/evolution/**/*.tsx (~33 files)
- All integration tests (4 files) + E2E tests (7 files)

### Round 2 — Cross-Reference
- Source-to-test mapping for all 7 directories
- 7 integration test file existence verification
- V1 core re-export analysis via v2/index.ts
- Admin page test coverage per-file

### Round 3 — Verification
- Doc accuracy: confirmed 6 integration tests + 2 E2E tests listed but don't exist
- Dead code analysis: all 6 untested files confirmed ACTIVE (except V1 experimentActions)
- Precise test case count: 1,525 total
- Component risk assessment: 15 untested components rated LOW to VERY HIGH

### Round 4 — Deep Dives
- Full read of adminAction.ts, experimentActionsV2.ts, shared.ts (critical untested services)
- Full read of strategies/page.tsx (942 LOC), arena/page.tsx (692 LOC)
- Full read of LineageTab.tsx (373 LOC), EloTab.tsx (159 LOC), RunsTable.tsx, RegistryPage.tsx, VariantCard.tsx, PhaseIndicator.tsx
- compose.ts/test.ts analysis, arena.ts full read, checkpoint search, ComparisonCache analysis, TODO/skip search

### Round 5 — Quality Analysis
- E2E test data seeding patterns (5 spec files)
- Service mock quality (4 test files + service-test-mocks.ts)
- Skipped test audit (7 skipped across 2 files)
- Test isolation patterns (integration + unit + component tests)

### Round 6 — Final Verification
- Test file count verification (129 files confirmed)
- Hall of Fame / Elo optimization coverage check
- API route + cron job coverage
- Schemas, hooks, middleware, RLS policy sweep

---

## E2E Test Coverage Assessment (Full App)

### Overview
- **40 spec files**, **273 test cases**, **24 @critical**, **3 @smoke**
- **12 POM files** with 150+ methods (86.2% Rule 12 compliant)
- **13 production pages** with zero E2E coverage

### E2E Coverage by Feature Area

| Feature Area | Spec Files | Tests | Coverage |
|-------------|-----------|-------|----------|
| Auth (login, session, unauth) | 3 | 16 | Good |
| Home/Search/Generate | 3 | 30 | Excellent |
| Library | 1 | 7 | Good |
| Content Viewing (tags, actions, etc.) | 5 | 33 | Excellent |
| Edge Cases/Errors | 2 | 9 | Good |
| AI Suggestions | 7 | 58 | Excellent |
| Import | 1 | 8 | Good |
| Logging | 1 | 7 | Good |
| Sources | 1 | 6 | Good |
| Smoke | 1 | 3 | Basic |
| Admin Core (auth, content, users, etc.) | 6 | 39 | Good |
| Admin Evolution | 10 | 57 | Moderate |
| **Total** | **40** | **273** | |

### Admin Route E2E Coverage

| Admin Route | Has E2E? | Tests | Notes |
|------------|----------|-------|-------|
| /admin (dashboard) | YES | 1 | Basic load only |
| /admin/content | YES | 9 | Comprehensive |
| /admin/content/reports | YES | 7 | Comprehensive |
| /admin/users | YES | 7 | Comprehensive |
| /admin/whitelist | YES | 7 | Comprehensive |
| /admin/candidates | YES | 8 | Comprehensive |
| **/admin/costs** | **NO** | 0 | **500 LOC, complex dashboard** |
| **/admin/audit** | **NO** | 0 | **365 LOC, filters + export** |
| **/admin/settings** | **NO** | 0 | **238 LOC, feature flags** |
| **/admin/dev-tools** | **NO** | 0 | Low priority |
| /admin/evolution/runs | YES | 5 | Good |
| /admin/evolution/runs/[runId] | YES | 6 | Comprehensive |
| /admin/evolution/strategies | YES | 5 | Good |
| /admin/evolution/arena | YES | 14 | Comprehensive |
| /admin/evolution/variants/[variantId] | YES | 6 | Good |
| /admin/evolution/experiments | YES | 6 | All skipped (DB migration) |
| /admin/evolution/prompts | YES | 1 | Basic |
| **/admin/evolution/invocations** | **NO** | 0 | |
| **/admin/evolution/start-experiment** | **NO** | 0 | **Critical workflow** |
| **/admin/evolution/runs/[runId]/compare** | **NO** | 0 | Partial in viz spec |

### Top 10 Missing E2E User Flows

1. **Logout flow** — skipped due to Server Action redirect bug
2. **Experiment creation + execution** — start-experiment page untested
3. **Strategy CRUD** — create/edit/clone/archive not tested end-to-end
4. **Save-after-edit workflow** — edit mode tested but save persistence not verified
5. **Cost analytics dashboard** — 500 LOC page, zero tests
6. **Audit log viewing + export** — compliance feature, zero tests
7. **Multi-source search** — single source tested, multi not
8. **Admin feature flags** — settings page untested
9. **Invocation tracking** — list + detail pages untested
10. **Published/draft state transitions** — status changes not tested

### Pages with Zero E2E — Priority Assessment

| Page | LOC | Priority | Est. Tests |
|------|-----|----------|-----------|
| error.tsx | 96 | HIGH | 2-3 |
| account-disabled | 48 | HIGH | 2 |
| start-experiment | 34 | HIGH | 4-5 |
| admin/costs | 500 | MEDIUM | 6-7 |
| admin/audit | 365 | MEDIUM | 5-6 |
| admin/settings | 238 | MEDIUM | 4-5 |
| evolution/invocations | 110 | MEDIUM | 4-5 |
| evolution/invocations/[id] | 41 | MEDIUM | 3-4 |
| settings (user) | 154 | MEDIUM | 3-4 |
| runs/[runId]/compare | 124 | MEDIUM | 2-3 |
| admin/dev-tools | 161 | LOW | 1-2 |
| **Total** | | | **~40 tests** |

---

## Testing Rule Violations (testing_overview.md)

### Summary

| Rule | Violations | Acknowledged | Unacknowledged |
|------|-----------|-------------|----------------|
| Rule 1: Known state | 2 | 0 | 2 |
| Rule 2: No fixed sleeps | 7 | 3 | 4 |
| Rule 3: Stable selectors | 46 | 4 | 42 |
| Rule 6: Short timeouts | 0 | 0 | 0 |
| Rule 7: No silent errors | 0 | 0 | 0 |
| Rule 8: No test.skip | 1 | 0 | 1 |
| Rule 9: No networkidle | 4 | 4 | 0 |
| Rule 10: Unregister mocks | 0 | 0 | 0 |
| Rule 11: Per-worker temps | 0 | 0 | 0 |
| Rule 12: POM waits | 9 | 0 | 9 |
| **Total** | **69** | **11** | **58** |

### Rule 1: Start from a known state (2 violations)

1. **admin-content.spec.ts:118** — shared `testExplanations[]` array mutated during tests
2. **manual-experiment.integration.test.ts** — tests 2-4 depend on test 1 creating experiment (true order dependency)

### Rule 2: No fixed sleeps (4 unacknowledged)

1. `request-id-propagation.integration.test.ts:269` — `setTimeout(5)` no eslint-disable
2. `session-id-propagation.integration.test.ts:115` — `setTimeout(5)` no eslint-disable
3. `streaming-api.integration.test.ts:94` — `setTimeout(10)` no eslint-disable
4. `streaming-api.integration.test.ts:167` — `setTimeout(5)` no eslint-disable

### Rule 3: Stable selectors (42 need data-testid)

**Hotspot files:**
- `admin-evolution-visualization.spec.ts` — 6 `button:has-text()` tab selectors
- `admin-prompt-registry.spec.ts` — 13 getByText calls
- `admin-article-variant-detail.spec.ts` — 7 getByText calls
- `suggestions-test-helpers.ts:178` — 1 brittle selector affecting **8 test files**
- `admin-strategy-crud.spec.ts` — 8 getByText calls

**Selector ratio:** 221 data-testid (82.8%) vs 46 text-based (17.2%)

### Rule 8: No test.skip (1 unacknowledged)

- `admin-experiment-detail.spec.ts:138` — `describe.skip` without eslint-disable comment

### Rule 12: POM waits after actions (9 violations)

| POM File | Method | Issue |
|----------|--------|-------|
| ResultsPage.ts | clickResetTags() | No wait after click |
| ResultsPage.ts | clickRewriteButton() | No wait after click |
| ResultsPage.ts | openRewriteDropdown() | No wait after click |
| ResultsPage.ts | clickRewriteWithTags() | No wait after click |
| ResultsPage.ts | clickEditWithTags() | No wait after click |
| ResultsPage.ts | acceptDiff(), rejectDiff() | No wait after click |
| LoginPage.ts | login() | No wait after submit |
| LoginPage.ts | loginWithRememberMe() | No wait after submit |
| AdminContentPage.ts | selectExplanations() | No wait in loop |

### Integration Test Isolation (6 files audited)

| File | Isolation | Issue |
|------|-----------|-------|
| evolution-explanations | PASS | Acceptable centralized cleanup |
| experiment-metrics | PASS | Per-test try/finally |
| **manual-experiment** | **FAIL** | Tests 2-4 depend on test 1 |
| rls-policies | PASS | Graceful null checks |
| strategy-archiving | PASS | Per-test unique data |
| strategy-resolution | PASS | Per-test unique data |

**Gold standard pattern** (auth-flow, explanation-generation, tag-management): beforeEach/afterEach with per-test context.

---

### Round 7-8 — E2E + Rule Violations (12 agents)
- All 40 E2E spec files inventoried with test counts and tags
- 12 POM files audited for Rule 12 compliance (65 methods)
- All 13 uncovered pages assessed for complexity and priority
- User flow gap analysis across all feature areas
- Admin route coverage matrix (31+ routes, 58% covered)
- Rule violations searched across all tiers (unit, integration, E2E)
- Brittle selector analysis: 46 violations, 17.2% of all selectors
- Integration test isolation audit: 1 broken file (manual-experiment)

## Open Questions

1. Should the 6+ non-existent test files listed in testing_setup.md be created, or should the docs be corrected to match reality?
2. Should `experimentActions.ts` V1 dead code (+ 847-line test file) be removed as part of this project?
3. What priority for the 13 agent detail components — batch test all vs only high-risk (DebateDetail, RankingDetail)?
4. Should `service-test-mocks.ts` adoption be mandatory for new tests, or just recommended?
5. Is the `_evoExplTableExists` cache bug causing actual CI flakiness, or is it latent?
6. Should the 42 brittle text selectors be fixed now or tracked as tech debt?
7. Should the 9 POM Rule 12 violations be fixed before writing new E2E tests?
8. What's the priority for the 13 untested production pages (~40 E2E tests needed)?
