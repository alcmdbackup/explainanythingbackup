# Evaluate Test Coverage Evolution Improvements Research

## Problem Statement
Evaluate current test coverage for the evolution system, then address important gaps. Also address any flakiness or code inefficiency that can benefit from refactors/consolidation.

## Requirements (from GH Issue #801)
- Evaluate how test coverage is currently for evolution
- Address any important coverage gaps
- Address any flakiness in evolution tests
- Address any code inefficiency that can benefit from refactors/consolidation

## High Level Summary

The evolution system has **51 source files**, **54 test files** with **843 test cases**, and **76 React components** (91% tested). Research across 6 rounds (24 agents) identified concrete improvement areas across flakiness, coverage gaps, testing infrastructure, integration tests, and E2E lifecycle tests.

### Current State
- **Unit tests**: 843 cases across 54 files — solid baseline
- **Integration tests**: 4 files, all bug-specific (no general workflow tests)
- **E2E tests**: 4 smoke tests (page loads only, no user workflows)
- **Component tests**: 69/76 components tested (91%)
- **Pipeline coverage**: 80-95% per module (see Finding 8)
- **RPCs**: 3/6 tested, 3 untested (sync_to_arena, cancel_experiment, update_strategy_aggregates)

### Key Improvement Areas
1. **Flakiness fixes** (13 setTimeout hacks, 3 race conditions, 2 env leaks)
2. **Coverage gaps** (3 untested files, 4 untested actions, 5 skipped tests, 2 untested RPCs)
3. **Testing infrastructure** (mock consolidation, E2E data factory, shared helpers)
4. **Integration tests** (17 new workflow tests across 7 categories)
5. **E2E tests** (26 new tests across 9 feature areas)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read

### Source Files (51 total in evolution/src/)
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — orchestrator with heartbeat
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — main generate→rank loop
- evolution/src/lib/pipeline/loop/generateVariants.ts — 3 parallel LLM strategies
- evolution/src/lib/pipeline/loop/rankVariants.ts — triage + Swiss ranking
- evolution/src/lib/pipeline/loop/buildPrompts.ts — prompt template builder (UNTESTED)
- evolution/src/lib/pipeline/loop/extractFeedback.ts — evolve variants with feedback
- evolution/src/lib/pipeline/infra/createEntityLogger.ts — fire-and-forget DB logging
- evolution/src/lib/pipeline/infra/createLLMClient.ts — retry + cost tracking
- evolution/src/lib/pipeline/infra/trackBudget.ts — reserve-before-spend
- evolution/src/lib/pipeline/infra/trackInvocations.ts — phase tracking
- evolution/src/lib/pipeline/infra/errors.ts — BudgetExceededWithPartialResults (UNTESTED)
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — V1-compat persistence + arena sync
- evolution/src/lib/pipeline/setup/buildRunContext.ts — context resolution
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts — title→article generation
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts — config hashing
- evolution/src/lib/shared/computeRatings.ts — OpenSkill Bayesian rating
- evolution/src/lib/shared/enforceVariantFormat.ts — format validation
- evolution/src/lib/shared/classifyErrors.ts — transient vs fatal
- evolution/src/lib/shared/hashStrategyConfig.ts — SHA256 config identity
- evolution/src/lib/ops/watchdog.ts — stale run detection
- evolution/src/lib/ops/orphanedReservations.ts — budget cleanup
- evolution/src/services/evolutionActions.ts — 11 actions, 4 untested
- evolution/src/services/arenaActions.ts — arena CRUD
- evolution/src/services/experimentActionsV2.ts — experiment lifecycle
- evolution/src/services/invocationActions.ts — invocation queries (NO TEST FILE)
- evolution/src/services/logActions.ts — multi-entity log queries
- evolution/src/services/costAnalytics.ts — cost aggregations
- evolution/src/services/strategyRegistryActionsV2.ts — strategy CRUD
- evolution/src/services/variantDetailActions.ts — variant detail
- evolution/src/services/evolutionVisualizationActions.ts — dashboard data
- evolution/src/services/adminAction.ts — admin action factory
- evolution/src/services/shared.ts — ActionResult, UUID validation
- evolution/src/experiments/evolution/experimentMetrics.ts — metrics computation
- evolution/src/testing/* — 5 test helper files

### Integration Tests (4 files)
- src/__tests__/integration/evolution-claim.integration.test.ts — 9 tests, Bug #1
- src/__tests__/integration/evolution-budget-constraint.integration.test.ts — 12 tests, Bug #6
- src/__tests__/integration/evolution-experiment-completion.integration.test.ts — 5 tests, Bug #4
- src/__tests__/integration/evolution-run-costs.integration.test.ts — 3 tests, cost helpers

### E2E Tests
- src/__tests__/e2e/specs/09-admin/admin-evolution-v2.spec.ts — 4 smoke tests
- src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts — 15 feature tests (pattern reference)

### Migration/RPC Files
- supabase/migrations/20260322000006_evolution_fresh_schema.sql — core RPCs + views + RLS
- supabase/migrations/20260322000007_evolution_prod_convergence.sql — production migration
- supabase/migrations/20260323000001_generalize_evolution_logs.sql — log generalization
- supabase/migrations/20260323000002_fix_stale_claim_expiry.sql — watchdog fix

### CI/Config Files
- .github/workflows/ci.yml — evolution-aware path detection
- jest.config.js — coverage thresholds (41% branches, 35% functions, 42% lines)
- jest.integration.config.js — integration test config
- playwright.config.ts — E2E config with @evolution tag support

## Key Findings

### Finding 1: Coverage Gaps — Untested Files & Functions

**Untested source files:**
| File | Exports | Importance |
|------|---------|-----------|
| `services/invocationActions.ts` | 2 actions (listInvocations, getInvocationDetail) | HIGH — admin UI dependency |
| `lib/pipeline/loop/buildPrompts.ts` | buildEvolutionPrompt() | HIGH — used by generateVariants + extractFeedback |
| `lib/pipeline/infra/errors.ts` | BudgetExceededWithPartialResults class | MEDIUM — 15 lines, simple inheritance |

**Untested actions in evolutionActions.ts:**
| Action | Lines | What's Missing |
|--------|-------|---------------|
| `queueEvolutionRunAction` | 103-176 | Strategy validation, budget defaults, audit logging — 11 test cases needed |
| `getEvolutionRunSummaryAction` | 316-338 | Zod union validation (V1/V2/V3), null handling, warning logs — 9 test cases |
| `getEvolutionVariantsAction` | 302-314 | Elo ordering, empty result handling — 7 test cases |
| (+ partial gaps in tested actions) | — | Cost enrichment logic, strategy name joins |

**Untested components (4 with business logic):**
| Component | Lines | What's Missing |
|-----------|-------|---------------|
| `EntityDetailPageClient.tsx` | 117 | Config-driven rendering, data loading, error handling |
| `[strategyId]/page.tsx` | 127 | Async data loading, error states, tab navigation |
| `[promptId]/page.tsx` | 88 | Data fetching, metric formatting |
| `InvocationDetailContent.tsx` | 83 | Cost formatting, success/failed badges |

### Finding 2: Skipped Tests — experimentMetrics.test.ts

5 skipped tests from V1→V2 migration (commit 468bb45d, 2026-03-17):

| Test | Recommendation | Reason |
|------|---------------|--------|
| "maps RPC stats to MetricsBag" | DELETE | RPC `compute_run_variant_stats` removed in V2 |
| "extracts variant ratings from checkpoint" | DELETE | `evolution_checkpoints` table dropped |
| "uses checkpoint fallback" | DELETE | Both RPC + checkpoint gone |
| "computes eloPer$ when cost > 0" | UN-SKIP | Formula still in V2 code, mock is V2-compatible |
| "handles no checkpoint gracefully" | REWRITE | Change to test empty `evolution_variants` scenario |

### Finding 3: Flakiness — Critical Issues

**CRITICAL: createEntityLogger.test.ts (13 setTimeout hacks)**
- Logger uses fire-and-forget pattern (returns void, promise chain detached)
- Tests use `await new Promise(r => setTimeout(r, 10))` to wait for microtasks
- **Fix**: Return `Promise<void>` from logger methods so tests can `await logger.info(...)`. If refactor scope too large, use `flushPromises()` helper as pragmatic workaround.

**HIGH: claimAndExecuteRun.test.ts (isCountQuery race condition)**
- Line 40: `isCountQuery` shared mutable state across mock chain calls
- If `.select({count:'exact'})` and `.in()` calls interleave, flag may be wrong value
- **Fix**: Scope count query state to specific `.select()` call chain by returning a new chain object

**HIGH: rankVariants.test.ts (2 flaky patterns)**
- Lines 260-278: Response order dependency — triage consumes LLM responses positionally but call order is non-deterministic
- Lines 300-317: Assumes first match is v0 vs v1 — Swiss pairing may shuffle
- **Fix**: Use call counter instead of positional array; assert pair exists anywhere in matches, not at position [0]

**HIGH: evolution-claim.integration.test.ts (unsafe env manipulation)**
- Lines 79-91, 93-105: `process.env.EVOLUTION_MAX_CONCURRENT_RUNS` set/restored without try/finally
- **Fix**: Wrap in try/finally blocks

**MEDIUM: Other patterns**
- `generateVariants.test.ts` line 84: `Date.now()` in callOrder array (unused but confusing) — replace with simple counter
- `buildRunContext.test.ts` line 49: `Math.random()` in mock invocation IDs — replace with deterministic counter
- `generateSeedArticle.test.ts` line 6: describe-level `callIdx` — add bounds checking

### Finding 4: Test Quality — Mock Wiring vs. Business Logic

~73% of service test assertions verify mock chain calls rather than output correctness:

- **evolutionActions.test.ts**: Cost enrichment Map logic untested; strategy name joins untested
- **arenaActions.test.ts**: Entry count aggregation (countMap) entirely untested
- **experimentActionsV2.test.ts**: 22/30 tests mock helper functions; transaction rollback untested

### Finding 5: Code Duplication — Consolidation Opportunities

**Mock setup duplication (9 files, ~60 lines removable):**
- Same 4-7 `jest.mock()` calls repeated in every service test
- `setupServiceTestMocks()` exists but doesn't cover logger/headers/auditLog
- **Fix**: Extend with `{ includeLoggerAndHeaders: true, includeAuditLog: true }` options

**UUID validation tests (24 identical tests across 8 files):**
- "rejects invalid [field]Id" pattern repeated verbatim
- **Fix**: Extract `testInvalidUuidRejection()` helper

**Auth integration tests (6 identical blocks):**
- "all actions fail when auth rejects" copied across files
- **Fix**: Extract `testAuthIntegration()` helper

**Test UUID constants (7+ files):**
- Same `VALID_UUID = '550e8400-...'` defined independently
- **Fix**: Export `TEST_UUIDS` from `service-test-mocks.ts`

**Source code: error handling (35 instances across 7 service files):**
- `if (error) throw error;` pattern repeated
- **Fix**: Extract `assertNoError()` utility in `services/shared.ts`

### Finding 6: Untested RPCs and DB Objects

| Name | Type | Tested? | Priority |
|------|------|---------|----------|
| `claim_evolution_run` | RPC | YES | — |
| `get_run_total_cost` | RPC | YES | — |
| `complete_experiment_if_done` | RPC | YES | — |
| `sync_to_arena` | RPC | **NO** | HIGH — upserts variants + inserts arena comparisons |
| `cancel_experiment` | RPC | **NO** | HIGH — atomic experiment + run cancellation |
| `update_strategy_aggregates` | RPC | **MOCKED ONLY** | MEDIUM — running mean, best/worst elo |
| `evolution_run_costs` | VIEW | YES | — |
| `evolution_run_logs` | VIEW | **NO** | LOW — backwards-compat alias |

### Finding 7: Integration Test Opportunities (17 proposed)

#### Category A: Run Lifecycle & State Machines (4 tests)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I1 | **Full pipeline: pending→claimed→running→completed** | Status flow, heartbeat set at claim, runner_id populated, run_summary schema, completed_at | Medium |
| I2 | **Concurrent claim race condition** (5 parallel runners, 10 pending runs) | Advisory lock serialization, no double-claims, SKIP LOCKED correctness | Complex |
| I3 | **Run failure: LLM error mid-pipeline** | error_message populated + truncated to 2000 chars, runner_id cleared, completed_at set | Medium |
| I4 | **Admin kill action on running run** | Status→failed, "Manually killed", audit log, double-kill idempotent | Medium |

#### Category B: Content Resolution & Arena Loading (3 tests)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I5 | **Content from explanation_id** | FK resolution, null content handling, no LLM call on this path | Simple |
| I6 | **Content from prompt_id (seed generation)** | 2 LLM calls (title→article), 60s timeout, markdown format | Medium |
| I7 | **Arena entry loading for prompt-based run** | Archived entries excluded, rating preset from mu/sigma, strategy label='arena_{method}' | Medium |

#### Category C: Strategy Management (2 tests)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I8 | **Strategy config hash find-or-create** | Hash stability, same config→same ID, different iterations→new strategy, budget excluded from hash | Medium |
| I9 | **Strategy aggregate updates (3 sequential runs)** | Running mean formula, best/worst elo, total_cost accumulation, null handling | Medium |

#### Category D: Finalization & Arena Sync (3 tests)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I10 | **Variant upsert: local vs arena filtering** | Only local variants persisted, arena excluded, winner=highest mu, match_count from results | Medium |
| I11 | **Arena sync retry on transient failure** | First RPC fails→logs→retries→succeeds, draw normalization, confidence=0 excluded | Complex |
| I12 | **Arena-only pool completion (0 local variants)** | stopReason='arena_only', no variant upsert, early return path | Simple |

#### Category E: Experiment Lifecycle (2 tests)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I13 | **Experiment auto-complete with 3 runs (NOT EXISTS)** | Stays running after 1st/2nd completion, completes only when all 3 done | Complex |
| I14 | **cancel_experiment RPC cascade** | Experiment→cancelled, pending/claimed/running→failed, completed untouched, idempotent | Medium |

#### Category F: RPCs (untested with real DB)

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I15 | **sync_to_arena RPC: upsert + ON CONFLICT** | 200-entry limit, 1000-match limit, ON CONFLICT updates mu/sigma/elo, draw normalization in SQL | Medium |
| I16 | **sync_to_arena RPC: over-limit rejection** | 201 entries → exception raised, atomicity preserved | Simple |

#### Category G: Logging

| ID | Test | What It Catches | Complexity |
|----|------|----------------|-----------|
| I17 | **Structured entity logger writes to evolution_logs** | Denormalized FKs, context field mapping (iteration→column, unknown→JSONB), fire-and-forget error swallowing | Medium |

### Finding 8: Pipeline Unit Test Completeness

| Module | Score | Key Gaps |
|--------|-------|----------|
| generateVariants | 95% | Missing: empty strategiesPerRound config |
| rankVariants | 85% | Missing: calibrationOpponents=0, tournamentTopK > pool size |
| evolveVariants/extractFeedback | 80% | Missing: diversityScore >= 0.5 boundary, all-format-failure scenario |
| persistRunResults | 88% | Missing: identical-mu winner tie-breaking, non-23505 error codes |
| trackBudget | 92% | Missing: negative budgetUsd, double-release |

### Finding 9: E2E Test Opportunities (26 proposed)

#### Group 0: Experiment Lifecycle (1 test)

| ID | Test | Pages | Complexity |
|----|------|-------|-----------|
| T0 | **Experiment wizard → verify runs on detail → mock completion → verify state** | start-experiment → experiments/{id} | Medium |

**Detailed flow for T0:**
1. Seed active prompt + strategy via service client
2. Fill wizard: name → prompt → budget → strategy (`data-testid="strategy-check-{id}"`) → submit (`data-testid="experiment-submit-btn"`)
3. Navigate to experiment detail → verify status="running", runs="0/N", cost="$0.00"
4. Click Runs tab → verify `data-testid="related-runs"` has N rows with "pending" status
5. Mock completion via DB: `UPDATE evolution_runs SET status='completed', completed_at=now(), cost_usd=0.05` + call `complete_experiment_if_done` RPC
6. Reload → verify status="completed", runs="1/1", cost="$0.05", cancel button hidden

#### Group 1: Dashboard (3 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T1 | **Dashboard metric cards with seeded data** (2 completed, 1 failed, 2 running) | Correct counts, cost totals, recent runs table | Simple |
| T2 | **Dashboard error state** (network interception) | "Failed to load" message, no metric cards | Simple |
| T3 | **Dashboard empty state** (no data) | "No data available" or zero values | Simple |

#### Group 2: Runs List (4 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T4 | **Status filter** (seed 5 runs, different statuses) | Filter dropdown updates table, row count matches | Medium |
| T5 | **Archived toggle** (3 active + 2 archived) | Checkbox default unchecked, toggle shows/hides archived | Simple |
| T6 | **Pagination** (seed 120 runs) | "1–50 of 120" text, Next/Previous states, page content changes | Medium |
| T7 | **Row click navigates to run detail** | URL changes, breadcrumb correct, detail loads | Simple |

#### Group 3: Run Detail (4 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T8 | **Tab navigation (Overview, Elo, Lineage, Variants, Logs)** | Each tab renders distinct content, active tab styling | Medium |
| T9 | **Status badge for all statuses** (seed 5 runs) | Correct colors per status, failed shows error indicator | Medium |
| T10 | **Breadcrumb navigation** (Dashboard > Runs > {id}) | All 3 links work, correct URLs | Simple |
| T11 | **Deep link + refresh preserves state** | Direct URL loads, tab persists after F5 | Simple |

#### Group 4: Strategies List (5 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T12 | **Status filter** (Active/Archived/All) | Filter dropdown, row count matches | Medium |
| T13 | **Edit form pre-fills existing values** | Fields populated, save persists changes | Medium |
| T14 | **Clone action creates copy with "(copy)" suffix** | Confirmation dialog, new row appears | Medium |
| T15 | **Archive/unarchive toggle** | Action buttons swap, row visibility matches filter | Medium |
| T16 | **Delete with danger confirmation** | Red button, emphatic dialog, row removed | Simple |

#### Group 5: Strategy Detail (3 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T17 | **Config display, metrics grid, description** | All sections render, null metrics show "—" | Simple |
| T18 | **Tab navigation (Overview + Logs)** | Tabs switch content, LogsTab renders | Simple |
| T19 | **Status badge styling** (active vs archived) | Green for active, gray for archived | Simple |

#### Group 6: Arena (3 tests, extending existing)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T20 | **Topic list with test-content + status filters** | Both filters work independently, default hides test content | Medium |
| T21 | **Leaderboard sorted by Elo descending** | Rank numbers sequential, rows in correct order | Simple |
| T22 | **Entry expansion shows full content + metadata** | Expand/collapse, method badge, cost, model visible | Medium |

#### Group 7: Experiments (2 tests)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T23 | **Experiments list page renders** | ExperimentHistory component, breadcrumb | Simple |
| T24 | **Experiment detail tabs + overview** | All tabs clickable, metrics grid, breadcrumb | Medium |

#### Group 8: Invocations (1 test)

| ID | Test | What It Verifies | Complexity |
|----|------|-----------------|-----------|
| T25 | **Invocations list with pagination + formatting** | All 8 columns, ID truncation, ✓/✗ success, cost/duration format, page size 20 | Medium |

#### Infrastructure needed
- New `evolution-test-data-factory.ts` with `createTestRun()`, `createTestStrategy()`, `createTestPrompt()`, `createTestVariant()`
- FK-safe cleanup (invocations → variants → runs → strategies → prompts) with per-worker tracking files
- Integration with `global-teardown.ts` for defense-in-depth cleanup
- Several `data-testid` selectors to add to components (status-filter, archived-toggle, tab-*, etc.)

### Finding 10: CI/Coverage Configuration

- CI has evolution-aware path detection (separate evolution-only test path)
- E2E uses `@evolution` tag for 4 spec files
- Coverage thresholds are global (41% branches, 35% functions, 42% lines) — no evolution-specific thresholds
- Coverage artifacts uploaded but no codecov integration for regression detection
- `--changedSince` mode disables threshold checks (most PRs bypass)

## Open Questions

1. **createEntityLogger refactor scope**: Changing logger to return Promise<void> affects all callers (~20+ call sites in pipeline). Should we audit call sites first, or use `flushPromises()` as pragmatic workaround and plan the refactor separately?
2. **Integration test depth**: The 6 designed integration tests cover critical workflows but require ~1000 lines and real DB access. Should we implement all 6 or prioritize watchdog + arena sync?
3. **E2E data factory**: Should the evolution E2E factory go in existing `test-data-factory.ts` or a new `evolution-test-data-factory.ts`?
4. **Coverage thresholds**: Should we add evolution-specific coverage thresholds, or rely on the global ones?
