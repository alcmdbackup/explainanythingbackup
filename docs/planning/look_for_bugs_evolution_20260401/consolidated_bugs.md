# Consolidated Bug List — Evolution Pipeline

Total raw findings: ~85. After deduplication: ~76 unique bugs.
Top 50 verified against source code. **Result: 42 CONFIRMED, 3 PARTIAL, 5 NOT A BUG.**

## VERIFICATION RESULTS

Status legend: `[x]` = confirmed real bug, `[~]` = partial (latent/edge case), `[-]` = not a bug/by design

### HIGH PRIORITY

| # | ID | File | Summary | Severity | Status |
|---|-----|------|---------|----------|--------|
| 1 | C1 | `pipeline/loop/runIterationLoop.ts:226` | `iterationsRun` reports config max instead of 0 when killed/aborted before any iteration | HIGH | [x] |
| 2 | S7 | `metrics/recomputeMetrics.ts:58-101` | Stale metric recomputation fabricates fake context (matchHistory=[], totalCost=0), overwrites real metrics with zeros | HIGH | [x] |
| 3 | S1 | `pipeline/setup/findOrCreateStrategy.ts:26-31` | Strategy hash excludes strategiesPerRound and budgetUsd — intentionally by design | HIGH→N/A | [-] |
| 4 | P14 | `shared/computeRatings.ts:252-256` | Comparison cache key is order-invariant but stored winner is order-dependent — latent bug protected by usage patterns | MEDIUM | [~] |
| 5 | P18 | `pipeline/finalize/persistRunResults.ts:399-407` | Arena match count uses read-modify-write without atomicity — concurrent runs lose updates | MEDIUM | [x] |
| 6 | U1-dup | `_components/ExperimentHistory.tsx:88` | Cancel button shown on completed/failed experiments — reversed boolean condition | MEDIUM | [x] |
| 7 | S12 | `lib/schemas.ts:767` | V1/V2 Elo→mu migration — V1 "Elo" was already small-scale, not chess Elo. +25 offset is correct | MEDIUM→N/A | [-] |
| 8 | T1 | `finalize/persistRunResults.test.ts:79` | matchCounts uses literal string keys instead of UUID variables — always resolves to 0 | MEDIUM | [x] |
| 9 | T2 | `loop/rankVariants.test.ts:475` | Triage test mocks `completeStructured` but code uses `complete` — test passes for wrong reason | MEDIUM | [x] |

### MEDIUM PRIORITY

| # | ID | File | Summary | Severity | Status |
|---|-----|------|---------|----------|--------|
| 10 | C2 | `pipeline/setup/generateSeedArticle.ts:73` | Seed article costs not tracked — documented as intentional design choice | MEDIUM→N/A | [-] |
| 11 | C3 | `pipeline/manageExperiments.ts:120-126` | computeExperimentMetrics inner join drops runs without winner from cost totals | MEDIUM | [x] |
| 12 | C4 | `pipeline/finalize/persistRunResults.ts:306` | Experiment auto-completion uses atomic DB RPC — race handled server-side | MEDIUM→N/A | [-] |
| 13 | C5 | `evolution/docs/architecture.md:162-178` | Docs describe 3-op loop but code only has 2 ops (evolve removed) | MEDIUM | [x] |
| 14 | S2 | `services/strategyRegistryActions.ts:202` | Clone strategy timestamp hash — intentional for creating distinct rows | MEDIUM→N/A | [-] |
| 15 | S3 | `services/experimentActions.ts:33-46` | createExperimentAction — validation exists in underlying function + Zod schema | MEDIUM→N/A | [-] |
| 16 | S4 | `pipeline/manageExperiments.ts:34-40` | Experiment name dedup TOCTOU race + suffix skips "(1)" | MEDIUM | [x] |
| 17 | S8 | `metrics/recomputeMetrics.ts:41-55` | Stale metric error recovery re-marks ALL metrics, not just failed ones | MEDIUM | [~] |
| 18 | S10 | `services/costAnalytics.ts:251-262` | Cost analytics fetches ALL rows into memory for aggregation | MEDIUM | [x] |
| 19 | P2 | `pipeline/loop/rankVariants.ts:312-314` | Triage top-20% cutoff computed once, never updated as ratings shift | MEDIUM | [x] |
| 20 | P11 | `shared/enforceVariantFormat.ts:127` | H1 detection fails with leading whitespace | MEDIUM | [x] |
| 21 | U-stale | `admin/evolution/experiments/page.tsx:87` | Stale detection uses created_at instead of updated_at | MEDIUM | [x] |
| 22 | U-arena | `admin/evolution/arena/[topicId]/page.tsx:172` | Arena entries count shows page size (20) not total | MEDIUM | [x] |
| 23 | U-cancel1 | `experiments/[experimentId]/ExperimentDetailContent.tsx:59-64` | No data refresh after experiment cancellation | MEDIUM | [x] |
| 24 | U-cancel2 | `experiments/[experimentId]/ExperimentOverviewCard.tsx:28-37` | Same — no refresh after cancel | MEDIUM | [x] |
| 25 | U-server | `experiments/[experimentId]/page.tsx:13` | Server component data never refreshes after client action | MEDIUM | [x] |
| 26 | U-key | `evolution/tables/EntityTable.tsx:83` | Uses array index as key for table rows | MEDIUM | [x] |
| 27 | U-logs | `evolution/tabs/LogsTab.tsx:130-133` | Iteration filter options based on current page only | MEDIUM | [x] |
| 28 | U-hide | `admin/evolution/arena/page.tsx:90` | hideEmpty filter breaks totalCount display | MEDIUM | [x] |
| 29 | T3 | `loop/runIterationLoop.test.ts:530` | Test claims iterationsRun=0 but never asserts it | MEDIUM | [x] |
| 30 | T4 | `testing/service-test-mocks.ts:107` | Shared chain state across .from() calls in mock | LOW-MED | [x] |
| 31 | P15 | `pipeline/finalize/persistRunResults.ts:218` | Variable shadowing: inner `result` shadows outer EvolutionResult param | MEDIUM | [x] |

### LOWER PRIORITY

| # | ID | File | Summary | Severity | Status |
|---|-----|------|---------|----------|--------|
| 32 | C8 | `pipeline/infra/createLLMClient.ts:94` | Fire-and-forget cost writes can race with finalization cost write | LOW | [~] |
| 33 | C9 | `metrics/computations/finalization.ts:20-21` | computeWinnerElo uses `?? 0` default vs selectWinner's `?? -Infinity` | LOW | [x] |
| 34 | C11 | `pipeline/finalize/persistRunResults.ts:287` | Deprecated update_strategy_aggregates RPC still called | LOW | [x] |
| 35 | C12 | `evolution/docs/architecture.md:509-525` | Key file reference paths are stale | LOW | [x] |
| 36 | C7 | `pipeline/finalize/persistRunResults.ts:373-376` | Arena match count only counts decisive matches (confidence > 0) | LOW | [x] |
| 37 | S5 | `services/evolutionActions.ts:426-428` | getEvolutionRunLogsAction missing pagination bound validation | LOW | [x] |
| 38 | S6 | `services/arenaActions.ts:153-155` | Arena pagination skipped when only limit provided (no offset) | LOW | [x] |
| 39 | S11 | `pipeline/manageExperiments.ts:113-147` | computeExperimentMetrics uses run_summary.totalCost instead of metrics table | LOW | [x] |
| 40 | S13 | `services/arenaActions.ts:80-87` | getArenaTopicsAction fetches ALL variant rows for counting | LOW | [x] |
| 41 | P3 | `pipeline/loop/rankVariants.ts:313` | Top-20% index degenerate for small pools (<10 variants) | LOW | [~] |
| 42 | P10 | `shared/computeRatings.ts:232-249` | parseWinner ambiguous when response mentions both TEXT A and TEXT B | LOW | [x] |
| 43 | P12 | `shared/enforceVariantFormat.ts:23` | Sentence counting fooled by abbreviations (Dr., St., etc.) | LOW | [x] |
| 44 | U-redirect | `admin/evolution/page.tsx` | Dashboard redirect goes outside URL hierarchy | MEDIUM | [x] |
| 45 | U-empty | `admin/evolution/experiments/page.tsx:122` | Empty state has raw URL path instead of clickable Link | LOW | [x] |
| 46 | U-err | `admin/evolution/strategies/[strategyId]/page.tsx:85-92` | Error page lacks breadcrumbs/back navigation | LOW | [x] |
| 47 | U-a11y1 | `_components/ExperimentForm.tsx:193-210` | Step indicators not keyboard-accessible | LOW | [x] |
| 48 | U-a11y2 | `admin/evolution/arena/[topicId]/page.tsx:212-217` | Sortable headers lack ARIA/keyboard support | LOW | [x] |
| 49 | U-swallow | `evolution/EntityListPage.tsx:149` | Catch block swallows error details | LOW | [x] |
| 50 | U-dash | `admin/evolution-dashboard/page.tsx:103` | Total runs count misses cancelled runs | LOW | [x] |

---

## SUMMARY

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
| **TOTAL** | **42** | **3** (partial) | **5** | **50** |

### Top 10 Most Impactful (all confirmed)

1. **C1** (HIGH) — `iterationsRun` wrong on early exit → bad run summaries in DB
2. **S7** (HIGH) — Stale metric recomputation overwrites real metrics with zeros
3. **U1-dup** (MED) — Cancel button on wrong experiments (reversed condition)
4. **P18** (MED) — Arena match count lost-update race condition
5. **T1** (MED) — Test fixture uses wrong keys, silently corrupts test data
6. **T2** (MED) — Test mocks wrong function, passes for wrong reason
7. **C3** (MED) — Experiment cost totals exclude runs without winners
8. **S4** (MED) — Experiment name dedup TOCTOU + suffix numbering error
9. **U-cancel** (MED) — 3 components all fail to refresh after cancellation
10. **S10** (MED) — Cost analytics loads unbounded rows into memory
