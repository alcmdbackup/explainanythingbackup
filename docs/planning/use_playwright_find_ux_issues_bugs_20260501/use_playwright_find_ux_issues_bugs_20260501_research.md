# use_playwright_find_ux_issues_bugs_20260501 Research

## Problem Statement
Use the `.claude/skills/maintenance/bugs-ux/` skill to drive Playwright (MCP, headless) against the local evolution admin dashboard, find ≥50 bugs and UX issues, and document them with severity, location, and suspected cause for follow-up fixes + regression tests.

## Requirements (from GH Issue #NNN)
- Sweep evolution admin pages on the local dev server
- Use the `bugs-ux` skill's 4-angle approach (functional, visual/layout, error states, accessibility)
- Classify findings as Bug-Critical/Major/Minor or UX-Major/Minor
- Reach ≥50 distinct findings
- Apply the user_testing.md two-pass discipline: Playwright sweep → source-code audit before writing fix tickets

## High Level Summary

**Server**: local tmux dev server at `http://localhost:3155` (instance `0d0da359cf478003`).
**Auth**: logged in as `abecha@gmail.com` (admin role).
**Pages swept**: dashboard, runs list, one run detail (Timeline/Metrics/Cost Estimates tabs), experiments list, arena topics list, one arena topic detail.
**Total findings logged**: 53 candidates → 1 false positive (#10) dropped → **52 valid findings**.
**Critical/Major bugs (Bug-Critical/Bug-Major)**: 9 (#11, #22, #29, #30, #31, #38, #42).
**UX-Major issues**: 5 (#7, #12, #15, #33, #37, #48).
**Three top bugs source-audited and confirmed** with file:line + fix sketch — see "Pass-2 audit" section below.

The most damaging finding is **#29-31**: the run-detail Metrics tab is rendering ELO-attribution metrics through the cost formatter, producing nonsensical dollar values like `$-4.655`. Root cause is a one-line default in `EntityMetricsTab.tsx:36-41`. This regression is likely fresh (post-Phase 5 attribution rollout) and is silently visible to every admin viewing any run.

Secondary high-impact findings cluster in three areas:
1. **Cost reconciliation** — reflection_cost is rolled into `cost` but excluded from the runs-list column set and the fallback sum (#11), so per-purpose columns don't reconcile to Spent.
2. **Reflect-and-generate observability** — the wrapper agent's tactic field is misread (#38), causing the Cost Estimates tactic column to be blank for every reflect+generate invocation. Also affects the Timeline / Metrics tab badge labels (#22, #40).
3. **Pagination + table density** — the runs list defaults to all 14 columns visible (#12, #15), the experiments list doubles row height with bracketed CIs (#44), and the arena leaderboard has 11+ columns with no column-visibility picker (#51).

A recurring accessibility pattern: live regions (`Updated Xs ago` #8), button-shaped non-buttons (#13), unlabelled "Delete" buttons (#18), and dollar-prefixed status indicators are pervasive across pages.

## Pages Visited (with screenshots)

| Page | Screenshot |
|---|---|
| Dashboard | `findings/screenshots/01-dashboard.png` |
| Run detail — Timeline | `findings/screenshots/02-run-detail-timeline.png` |
| Run detail — Metrics | `findings/screenshots/03-run-metrics.png` (NEGATIVE COST CARDS) |
| Run detail — Cost Estimates (loading skeleton) | `findings/screenshots/04-run-cost-estimates.png` |
| Run detail — Cost Estimates (loaded) | `findings/screenshots/04c-cost-estimates-after-wait.png` |
| Experiments list | `findings/screenshots/05-experiments-list.png` |
| Arena topics list | `findings/screenshots/06-arena-list.png` |
| Arena topic detail (top) | `findings/screenshots/07-arena-leaderboard.png` |
| Arena topic detail (leaderboard) | `findings/screenshots/08-arena-leaderboard-scrolled.png` |

## Findings (raw, with severity)

See `findings/raw_findings.md` for the full numbered list. Summary by severity:

| Severity | Count | Numbers |
|---|---|---|
| Bug-Critical (P0) | 1 | #29 |
| Bug-Major (P1) | 8 | #11, #22, #30, #31, #38, #42 (also #29 if considered "data-display crash" not just visual) |
| Bug-Minor (P2) | 11 | #4, #8, #14, #17, #21, #32, #35, #36, #43, #50, #53 |
| UX-Major (P1) | 6 | #7, #12, #15, #33, #37, #48 |
| UX-Minor (P2) | 26 | most other findings |
| False positive | 1 | #10 (dropped after audit) |

## Pass-2 source-code audit results

Three highest-priority findings were audited against source. **All three confirmed as real bugs with precise root causes:**

### #29-31: Negative-dollar cost cards on Metrics tab

- **File**: `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:36-41`
- **Cause**: `resolveFormatter()` defaults all `DYNAMIC_METRIC_PREFIXES` (`eloAttrDelta:*`, `eloAttrDeltaHist:*`, `agentCost:*`) to the `costDetailed` formatter. `eloAttrDelta:*` rows are signed Elo-point deltas (per `metrics.md` § "ELO-delta attribution metrics") — formatting them as USD produces values like `$-1.951` and `[$-9.274, $3.836]`.
- **Fix**: prefix-dispatch in `resolveFormatter()` — route `eloAttrDelta:*` and `eloAttrDeltaHist:*` to `elo` formatter, keep only `agentCost:*` on `costDetailed`. Also fix `resolveCategory()` so attribution rows are grouped under "Rating", not "Cost".

### #11: Run-list cost columns don't sum to Spent

- **Files**: `evolution/src/lib/core/metricCatalog.ts:28` and `evolution/src/components/evolution/tables/RunsTable.tsx` (~line 131).
- **Cause**: `reflection_cost` is `listView: false` so the runs list has no Reflection Cost column; the table's fallback `Spent` calc sums Generation+Ranking+Seed cost but **omits** `reflection_cost`, so when the rollup `cost` metric is stale and the fallback fires the math doesn't reconcile.
- **Fix**: flip `reflection_cost.listView` to `true` (adds the column), and include `reflection_cost` in the fallback sum.

### #38: Tactic column blank on Cost Estimates tab

- **File**: `evolution/src/services/costEstimationActions.ts:282`.
- **Cause**: server action reads `d.strategy` from `execution_detail`, but the wrapper agent (`reflectAndGenerateFromPreviousArticle.ts:449`) writes `execution_detail.tactic`. Legacy `strategy` field belongs to `GenerateFromPreviousArticleAgent`'s variant attribution — wrong source for invocation-level tactic display.
- **Fix**: change `d.strategy` → `d.tactic` (and consider falling back to `d.strategy` for legacy GFPA rows).

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/user_testing.md
- docs/planning/user_testing_for_bugs_ux_issues_20260326/user_testing_for_bugs_ux_issues_20260326_planning.md
- evolution/docs/{README,architecture,cost_optimization,strategies_and_experiments,rating_and_comparison,logging,entities,metrics,data_model,curriculum,arena,visualization,minicomputer_deployment,reference}.md
- evolution/docs/agents/overview.md
- .claude/skills/maintenance/bugs-ux/SKILL.md

## Code Files Read (for pass-2 audit)
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — formatter dispatch
- `evolution/src/lib/metrics/types.ts` — DYNAMIC_METRIC_PREFIXES whitelist
- `evolution/src/services/costEstimationActions.ts` — Cost Estimates tab data source
- `evolution/src/lib/core/metricCatalog.ts` — listView flags + formatter assignments
- `evolution/src/components/evolution/tables/RunsTable.tsx` — Spent fallback sum
- `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` — execution_detail shape

## Key Findings (numbered list)

1. The metrics tab cost-formatter routing is the highest-priority bug — every admin viewing any reflect+generate run sees nonsense negative dollar values. Single-line fix.
2. Three independent reflection-cost reconciliation gaps (column hidden, fallback excludes, tactic column reads wrong field) all stem from incomplete rollout of the reflection wrapper. They should be batched.
3. The runs list is unusable on a 1280px viewport with all 14 columns on by default. Default column subset is the right fix.
4. Multiple browser tabs lack `metadata.title` (run detail, arena detail) — ~30s fix per route, big a11y win.
5. The `Hide test content` filter relies on the `is_test_content` column for prompts and experiments (per migration `20260423000001`). Some legacy rows (e.g. "Test new reflection agent" experiments) aren't flagged because the trigger only fires on INSERT/UPDATE-OF-name. A one-time backfill would clear the noise.

## Open Questions

1. Are the three negative-cost rows (#29-31) being saved to `evolution_metrics` correctly (with the right `metric_name` matching the `eloAttrDelta:*` schema), or is the data also wrong?  
   **Hypothesis**: data is fine — the metrics doc explicitly defines `eloAttrDelta:*` as signed Elo deltas. Only the formatter is wrong.
2. Is the runs-list `Spent` column reading the rollup `cost` metric or the fallback sum on this run?  
   **Hypothesis**: the rollup is correct ($0.04 matches everywhere) — the fallback only fires for legacy/stale rows. So #11 is a "stale-row regression" not a current data bug. Still worth fixing to prevent future regressions.
3. Some Avg Estimation Error % outliers in the experiments list are >200% — are these real outliers or a calc bug?  
   **Hypothesis**: real outliers from early-development runs with bad estimates. Should be visually clamped, not numerically clamped.
