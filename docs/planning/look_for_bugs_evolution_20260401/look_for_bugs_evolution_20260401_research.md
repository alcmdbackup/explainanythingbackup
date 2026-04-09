# Look For Bugs Evolution Research

## Problem Statement
Systematic bug hunt across the evolution pipeline codebase and admin UI. Using multi-agent research to identify error handling gaps, race conditions, logic errors, and data consistency issues in the evolution system code. Additionally, using Playwright to perform exploratory UX testing of the evolution admin pages to find UI bugs, broken flows, and rendering issues.

## Requirements (from GH Issue)
- Scan `evolution/src/` for error handling gaps, race conditions, and logic errors
- Review pipeline finalization for data consistency issues
- Check budget tracking edge cases (reserve-before-spend, partial results)
- Verify arena sync and variant persistence correctness
- Review experiment lifecycle state transitions for race conditions
- Check metric propagation and stale flag cascading for correctness
- Test evolution admin UI pages with Playwright (headless)
- Check experiment wizard, run detail, strategy pages for broken flows
- Look for rendering issues, missing error states, and accessibility problems
- Cross-reference documented behavior (in evolution docs) against actual code

## High Level Summary

Found **~85 raw bugs** across 3 rounds of multi-agent scanning (code scan, Playwright UX, deep-dive services/tests/edge-cases). After deduplication: **~76 unique bugs**. Top 50 verified against source code. **Final result: 42 CONFIRMED, 3 PARTIAL, 5 NOT A BUG.**

Key themes:
- **Pipeline logic errors**: incorrect iteration counting on early loop exit, stale metric recomputation overwriting real data with zeros
- **Race conditions**: arena match count lost-update, experiment name dedup TOCTOU
- **Data consistency**: experiment cost totals dropping runs without winners, cost analytics loading unbounded rows
- **UI/React bugs**: reversed cancel button condition, 3 components failing to refresh after cancellation, wrong counts displayed
- **Test quality issues**: test fixtures using wrong keys, mocks targeting wrong functions, assertions missing
- **Doc drift**: architecture doc describing removed evolve phase, stale file paths, missing RPC parameters

Full verified bug list: see `consolidated_bugs.md`

---

## Round 1: Code Scan Findings (15 bugs)

### HIGH SEVERITY

#### Bug C1: `iterationsRun` incorrect for killed/timed-out/aborted runs
- **File**: `evolution/src/lib/pipeline/loop/runIterationLoop.ts:226`
- **Category**: Logic error
- **Description**: When the loop breaks early (signal abort at line 141, kill detection at line 148, deadline at line 155), `iterationsRun` is never set before `break`. The fallback `if (iterationsRun === 0) iterationsRun = resolvedConfig.iterations` then incorrectly reports the max configured iterations instead of actual 0. The budget_exceeded break (line 179) correctly sets `iterationsRun = iter` but the other breaks do not.

### MEDIUM SEVERITY

#### Bug C3: `computeExperimentMetrics` inner join drops runs without winners
- **File**: `evolution/src/lib/pipeline/manageExperiments.ts:120-126`
- **Category**: Data consistency
- **Description**: The `!inner` join on `evolution_variants` means runs with no `is_winner=true` variant are excluded entirely from results, silently dropping their costs from `totalCost`.

#### Bug C5: Architecture doc describes 3-op loop but code only has 2 ops
- **File**: `evolution/docs/architecture.md:162-178`
- **Category**: Doc mismatch
- **Description**: Docs describe GENERATE, RANK, and EVOLVE phases. Code in `runIterationLoop.ts` only implements GENERATE and RANK. The evolve phase was removed but docs not updated.

### LOW SEVERITY

#### Bug C6/P15: Variable shadowing in finalization metric loops
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:218`
- **Description**: Inner `const result = def.compute(...)` shadows outer function parameter `result: EvolutionResult`. Currently functional but maintenance hazard.

#### Bug C7: Arena match count only counts decisive matches
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:373-376`
- **Description**: `variantMatchCounts` in `syncToArena` filters `confidence > 0`, while in-memory `matchCounts` includes all matches. Semantics differ.

#### Bug C8: Fire-and-forget cost writes can race with finalization
- **File**: `evolution/src/lib/pipeline/infra/createLLMClient.ts:94`
- **Description**: Each LLM call fires off a `writeMetric` for running cost total. Finalization also writes final cost. Late fire-and-forget could overwrite finalization value via UPSERT.

#### Bug C9: `computeWinnerElo` uses different default than `selectWinner`
- **File**: `evolution/src/lib/metrics/computations/finalization.ts:20-21`
- **Description**: `computeWinnerElo` uses `?? 0` for missing ratings; `selectWinner` uses `?? -Infinity`. Could pick different winners in edge cases.

#### Bug C11: Deprecated `update_strategy_aggregates` RPC still called
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:287`
- **Description**: `data_model.md` documents this RPC as deprecated but it's still called alongside new `propagateMetrics()`.

#### Bug C12: Architecture doc file path references are stale
- **File**: `evolution/docs/architecture.md:509-525`
- **Description**: Key File Reference table lists paths that don't match actual codebase.

---

## Round 2: Playwright UX Findings (10 bugs)

### MEDIUM SEVERITY

#### Bug U1/U1-dup: Cancel button shown on completed/failed experiments
- **File**: `src/app/admin/evolution/_components/ExperimentHistory.tsx:88`
- **Description**: Boolean condition is reversed — cancel button appears on completed/failed experiments instead of running ones.

#### Bug U-stale: Stale detection uses `created_at` instead of `updated_at`
- **File**: `src/app/admin/evolution/experiments/page.tsx:87`
- **Description**: Stale detection compares against `created_at`. An experiment created 2 hours ago but started 5 minutes ago would be falsely marked "stale".

#### Bug U-redirect: Dashboard redirect goes outside URL hierarchy
- **File**: `src/app/admin/evolution/page.tsx`
- **Description**: `/admin/evolution` redirects to `/admin/evolution-dashboard` which is outside the `/admin/evolution/*` path hierarchy.

### LOW SEVERITY

#### Bug U-arena: Arena entries count shows page size not total
- **File**: `src/app/admin/evolution/arena/[topicId]/page.tsx:172`
- **Description**: Shows `entries.length` (page of 20 items) instead of `totalEntries` from server.

#### Bug U-hide: hideEmpty filter breaks totalCount display
- **File**: `src/app/admin/evolution/arena/page.tsx:90`
- **Description**: Passes `totalCount={topics.length}` (client-side filtered) instead of server total.

#### Bug U-empty: Empty state has raw URL path instead of clickable Link
- **File**: `src/app/admin/evolution/experiments/page.tsx:122`
- **Description**: Shows raw path text instead of clickable `<Link>`.

#### Bug U-err: Error page lacks breadcrumbs/back navigation
- **File**: `src/app/admin/evolution/strategies/[strategyId]/page.tsx:85-92`
- **Description**: Error state renders bare message with no breadcrumbs or back link.

#### Bug U-a11y1: Step indicators not keyboard-accessible
- **File**: `src/app/admin/evolution/_components/ExperimentForm.tsx:193-210`
- **Description**: Completed step labels use `onClick` on `<span>` with no `tabIndex`, `role`, or `onKeyDown`.

#### Bug U-a11y2: Sortable headers lack ARIA/keyboard support
- **File**: `src/app/admin/evolution/arena/[topicId]/page.tsx:212-217`
- **Description**: Sortable table headers not keyboard-accessible.

#### Bug U-swallow: EntityListPage swallows error details
- **File**: `evolution/src/components/evolution/EntityListPage.tsx:149`
- **Description**: Catch block discards error, shows generic toast with no details.

---

## Round 3: Deep-Dive Findings (51 additional bugs)

### Services & Server Actions (8 bugs)

#### Bug S4: Experiment name dedup TOCTOU race + suffix skip
- **File**: `evolution/src/lib/pipeline/manageExperiments.ts:34-40`
- **Description**: Name dedup reads existing names then creates — race window. Also suffix sequence skips "(1)" going straight to "(2)".

#### Bug S7: Stale metric recomputation overwrites real metrics with zeros
- **File**: `evolution/src/lib/metrics/recomputeMetrics.ts:58-101`
- **Category**: HIGH
- **Description**: Fabricates fake context (matchHistory=[], totalCost=0) and overwrites real metrics with zeros.

#### Bug S8: Stale metric error recovery re-marks ALL metrics
- **File**: `evolution/src/lib/metrics/recomputeMetrics.ts:41-55`
- **Description**: On error, re-marks all metrics as stale, not just the failed ones.

#### Bug S10: Cost analytics fetches ALL rows into memory
- **File**: `evolution/src/lib/services/costAnalytics.ts:251-262`
- **Description**: No server-side aggregation; loads all cost rows into memory.

#### Bug S5: Missing pagination bound validation
- **File**: `evolution/src/lib/services/evolutionActions.ts:426-428`
- **Description**: `getEvolutionRunLogsAction` doesn't validate pagination parameters.

#### Bug S6: Arena pagination skipped when only limit provided
- **File**: `evolution/src/lib/services/arenaActions.ts:153-155`
- **Description**: Pagination only applied when offset is provided, not when limit-only.

#### Bug S11: computeExperimentMetrics uses run_summary.totalCost
- **File**: `evolution/src/lib/pipeline/manageExperiments.ts:113-147`
- **Description**: Uses potentially stale run_summary.totalCost instead of metrics table values.

#### Bug S13: getArenaTopicsAction fetches ALL variant rows for counting
- **File**: `evolution/src/lib/services/arenaActions.ts:80-87`
- **Description**: Fetches all variant rows just to count them; should use server-side count.

### Pipeline & Algorithm (6 bugs)

#### Bug P18: Arena match count lost-update race condition
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:399-407`
- **Description**: Read-modify-write without atomicity; concurrent runs lose updates.

#### Bug P2: Triage top-20% cutoff computed once, never updated
- **File**: `evolution/src/lib/pipeline/loop/rankVariants.ts:312-314`
- **Description**: Cutoff calculated at start; as ratings shift during ranking, cutoff becomes stale.

#### Bug P11: H1 detection fails with leading whitespace
- **File**: `evolution/src/lib/shared/enforceVariantFormat.ts:127`
- **Description**: Regex expects `#` at line start; leading spaces cause false negatives.

#### Bug P10: parseWinner ambiguous with both TEXT A and TEXT B mentioned
- **File**: `evolution/src/lib/shared/computeRatings.ts:232-249`
- **Description**: If response mentions both "TEXT A" and "TEXT B", parser picks first match.

#### Bug P12: Sentence counting fooled by abbreviations
- **File**: `evolution/src/lib/shared/enforceVariantFormat.ts:23`
- **Description**: Period-based sentence counting inflated by "Dr.", "St.", etc.

#### Bug P14: Comparison cache key order-invariant but winner order-dependent
- **File**: `evolution/src/lib/shared/computeRatings.ts:252-256`
- **Description**: Cache key is symmetric but stored winner index depends on call order. Latent bug protected by current usage patterns.

### Test Quality (4 bugs)

#### Bug T1: Test fixture uses literal string keys instead of UUID variables
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts:79`
- **Description**: `matchCounts` uses string literal keys instead of UUID variables, always resolving to 0.

#### Bug T2: Triage test mocks wrong function
- **File**: `evolution/src/lib/pipeline/loop/rankVariants.test.ts:475`
- **Description**: Mocks `completeStructured` but code uses `complete` — test passes for wrong reason.

#### Bug T3: Test claims iterationsRun=0 but never asserts it
- **File**: `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts:530`
- **Description**: Test name says it checks iterationsRun=0 but has no assertion for it.

#### Bug T4: Shared chain state across .from() calls in mock
- **File**: `evolution/src/lib/testing/service-test-mocks.ts:107`
- **Description**: Mock builder shares chain state between `.from()` invocations, causing cross-test contamination.

### UI/React (9 additional bugs)

#### Bug U-cancel1: No data refresh after experiment cancellation
- **File**: `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx:59-64`

#### Bug U-cancel2: Same — no refresh after cancel
- **File**: `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.tsx:28-37`

#### Bug U-server: Server component data never refreshes after client action
- **File**: `src/app/admin/evolution/experiments/[experimentId]/page.tsx:13`

#### Bug U-key: Uses array index as key for table rows
- **File**: `evolution/src/components/evolution/tables/EntityTable.tsx:83`

#### Bug U-logs: Iteration filter options based on current page only
- **File**: `evolution/src/components/evolution/tabs/LogsTab.tsx:130-133`

#### Bug U-dash: Total runs count misses cancelled runs
- **File**: `src/app/admin/evolution-dashboard/page.tsx:103`

---

## Verification Summary

Top 50 bugs verified against source code by 3 parallel verification agents.

| Category | Confirmed | Partial | Not a Bug | Total |
|----------|-----------|---------|-----------|-------|
| Pipeline Logic | 4 | 1 | 2 | 7 |
| Metrics System | 2 | 1 | 0 | 3 |
| Data Consistency | 3 | 0 | 0 | 3 |
| Race Conditions | 1 | 0 | 1 | 2 |
| Server Actions | 4 | 0 | 2 | 6 |
| Doc Mismatches | 2 | 0 | 0 | 2 |
| UI/React | 9 | 0 | 0 | 9 |
| Data Display | 7 | 0 | 0 | 7 |
| Accessibility | 2 | 0 | 0 | 2 |
| Test Bugs | 4 | 0 | 0 | 4 |
| Format Validation | 2 | 1 | 0 | 3 |
| Ranking Algorithm | 1 | 1 | 0 | 2 |
| **TOTAL** | **42** | **3** | **5** | **50** |

### Rejected Bugs (Not a Bug / By Design)

1. **S1** — Strategy hash excludes strategiesPerRound and budgetUsd — intentionally by design
2. **S12** — V1/V2 Elo→mu migration — V1 "Elo" was already small-scale, +25 offset correct
3. **C2** — Seed article costs not tracked — documented as intentional design choice
4. **C4** — Experiment auto-completion — handled by atomic DB RPC server-side
5. **S2** — Clone strategy timestamp hash — intentional for creating distinct rows

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/logging.md

### Feature Docs
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/debugging_skill.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/maintenance_skills.md

## Code Files Read
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts
- evolution/src/lib/pipeline/manageExperiments.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/pipeline/infra/createLLMClient.ts
- evolution/src/lib/pipeline/infra/trackBudget.ts
- evolution/src/lib/metrics/computations/finalization.ts
- evolution/src/lib/metrics/recomputeMetrics.ts
- evolution/src/lib/pipeline/loop/generateVariants.ts
- evolution/src/lib/pipeline/loop/rankVariants.ts
- evolution/src/lib/core/Agent.ts
- evolution/src/lib/pipeline/claimAndExecuteRun.ts
- evolution/src/lib/shared/computeRatings.ts
- evolution/src/lib/shared/enforceVariantFormat.ts
- evolution/src/lib/services/costAnalytics.ts
- evolution/src/lib/services/evolutionActions.ts
- evolution/src/lib/services/arenaActions.ts
- evolution/src/lib/services/strategyRegistryActions.ts
- evolution/src/lib/services/experimentActions.ts
- evolution/src/lib/schemas.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.test.ts
- evolution/src/lib/pipeline/loop/rankVariants.test.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.test.ts
- evolution/src/lib/testing/service-test-mocks.ts
- evolution/src/components/evolution/EntityListPage.tsx
- evolution/src/components/evolution/tables/EntityTable.tsx
- evolution/src/components/evolution/tabs/LogsTab.tsx
- src/app/admin/evolution/page.tsx
- src/app/admin/evolution/experiments/page.tsx
- src/app/admin/evolution/experiments/[experimentId]/page.tsx
- src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx
- src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.tsx
- src/app/admin/evolution/_components/ExperimentHistory.tsx
- src/app/admin/evolution/_components/ExperimentForm.tsx
- src/app/admin/evolution/arena/page.tsx
- src/app/admin/evolution/arena/[topicId]/page.tsx
- src/app/admin/evolution/strategies/[strategyId]/page.tsx
- src/app/admin/evolution/prompts/[promptId]/page.tsx
- src/app/admin/evolution-dashboard/page.tsx
