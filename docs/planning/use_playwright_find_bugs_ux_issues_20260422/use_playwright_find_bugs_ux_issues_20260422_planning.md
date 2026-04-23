# Use Playwright Find Bugs UX Issues Plan

## Background
Look at Evolution admin dashboard and use Playwright to look for bugs and UX issues to solve.

## Requirements (from GH Issue #1005)
Look at Evolution admin dashboard and use Playwright to look for 100 bugs and UX issues to solve.

## Problem
After three audit passes (initial Playwright sweep + two source-code verifications) the verified yield was 9 bugs and 31 UX issues. A planning pass then dropped 3 more UX items as intentional behavior or snapshot artifacts (see "Considered and dropped" below), leaving **9 bugs + 28 UX = 37 actionable items**. Two systemic root causes drive ~6 of the 9 bugs and several UX surfaces:
1. **Test-content filter scope gap** — `applyTestContentNameFilter` matches only three string substrings; the timestamp-pattern regex from `isTestContentName` is missing, AND it's only applied to the strategies/experiments tables that have an `is_test_content` column. Causes test rows to leak into prompts, arena topics, and the wizard pickers.
2. **Cost-metric population gap** — some completed runs lack a `cost` row in `evolution_metrics`. The dashboard partially falls back; the runs list does not. Causes the "$0.00" displays.

Both can be fixed centrally — fixing the filter clears 4 surfaces, fixing the cost source clears 2.

## Options Considered

- [ ] **Option A: Land all 9 bug fixes in one PR; UX in follow-ups.** Smallest blast radius for the high-priority work; UX improvements ship later when there's time.
- [ ] **Option B: One PR per cluster (filter gap, cost source, hydration/scale, logs sort, wizard, plus UX).** Easier to review; longer total cycle time. (Recommended.)
- [ ] **Option C: One mega-PR for everything.** Fastest to ship if reviewers can stomach a 30-file diff; risky for regression isolation.

## Phased Execution Plan

### Phase 1 — Test-content filter scope gap (clears B17 + drives B3 second cause + UX leakage on prompts/arena/wizard/experiments)

Tables that take the `filterTestContent` flag today: `evolution_strategies` (has `is_test_content` column + trigger), `evolution_prompts` (no column — name-based filter only), arena topics surface (filtered through prompts), `evolution_experiments` (no column — name-based filter only).

- [ ] **(B3 first cause)** On `src/app/admin/evolution/runs/page.tsx:65`, pass `filterTestContent: true` (when the toggle is checked) to `listStrategiesAction` so the Strategy dropdown also filters.
- [ ] **(Path decision — pick ONE)** for tables without an `is_test_content` column (`evolution_prompts`, `evolution_experiments`):
  - **Path A (preferred):** New migration `supabase/migrations/<timestamp>_add_is_test_content_to_prompts_experiments.sql` modeled on `20260415000001`. **Wrap the entire migration in `BEGIN; ... COMMIT;`** so all statements run atomically and the ordering below is guaranteed. (Supabase's `db push` and CI `deploy-migrations` execute each migration file in a transaction by default, but the explicit `BEGIN;`/`COMMIT;` makes the contract obvious to future readers and is harmless if Supabase semantics change.) Statement order inside the transaction:
    - `ALTER TABLE evolution_prompts ADD COLUMN is_test_content BOOLEAN NOT NULL DEFAULT false;`
    - Same for `evolution_experiments`.
    - Reuse the existing `evolution_is_test_name(text)` IMMUTABLE function — do **not** redefine.
    - **Backfill UPDATE** runs BEFORE trigger creation: `UPDATE evolution_prompts SET is_test_content = evolution_is_test_name(name); UPDATE evolution_experiments SET is_test_content = evolution_is_test_name(name);` — this catches existing rows (the trigger only fires on subsequent writes).
    - **THEN** create the BEFORE INSERT/UPDATE-OF-name trigger that sets `NEW.is_test_content := evolution_is_test_name(NEW.name)`.
    - Update `applyTestContentNameFilter` in `evolution/src/services/shared.ts:103-109` to use a PostgREST inner join on `is_test_content` for these tables (same pattern strategies already uses). [code change, separate from migration]
    - Indexes: `CREATE INDEX idx_evolution_prompts_is_test_content ON evolution_prompts (is_test_content);` (same for experiments).
  - **Path B (fallback if migration is too costly):** Extend `applyTestContentNameFilter` only — add a Postgres `~` regex predicate (`name ~ '^.*-\d{10,13}-.*$'`) matching `isTestContentName`. The regex string is hardcoded (no SQL-injection surface), but every list query pays a sequential regex scan. **Performance threshold for falling back to Path A**: if any list query on the affected tables exceeds **500 ms p95** in staging Honeycomb after Path B lands, escalate to Path A (add the column + index). Today the affected tables (`evolution_prompts`, `evolution_experiments`) are < 200 rows so Path B is safely under threshold; if they grow past ~5000 rows the regex scan starts to bite.
- [ ] **Backfill verification on existing strategies table.** Migration `20260415000001` defines the trigger (lines 41-54) AFTER the backfill UPDATE (line 38), which is the correct order. Add a one-time integration test that asserts `SELECT count(*) FROM evolution_strategies WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name) = 0`. If the count is non-zero, run the backfill manually as `UPDATE evolution_strategies SET is_test_content = evolution_is_test_name(name) WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);`.

### Phase 2 — Cost-metric source/fallback (B1, B2)

**Pre-work (must finish before any code change):**
- [ ] **Runtime trace on B1 mystery.** Manually reproduce on `/admin/evolution-dashboard`: toggle "Hide test content" off and capture the SQL `getEvolutionDashboardDataAction` issues (via Supabase logs, or by adding `console.debug` to `evolutionVisualizationActions.ts:118-138` temporarily). Document the exact mechanism. The current code does two things in sequence: (1) `.from('evolution_metrics').eq('metric_name', 'cost')` on `filteredRunIds`; (2) if `totalCostUsd === 0`, fall back to the `evolution_run_costs` view. Candidate mechanisms: (a) cost metric rows are missing entirely for production runs (not just test runs) when the filter is off, so the view-fallback fires and returns its own zero because the view is empty; (b) `filteredRunIds` grows too long for the PostgREST `.in()` filter and the query silently truncates; (c) a JOIN elsewhere in the aggregator NULLs out results when the run-id set is mixed. **Concrete debug logging** to add temporarily: `logger.debug('B1 trace', { filteredRunIds_length: filteredRunIds.length, cost_metric_row_count: <result.length>, sum_from_metrics: totalCostUsd, fallback_view_count: <view_result?.length ?? 0>, sum_from_view: <view_total ?? 0> })`. **Success criterion for the trace:** the implementer can name the specific code path from `filterTestContent=false` to a $0 result (e.g. "metrics returns 0 rows because production runs lack cost metric rows; fallback returns 0 because view is empty for those run_ids"). **Where to record the findings (mandatory, both):**
1. **In the helper file** — write the named code path as a comment-block at the top of `evolution/src/lib/cost/getRunCostWithFallback.ts`, format `// B1 trace findings (2026-04-DD): <named path>. <one-line implication for the fallback chain>.`
2. **In the implementation PR body** — paste the same finding under a `## B1 root cause` heading so reviewers can validate the pre-work happened before approving the code change.

If the trace is inconclusive after one debugging session, file an unblock-help issue rather than guessing.

**Code:**
- [ ] **Centralize the fallback chain.** Create `evolution/src/lib/cost/getRunCostWithFallback.ts` exporting `getRunCostsWithFallback(runIds: string[], db: SupabaseClient): Promise<Map<runId, number>>`. The current code at `evolutionVisualizationActions.ts:131-138` only goes from `cost` row → `evolution_run_costs` view; the **middle layer (sum gen+rank+seed cost rows) is NEW behavior introduced by this work**. Full chain:
  1. Read `evolution_metrics` rows where `metric_name = 'cost'` and `entity_id IN runIds`.
  2. **(NEW)** For any run without a `cost` row, look for `generation_cost + ranking_cost + seed_cost` rows in the same table; sum what exists.
  3. For any still-missing run, query `evolution_run_costs` view for `SUM(cost_usd)`.
  4. For any still-missing run, return 0 with a `logger.warn` so the operator can see the gap (test-spy on this).
- [ ] **Use the helper from both call sites.** Update `RunsTable.tsx:115-139` and `getEvolutionDashboardDataAction` in `evolution/src/services/evolutionVisualizationActions.ts:118-138` to call `getRunCostsWithFallback`. Remove the duplicated chain.
- [ ] **Add the runtime trace findings to inline comments in the helper** so future readers know why the fallback exists.

**Backfill script:**
- [ ] Create `evolution/scripts/backfillRunCostMetric.ts` modeled on the existing `evolution/scripts/backfillInvocationCostFromTokens.ts` pattern. Required behavior:
  - Connect via `SUPABASE_SERVICE_ROLE_KEY` (full DB access; bypasses RLS — appropriate for a one-time backfill).
  - Default `--dry-run`; require `--apply` to write.
  - **Run-selection criterion**: target only runs where `evolution_runs.status = 'completed'` AND there is no `evolution_metrics` row with `entity_type='run' AND entity_id=run.id AND metric_name='cost'`. **Do not** include `'failed'` runs — they may have legitimately stopped before the cost metric was written, but their cost is captured at the invocation level for forensic purposes; conflating them into a `cost` metric would mis-attribute partial spend. **Do not** include `'cancelled'` or `'pending'` runs.
  - For each qualifying run: compute `sum(cost_usd)` from `evolution_agent_invocations` for that `run_id`, then call `writeMetricMax(...)` (use GREATEST semantics — never overwrite a larger existing value with a smaller one). Same approach as `backfillInvocationCostFromTokens.ts:217`.
  - Wrap each per-run write in a try/catch; log failures to stderr with `runId`; continue. Don't abort on a single failure.
  - **Audit trail**: write every successfully-touched `runId` to a timestamped report file at `evolution/scripts/backfill-reports/cost-backfill-<UTC-timestamp>.json` ({ "writtenAt": "...", "runIds": [...] }). The script must do this BEFORE the corresponding `writeMetricMax` call so a crash mid-write still leaves a recoverable list.
  - Log `attempted / wrote / skipped / errored` counts at the end.
  - **Rollback**: only delete rows the script itself wrote, not pre-existing ones. The script's report file is JSON: `{ "writtenAt": "2026-04-23T05:00:00Z", "runIds": ["uuid-1", "uuid-2", ...] }`. The operator-side rollback is a small bash + psql pipeline. **Operator pre-conditions** (must hold to run the snippet): (1) shell is at the repo root (`pwd` ends in `/explainanything-worktree*` or equivalent); (2) `npm` is on PATH (Node ≥ 18 per `package.json` engines); (3) `jq` is installed (per `docs/docs_overall/debugging.md` prerequisites); (4) `.env.prod.readonly` contains the prod connection string for `npm run query:prod`.
    ```bash
    REPORT=evolution/scripts/backfill-reports/cost-backfill-2026-04-23T05-00-00Z.json
    IDS=$(jq -r '.runIds | map("'" + . + "'") | join(",")' "$REPORT")
    npm run query:prod -- "DELETE FROM evolution_metrics WHERE metric_name='cost' AND entity_id IN ($IDS) RETURNING entity_id;"
    ```
    Document this in the script header so the operator can revert. **Do not use a broad WHERE clause** (e.g. `metric_name='cost'` alone) — that would delete legitimately pre-existing `cost` rows.
- [ ] Add `evolution/scripts/backfillRunCostMetric.test.ts` exercising the dry-run path against a fixture.

### Phase 3 — Variants page hydration + scale bugs (B5, B6)

This fixes a real **scale-mismatch bug**, not a rendering glitch — `parent.mu` (~25 OpenSkill) was being used where `parent.elo` (~1250) was expected, breaking all `Δ` calculations on the page.

- [ ] In `src/app/admin/evolution/variants/page.tsx:99`, mark the `parent_variant_id` column with `skipLink: true` so `EntityListPage` doesn't wrap its `VariantParentBadge` Link inside the row's outer Link. (This flag has existed since `EntityListPage` was introduced — it was a forgotten flag, not a missing primitive.)
- [ ] In `evolution/src/services/evolutionActions.ts:763`, replace `parent.mu` with the Elo value from `dbToRating(parent.mu, parent.sigma).elo`. **Verify all callers**: the only other place in the codebase that builds `parentElo` for a variant is `evolution/src/services/arenaActions.ts:253`, which assigns the pre-computed `elo_score` column directly (already in Elo scale). The two paths produce equivalent results because `evolution_variants.elo_score` is maintained in lock-step with `mu` via the `dbToRating()` projection at write time. The fix on line 763 should produce the same output as line 253 for the same variant. (No other call sites found via `grep -r "parentElo\|parent_elo" evolution/src src/`.)
- [ ] Unit test: `evolutionActions.test.ts` — assert variant-list row for a known parent shows the same Elo value as the arena page (mock OpenSkill `mu=19, sigma=9` → expect `elo ≈ 1105 ± 145`).
- [ ] Manual: regenerate `.playwright-mcp` snapshot for run `d790381c` and verify the parent rating renders as `~1105 ± 145` instead of `19 ± 9`.

### Phase 4 — Estimation Error % display + Logs sort (B7, B13)

- [ ] **B7 prescriptive fix** — the upstream stores values as already-percent (`-38.2`). The Metrics-tab formatter then multiplies by 100 again to get `-3821%`. **Drop the redundant `* 100` in the formatter** — do not change upstream computation, since `costEstimationActions.ts:187-191` and the runs-list column reader already display values correctly. **Locate the formatter:** start by `grep -rn 'cost_estimation_error_pct\|estimation_error_pct' evolution/src/lib/metrics/ src/app/admin/evolution/runs/` — the percent-formatter that fires on the Metrics tab will appear in `evolution/src/lib/metrics/metricColumns.tsx` or in a `MetricsTab` consumer. The Metrics-tab section heading is "Cost"; the rendering goes through `MetricGrid` (already verified to live in `EntityMetricsTab.tsx`). Same fix clears the runs-list "-3821%" sentinel display (B16 root cause).
- [ ] **B13** — `evolution/src/services/logActions.ts:65` — append `.order('id', { ascending: true })` after the existing `created_at` order. Verified: `evolution_logs.id` is `BIGSERIAL` per `data_model.md:166`, so it is monotonically increasing per insertion order — safe as a stable secondary key. **Concurrency note:** Postgres BIGSERIAL is backed by a sequence (`nextval()`) which is atomic across concurrent inserts; two writes in the same millisecond will get distinct, monotonically-increasing `id` values regardless of which transaction commits first. So `id` is a safe tie-breaker even under high write concurrency. No additional test for clock-skew is needed — the sequence guarantees the property at the storage layer.

### Phase 5 — UX cluster: clarity / labeling
- [ ] Hide `± $0.00` on the dashboard avg-cost when half-width rounds below display precision (U1).
- [ ] Add a tooltip to the run-header rating ("uncertainty = 1σ in Elo space; 95% CI ≈ ±1.96·uncertainty") (U6).
- [ ] In `VariantParentBadge.tsx:73-113`, restructure the 4-piece parent cell into a 2-line stacked layout (U8). Suggested layout: line 1 is `Parent #abc12345 [other-run-pill?]`, line 2 is `<parent-elo> ± <parent-uncertainty> · Δ <delta-elo> [<ci-low>, <ci-high>]`. Keeps each line scannable; replaces the inline bullet `·` between line-1 and line-2 with an actual newline. The line-2 inline bullets stay as separators within a single semantic group.
- [ ] Add `aria-label="Run winner"` and a hover tooltip to the `★` icon in `evolution/src/components/evolution/tabs/VariantsTab.tsx:184` (U9).
- [ ] Decide on the Cost Estimates "Strategy" column (U10): drop it for `generate_from_previous_article` rows, or pull from the run's strategy and show inline.
- [ ] Add a one-line legend / column-header tooltip explaining `est+act` / `no-llm` for the Coverage column (U11).
- [ ] Add a header tooltip on Generation/Ranking/Seed cost columns explaining whether `Spent` includes them (U23).
- [ ] Decide on `evolution_variants.generation` display name: standardize on either "Iteration" or "Generation" across the global variants list and the run-detail Variants tab (U18).
- [ ] Track down why some strategy rows in the wizard render only the slug or only `[TEST] Strategy` instead of the full `labelStrategyConfig` output (U14). The renderer at `ExperimentForm.tsx:400-403` is consistent (uses `s.name` + `s.label`); inconsistency is in the upstream label data — some strategies have an empty `label` field. Either backfill labels for those rows or have the renderer call `labelStrategyConfig(config)` as a fallback when `label` is empty.

### Phase 6 — UX cluster: filters / list ergonomics
- [ ] Wire `RefreshIndicator` from `AutoRefreshProvider.tsx:107-140` into the dashboard page (U2). Component already exists.
- [ ] Add a column-picker (`columnVisibility` state + popover) to the runs list to manage 14 columns (U3).
- [ ] **Replace runs-list Strategy `<select>` with a searchable Combobox (U4) — two-step:**
  - Step 1: Extract a generic `Combobox` UI primitive at `src/components/ui/combobox.tsx` from the existing domain-specific `src/components/sources/SourceCombobox.tsx`. Refactor `SourceCombobox` to consume it. (No behavior change.)
  - **Risk mitigation (permanent CI coverage, not one-time gate):** add a NEW E2E spec `src/__tests__/e2e/specs/08-sources/source-combobox-behavior.spec.ts` tagged `{ tag: '@critical' }` so it runs on every PR to `main`. The spec exercises 4 behaviors of `SourceCombobox`: (a) typing into the input filters the list, (b) keyboard arrow navigation works, (c) clicking an option populates the field, (d) async option-loading still resolves. The spec stays in the repo permanently so any future refactor of either the primitive or `SourceCombobox` is regression-pinned. Run it before Step 1 (baseline), after Step 1 (refactor verified), and after every subsequent change in CI. If pre-Step-1 behavior diverges from post-Step-1 behavior, the extracted primitive lost a subtlety and must be patched before Step 2.
  - Step 2: Use the new primitive on the runs page Strategy filter.
- [ ] Pre-filter the Variants-tab tactic dropdown to tactics actually present in the run's variants (U7).
- [ ] Standardize date format across list pages — pick one of `formatDate` / `toLocaleString` and use it for every `Created` column (U15).
- [ ] Default `defaultChecked: true` on Arena Topics "Hide empty topics" (U16): change `src/app/admin/evolution/arena/page.tsx:22-26`.
- [ ] Add a Run-ID text-input filter on the invocations page toolbar (U17).

### Phase 7 — UX cluster: visual / structural
- [ ] Drop the `(has errors)` suffix in `evolution/src/components/evolution/primitives/StatusBadge.tsx:139` (U5). Add it back only for partial failures (e.g. "Failed during ranking").
- [ ] Remove the dashboard recent-runs `cursor-pointer` if the row isn't fully clickable (U19).
- [ ] Either drop the bottom dashboard quick-link cards or replace them with per-entity counts (U20).
- [ ] Add `aria-hidden="true"` to the emoji spans in the sidebar `Navigation.tsx` (U21).
- [ ] Convert "GFSA Error Distribution" tiles to a real horizontal bar chart in `CostEstimatesTab.tsx` (U25).
- [ ] Group the 11 Cost metrics in MetricsTab into "Spent" + "Estimation accuracy" sections (U26).
- [ ] Use `formatEloCIRange` (integer rounding) for CI ranges in the MetricsTab (U27).
- [ ] Hide the "Type" column on `tactics/page.tsx` only when every visible row is `System` (U28). Today every row is System; if user-defined tactics ever land, the column should re-appear.
- [ ] Add hash-prefix disambiguation when wizard renders multiple strategies sharing a name like "Renamed Strategy" (U31).
- [ ] **(U32)** Add `skipLink: true` to all-but-one column on each affected list. Specify which column keeps the link per page:
  - `/admin/evolution/arena` (topics list): keep link on **Name** column; `skipLink: true` on Prompt / Entries / Status / Created.
  - `/admin/evolution/prompts`: keep link on **Name** column; `skipLink: true` on Prompt / Status / Created. Per-row Edit/Delete buttons stay clickable (already in their own `<button>` not an `<a>`).
  - `/admin/evolution/invocations`: keep link on **ID** column; `skipLink: true` on Run ID (already has `skipLink: true`), Agent, Iteration, Status, Cost, Duration, Created.
- [ ] Drop the "Cost" column on the arena topic detail leaderboard (it's documented as never populated) (U33).

### Phase 8 — Investigate B14 (timeline duration drift) — partial bug, deferred from main fix list
- [ ] Investigate the 3-second drift between `153.x s` cards (header + iteration card) and `2m 37s` (Run Outcome card) on `/admin/evolution/runs/[id]?tab=timeline`. Two timer sources are reading the same invocation data but at different points; identify the discrepancy and standardize on one source. The 0.2s rounding gap between the two `153.x` values is incidental.
- [ ] **Sample-run selection**: pick 5 runs in this stratification — 2 short runs (< 30s wall-clock), 2 medium runs (30–180s), 1 long run (> 180s). For each, open the Timeline tab and capture the three timer values (header `wall-clock Xs`, iteration card `Xs`, Run Outcome `Xm Ys`). Use `npm run query:staging -- "SELECT id, completed_at - claimed_at AS duration FROM evolution_runs WHERE status='completed' ORDER BY duration ..."` to find candidates.
- [ ] **Trigger to file a follow-up plan**: if the drift is > 1s on **2 or more** of the 5 sample runs (≥ 40% of cases), file a follow-up planning doc. If drift is sporadic (≤ 1 run of 5), document the root cause in `evolution/docs/visualization.md` as known and stop. If drift is exactly 0 on the sample, mark the partial bug as resolved without a follow-up. The wall-clock duration computed from `evolution_runs.completed_at - claimed_at` is the ground truth source if the follow-up is filed; the iteration-card and Run-Outcome timers should reconcile to it.

### Considered and dropped during planning (3 items)

These three were in the verified UX list but the audit notes flag them as either intentional behavior or based on a snapshot artifact — including them in the plan would mean changing already-correct code:

- **U24** "Failed runs show bare `—` for Max Elo / Decisive Rate / Variants / Estimation Error %" — `metricColumns.tsx:47-48` returns `—` when the metric is missing, which is the honest representation for runs with no variants. The bare em-dash is the expected idiom; adding a hover ("No data — run failed") would help marginally but is not a real UX defect. Leave as-is.
- **U29** "Wizard step indicator uses bullets (`● Strategy Config / ○ Iterations + Submit`) rather than a numbered stepper" — the rendered UI is colored progress bars (`ExperimentForm.tsx:189-214` lines 196-200). The `●`/`○` characters were the accessibility-snapshot's text representation of the bar fill state, not actual rendered glyphs. No change needed.
- **U34** "Cost values use 2/3/4 decimal places across run-detail tabs" — the codebase intentionally exposes three named formatters (`formatCost` / `formatCostDetailed` / `formatCostMicro` in `evolution/src/lib/utils/formatters.ts:6-20`) and per-tab choice is by design. Standardizing would require choosing one precision for all numeric ranges, which loses information. Leave as-is.

## Per-phase rollback

| Phase | Rollback strategy |
|---|---|
| 1 (filter gap) | Land a follow-up migration `<timestamp>_drop_is_test_content_from_prompts_experiments.sql` (`ALTER TABLE evolution_prompts DROP COLUMN is_test_content; ALTER TABLE evolution_experiments DROP COLUMN is_test_content;`) AND deploy it immediately to staging+prod via the standard migration workflow — do NOT leave the column orphaned. Then revert the JS-filter change in a separate code PR. The `applyTestContentNameFilter` change is purely additive on the JS side. |
| 2 (cost source) | Three layers, **executed in this order**: (a) **first** delete the backfill script's writes via the bash+jq+`npm run query:prod` recipe shown in the Phase 2 backfill block above (reads `runIds` from the JSON report file, calls `DELETE FROM evolution_metrics WHERE metric_name='cost' AND entity_id IN (...)`). Doing this AFTER reverting the helper would leave the helper without the rows it was designed to fall back from. (b) **then** revert the `RunsTable` / dashboard helper to consume `getMetricValue` directly. (c) The helper itself can stay (additive); delete it only if the revert PR is closed. |
| 3 (variants page) | Two-line revert: (a) **first** drop the `dbToRating()` call (back to `parent.mu`) — keeps the variants page rendering data even if briefly with the wrong scale; (b) **then** drop `skipLink: true`. Doing `skipLink` first would re-introduce the nested-anchor hydration error while the scale fix is still in place, breaking the page entirely. |
| 4 (estimation/logs) | Code revert. The Estimation Error % is a render-time-only fix; underlying data is unchanged so no DB rollback. |
| 5/6/7 (UX clusters) | Code revert. No data writes. |
| 8 (timeline drift) | Investigation only — no rollback needed unless a fix is implemented. |

## Testing

### Unit Tests
- [ ] `evolution/src/services/shared.test.ts` — add cases for `applyTestContentNameFilter` against `e2e-nav-1775877428914-strategy`, `my-app-1775877428914-prod`, `[TEST]`, `[E2E]`, `[TEST_EVO]`. Verify all five are excluded.
- [ ] `evolution/src/lib/cost/getRunCostWithFallback.test.ts` — assert the fallback chain (cost row present → use it; cost null but gen+rank+seed present → sum them; everything null → fall to view; truly empty → return 0 with warn).
- [ ] `evolution/src/components/evolution/tables/RunsTable.test.tsx` — concrete case: when `metrics.cost === null` and `generation_cost + ranking_cost + seed_cost = $0.10`, assert Spent renders `$0.10` (not `$0.00`).
- [ ] `evolution/src/services/evolutionActions.test.ts` — assert `listVariantsAction` returns parent rating in Elo scale: mock `parent.mu=19, parent.sigma=9`, expect returned `parent_elo ≈ 1105` (not `19`).
- [ ] `evolution/src/components/evolution/variant/VariantParentBadge.test.tsx` — when `crossRun=true`, the copper "other run" pill is rendered AND the displayed parent rating is in Elo scale.
- [ ] `evolution/src/services/logActions.test.ts` — assert `getEntityLogsAction` returns rows in stable order across multiple calls when `created_at` ties (mock 5 logs with identical timestamps and known increasing `id`s).
- [ ] Tab-formatter parity test (Phase 4 B7) — render the Metrics tab and Cost Estimates tab against the same fixture run, assert both display the same `Estimation Error %` value within rounding.
- [ ] `evolution/scripts/backfillRunCostMetric.test.ts` — exercise dry-run; assert the script reports the expected count of runs needing backfill without writing.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-aggregation.integration.test.ts` — three test cases, each must verify the same fallback assertion AND spy on `logger.warn` to confirm the fallback fired:
  - **Case A (legacy data shape)**: seed a run via `createTestEvolutionRun()` then `INSERT INTO evolution_agent_invocations` directly via service-role SQL with `cost_usd=0.05`, AND deliberately do NOT write any `cost` metric row (this matches the production state where some completed runs predate the metric write). Assert `getRunCostsWithFallback` returns `0.05` for that run, the warn fires once, and both the dashboard and runs-list calls return the same value.
  - **Case B (deletion-recovery)**: seed a run with full metric writes (cost row present), then DELETE the `cost` row. Assert the helper still returns the right value via the fallback. (Same assertions as Case A.)
  - **Case C (vacuous-pass guard)**: with the helper unmodified (i.e. against `main`), Case A must FAIL. Add this as a regression-pin so future refactors don't accidentally remove the fallback chain.
  - All three cases must assert the answer is `> 0` and matches the seed value within rounding.
- [ ] `src/__tests__/integration/evolution-test-content-filter.integration.test.ts` — seed `[TEST] X`, `[E2E] Y`, `e2e-nav-1775000000000-z`, real-name `Q` rows in `evolution_prompts`. Call the prompts list action with `filterTestContent: true`. Only `Q` should return.
- [ ] `src/__tests__/integration/evolution-monotonic-cost.integration.test.ts` — seed N test runs and 1 prod run with known per-run costs. Assert `getEvolutionDashboardDataAction` total cost with `filterTestContent: true` is ≤ total with `filterTestContent: false` (off ≥ on, monotonic).
- [ ] `src/__tests__/integration/evolution-is-test-content-backfill.integration.test.ts` — three steps:
  - **Step 1 (trigger path)**: seed 2 `[TEST]`-prefixed strategies AND 2 real-name strategies via `createTestStrategyConfig()` (writes go through the trigger). Assert all 4 have the correct `is_test_content` value via the trigger.
  - **Step 2 (trigger-bypass + backfill path)**: insert 1 `[TEST_EVO] sneaky` strategy via raw SQL `INSERT INTO evolution_strategies (..., is_test_content) VALUES (..., NULL)` — explicitly setting NULL bypasses the trigger's NEW.is_test_content assignment. Then run the migration's backfill UPDATE statement (`UPDATE evolution_strategies SET is_test_content = evolution_is_test_name(name) WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);`). Assert the bypassed row now has `is_test_content=true`. This is the meaningful test — it exercises the backfill UPDATE path, not just the trigger.
  - **Step 3 (global invariant)**: assert `SELECT count(*) FROM evolution_strategies WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name)` is 0 across the whole table.

### E2E Tests (all tagged `@evolution` so they run on PRs to main per `testing_overview.md`)
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-runs.spec.ts` — add `test('hide test content also filters Strategy dropdown', { tag: '@evolution' }, ...)`: open `/admin/evolution/runs`, check "Hide test content", assert the Strategy filter `<select>` has no `[TEST]`/`e2e-*` options.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` — add `test('variants list has no nested-anchor hydration error', { tag: '@evolution' }, ...)`: navigate to `/admin/evolution/variants`, assert no console errors (specifically no `<a> cannot contain a nested <a>`). For the Parent-rating-scale assertion, parse the rendered Parent column (regex `/(\d+)\s*±/` against the cell text) and assert the rating value is in **[600, 2400]** Elo range. **Rationale for the loose band**: default Elo is 1200 ± 1× `DEFAULT_UNCERTAINTY` (~133), giving an expected 95% CI of roughly [940, 1460]. The [600, 2400] band is intentionally ~3× wider to (a) tolerate variants that are well above/below default after extensive matches, AND (b) catch the specific bug at hand — raw OpenSkill `mu=19` would yield a rating value of 19, which is two orders of magnitude below the lower bound. The loose band is a sanity check, not a precision check; the precision check lives in the Phase-3 unit test on `evolutionActions.test.ts`. Asserting only `≥ 100` would silently pass a half-broken state where `mu=25` was multiplied by 5 (=125).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-dashboard.spec.ts` — add `test('Total Cost is monotonic when toggling Hide test content', { tag: '@evolution' }, ...)`: open dashboard with `Hide test content` toggled both on and off, assert `Total Cost` is monotonic-non-decreasing (off ≥ on). Use `createTestEvolutionRun()` to seed both a test and a prod run with known costs in `beforeAll`; assert in `afterAll` that the seeded runs are cleaned up.

### Manual Verification
- [ ] Open `/admin/evolution/runs/[d790381c]?tab=metrics` and `?tab=cost-estimates`, verify Estimation Error % matches between the two tabs (within rounding).
- [ ] Open `/admin/evolution/runs/[long-running-id]?tab=logs`, refresh repeatedly, verify the first ~10 log rows appear in the same order each time.
- [ ] Open the start-experiment wizard, verify both pickers (prompt + strategy) hide `e2e-*` rows.

## CI / deployment notes

- **CI job ordering for Phase 1 (migration).** `ci.yml` runs jobs in this order: `deploy-migrations` (applies to staging) → `generate-types` (regenerates `src/lib/database.types.ts` and auto-commits to the PR branch) → `typecheck` (against the auto-committed types) → `unit + integration + e2e`. Implications for the implementer:
  - If the new column (`is_test_content`) is referenced by code in the same PR, the implementer should run `npm run db:types` locally BEFORE pushing, so the auto-commit doesn't generate a separate fixup. Otherwise the auto-commit is harmless but adds a second commit to the PR.
  - If `typecheck` fails after the auto-commit, the failure is in the code (not the schema) — the implementer must rebase, run `db:types` locally, fix the code to match the new column, and push again. Don't try to fix by editing `database.types.ts` directly.
  - **Integration tests run AFTER `deploy-migrations`** through the implicit chain `unit-tests → typecheck → generate-types → deploy-migrations`. This ordering is fragile — if `ci.yml` is refactored and the chain breaks, integration tests could run before migrations apply, causing schema-mismatch failures. **Hardening — pre-merge requirement (not deferred to infra):** the implementer must add an explicit `needs: [deploy-migrations]` to the `integration-critical` (and `integration-evolution`/`integration-non-evolution` if present) job in `.github/workflows/ci.yml` in the **same PR** that introduces the Phase 1 migration. The PR reviewer must reject the PR if this `needs:` line is missing — do not merge without it. The author has access to `ci.yml`; this is not a separate infra-team task.
- The new `evolution/scripts/backfillRunCostMetric.ts` is operator-run, not CI-run. **Execution order vs Phase 1:** Phase 1 and Phase 2 are independent (Phase 1 touches `evolution_strategies`/`evolution_prompts`/`evolution_experiments`; Phase 2 touches `evolution_metrics`). They can land in either order. The backfill script does NOT need to condition on the new `is_test_content` column; it filters runs by `status='completed'` only. Run on staging first with `--dry-run`, eyeball the report, then `--apply`. Repeat on production after staging shows correct counts. Production run requires the `SUPABASE_SERVICE_ROLE_KEY` for prod (see `docs/docs_overall/environments.md`).
- No new env vars introduced; both backfill script and the cost helper use existing `SUPABASE_SERVICE_ROLE_KEY`.

## Documentation gate

Docs are updated **in the same PR as the code change**, not in a follow-up. Each phase's PR must also touch the listed docs from "Documentation Updates" below. Reviewer should reject if code lands without matching docs.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Re-run `npm run test:e2e -- --grep "@evolution"` after each phase to catch regressions.
- [ ] Manually walk the 9 affected pages in the browser using the same admin login. Diff against the snapshots in `.playwright-mcp/` from the original session — confirm fixed bugs no longer reproduce.

### B) Automated Tests
- [ ] `npm run test:unit -- --testPathPattern "shared|RunsTable|evolutionActions|VariantParentBadge|logActions|getRunCostWithFallback|backfillRunCostMetric"`
- [ ] `npm run test:integration -- --testPathPattern "evolution-cost-aggregation|evolution-test-content-filter|evolution-monotonic-cost|evolution-is-test-content-backfill"`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-runs.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-dashboard.spec.ts --grep @evolution`

## Documentation Updates

The 9 bugs and 28 UX issues above touch behavior described in these docs. Update each in the same PR as the corresponding fix:

- [ ] `evolution/docs/visualization.md` — update if Runs list Spent column source changes (Phase 2), if Strategy filter becomes a combobox (Phase 6), if RefreshIndicator becomes visible on the dashboard (Phase 6).
- [ ] `evolution/docs/metrics.md` — update if `cost` metric is now backfilled or has a fallback chain (Phase 2), and if Estimation Error % units change (Phase 4).
- [ ] `evolution/docs/reference.md` — update if `applyTestContentNameFilter` semantics change (Phase 1), if `VariantParentBadge` fixes scale (Phase 3), if log sort adds secondary key (Phase 4).
- [ ] `evolution/docs/data_model.md` — update if `is_test_content` is added to `evolution_prompts` and `evolution_experiments` (Phase 1).
- [ ] `evolution/docs/architecture.md` — no change expected.
- [ ] `evolution/docs/arena.md` — update if the leaderboard Cost column is dropped (Phase 7).
- [ ] `evolution/docs/strategies_and_experiments.md` — update if wizard adds a hash disambiguator (Phase 7) or if `is_test_content` is added to `evolution_experiments` (Phase 1).
- [ ] `evolution/docs/agents/overview.md`, `evolution/docs/cost_optimization.md`, `evolution/docs/curriculum.md`, `evolution/docs/entities.md`, `evolution/docs/logging.md`, `evolution/docs/minicomputer_deployment.md`, `evolution/docs/rating_and_comparison.md`, `evolution/docs/sample_content/*` — likely no changes.
- [ ] `docs/feature_deep_dives/user_testing.md` — consider adding the verification cycle (Playwright sweep → source-code audit) as a recommended pattern.
- [ ] `docs/feature_deep_dives/testing_setup.md` — likely no change.
- [ ] `docs/docs_overall/debugging.md`, `docs/docs_overall/testing_overview.md`, `docs/docs_overall/environments.md` — likely no change.

## Review & Discussion

### Iteration 1 (initial)

Sec/Tech 3, Arch/Integ 3, Test/CI 2. Critical gaps:

1. **Phase 1** missing migration draft + missing `evolution_experiments` from scope → resolved: Path A now drafts the migration with explicit ALTER/trigger/backfill ordering, and includes `evolution_experiments`.
2. **Phase 2** backfill script doesn't exist + no error handling, no rollback → resolved: script structure documented (writeMetricMax, try/catch, --dry-run default, rollback DELETE statement).
3. **Phase 2** dashboard "$0 when filter loosened" mechanism not understood → resolved: pre-work runtime trace task added BEFORE any code change.
4. **Phase 2** cost-fallback should be centralized → resolved: new `getRunCostsWithFallback` helper at `evolution/src/lib/cost/`, both call sites consume it.
5. **Phase 4** logs sort secondary key on `id` → resolved: verified `evolution_logs.id` is `BIGSERIAL` per `data_model.md:166`, safe.
6. **Phase 6 U4** Combobox primitive doesn't exist generically → resolved: added explicit two-step (extract `Combobox` from `SourceCombobox`, then use it on Strategy filter).
7. **E2E tests** lack `@evolution` tag → resolved: every E2E test specifies `{ tag: '@evolution' }`.
8. **CI gate** missing for migration → type regen → typecheck → resolved: new "CI / deployment notes" section.
9. **B14** (timeline drift) had no fix phase → resolved: added Phase 8 (investigation) so the partial bug isn't lost.

### Iteration 2

Sec/Tech 3, Arch/Integ 4, Test/CI 2. Critical gaps:

1. **`arenaActions.ts:543` is wrong** (file is only 446 lines) — fixed to `:253` everywhere it appears.
2. **Phase 2 fallback step 2 (sum gen+rank+seed)** wasn't called out as NEW behavior — fixed: now explicitly marked "(NEW)" with a note that current code only has the dashboard-→-view fallback.
3. **Phase 2 backfill rollback DELETE was too broad** (could delete legit pre-existing rows) — fixed: backfill now writes `runId` to a per-run report file BEFORE the metric write, and rollback DELETE uses `entity_id = ANY('{<report.runIds>}')` against that exact list.
4. **Phase 1 rollback didn't specify DROP COLUMN timing** — fixed: rollback row now says "follow-up DROP COLUMN migration deployed immediately to staging+prod".
5. **Phase 1 backfill verification test could pass vacuously on empty tables** — fixed: test now seeds 2 test + 2 real strategies as a precondition before the global assertion.
6. **CI ordering under-specified** (typecheck failure path, integration-test ordering vs deploy-migrations) — fixed: "CI / deployment notes" section now spells out the full job ordering and remediation if `typecheck` fails.
7. **E2E variants Parent-rating assertion `≥ 100` was too weak** — fixed: assertion is now Elo range `[600, 2400]` so it would catch a half-broken state where mu=25 was scaled by 5.
8. **Phase 3 rollback order ambiguous** — fixed: rollback row now says drop `dbToRating()` first then `skipLink: true` to avoid re-introducing the hydration error mid-rollback.
9. **Phase 2 cost integration test could pass vacuously** — fixed: test now requires `cost_usd > 0` on the seeded invocation and spies on `logger.warn` to verify the fallback chain actually fired.
10. **Phase 8 trigger condition unspecified** — fixed: "drift > 1s on > 1 of 5 sample runs → file follow-up; sporadic < 1s → document and stop; 0 → resolve".

### Iteration 3

Sec/Tech 4, Arch/Integ 3, Test/CI 2 — but most of the iteration-3 critical gaps from Arch and Test were "code doesn't exist yet", which is a category error in plan review (the plan describes work to be done, not work already complete). The 3 genuine plan-level gaps:

1. **Phase 3 wording about `arenaActions.ts:253`** was misleading — it uses pre-computed `elo_score`, not `dbToRating()`. Fixed: wording now explains the two paths produce equivalent results because `elo_score` is maintained in lock-step with `mu` via `dbToRating()` at write time.
2. **Phase 2 backfill rollback DELETE syntax** was abstract — fixed: now includes a concrete bash + jq + `npm run query:prod` example.
3. **Phase 4 B7 component reference** was vague ("Metrics-tab formatter") — fixed: gives a concrete `grep` command to locate the formatter and notes the rendering path through `MetricGrid` in `EntityMetricsTab.tsx`.

### Iteration 4

Sec/Tech 5 (consensus on this perspective ✓), Arch/Integ 3, Test/CI 4. Genuine plan-level gaps:

1. **Phase 2 rollback DELETE syntax inconsistent** between rollback table (`ANY('{...}')`) and bash example (`IN (...)`) — fixed: rollback table now references the bash recipe instead of duplicating the SQL.
2. **CI ordering implicit not explicit** — fixed: added a hardening recommendation that the implementer should add `needs: [deploy-migrations]` explicitly to the integration-tests job in the same PR.
3. **Phase 2 pre-work success criterion** — fixed: now lists concrete `logger.debug` lines to add and a written success criterion ("the implementer can name the specific code path").
4. **Phase 2 backfill "completed" status undefined** — fixed: `status='completed'` only; explicitly excludes `'failed'`/`'cancelled'`/`'pending'` with reasoning.
5. **Phase 1 Path B performance threshold** — fixed: 500 ms p95 in staging Honeycomb; current row counts mean the threshold is safely under it for now.
6. **Phase 4 B13 concurrent insertion atomicity** — fixed: added a sentence noting BIGSERIAL is backed by a Postgres sequence which is atomic across concurrent transactions.
7. **Phase 6 U4 Combobox extraction risk** — fixed: added a 4-behavior Playwright snapshot test for `SourceCombobox` to run before AND after the extraction, gating Step 2 on no behavior change.
8. **U8 layout vague** — fixed: sketched a 2-line layout (line 1 = parent ID + cross-run pill; line 2 = elo ± uncertainty · Δ + CI).
9. **Phase 2 vs Phase 1 ordering** — fixed: explicitly noted they're independent; backfill doesn't condition on the new column.
10. **Phase 8 sample-run selection** — fixed: stratified sample (2 short / 2 medium / 1 long) with a query to find candidates.

### Iteration 5 (final)

Sec/Tech **5/5 ✓**, Test/CI **5/5 ✓**, Arch/Integ 2/5.

Two of three perspectives reached consensus. The architecture reviewer found 7 NEW critical gaps after previously confirming all iteration-4 fixes were resolved — the gaps surfaced in already-reviewed sections (test pre-conditions, snapshot-test permanence, migration-statement-ordering semantics, B14 wording, CI-recommendation responsibility). Honest read: the architecture reviewer is moving goalposts each iteration rather than accepting the plan converged.

**Of those 7 critical gaps, judgment per item:**
1. "Phase 2 integration test deletes a cost row instead of using realistically-missing data" — **NIT.** The `logger.warn` spy already verifies the fallback chain fires; the deletion approach is a standard test idiom for forcing the missing-data path.
2. "Phase 1 backfill test pre-conditions don't verify `is_test_content IS NULL` before migration" — **PARTIAL.** The test seeds via `createTestStrategyConfig()` which writes through the existing trigger, so the column won't be NULL. The verification is still meaningful (asserts the trigger + global predicate match), but a stronger version would add a row via raw SQL bypassing the trigger to test the backfill UPDATE path. Worth doing in implementation, not blocking.
3. "Phase 6 U4 Combobox snapshot test is one-time gate, not permanent CI" — **NIT.** Refactor-verification snapshot tests are commonly one-time. If the team wants permanent regression coverage, that's an implementation-time choice.
4. "Phase 2 pre-work trace findings location not specified" — **REAL but minor.** Implementer should document the trace in the PR body or as a comment in `getRunCostsWithFallback.ts`.
5. "Phase 1 Path A migration statement ordering" — **NIT.** Postgres/Supabase migrations execute statements top-to-bottom in a single transaction by default. Standard behavior, doesn't need explicit notes.
6. "Phase 8 B14 follow-up filing criteria off-by-one" — **REAL editorial bug** (I had both `≥ 40%` and `strict-greater-than` in the same sentence). Fixed in iteration 5: now reads "**2 or more** of the 5 sample runs (≥ 40% of cases)".
7. "CI hardening recommendation responsibility unclear" — **REAL but minor.** The implementer adds `needs: [deploy-migrations]` in the same PR as the migration; review should reject the PR if it's missing.

**Decision (revised after user push for arch 5/5).** User asked to keep iterating until architecture also reaches 5/5. Iteration 6 below addresses every remaining architecture gap, including the ones I had labeled nits.

### Iteration 6 (architecture-only, addressing all 7 gaps from iter 5)

Fixed in iteration 6:
1. **Phase 2 integration test was a single deletion-based case** — now three explicit cases: A (legacy data shape via raw INSERT bypassing the cost write), B (deletion-recovery), C (regression-pin that asserts Case A FAILS against `main` to prevent silent fallback removal).
2. **Phase 1 backfill test pre-conditions didn't exercise the trigger-bypass path** — now three steps: (1) trigger path via `createTestStrategyConfig()`, (2) trigger-bypass via raw `INSERT ... is_test_content NULL` then run the backfill UPDATE and assert it filled, (3) global invariant check.
3. **Phase 6 U4 Combobox snapshot test was one-time gate** — now a permanent E2E spec at `src/__tests__/e2e/specs/08-sources/source-combobox-behavior.spec.ts` tagged `@critical`, regression-pinned forever.
4. **Phase 2 pre-work trace findings location** — now mandates two locations: comment-block at top of `getRunCostWithFallback.ts` AND a `## B1 root cause` section in the PR body.
5. **Phase 1 Path A migration ordering risk** — now wraps the migration in explicit `BEGIN; ... COMMIT;` and lists the statements in execution order with the backfill before the trigger.
6. **Phase 8 B14 follow-up criteria off-by-one** — already fixed in iteration 5 final pass.
7. **CI hardening responsibility unclear** — now spelled out as a pre-merge requirement enforced by reviewer rejection; author has access to `ci.yml`; not deferred to infra.

Plus minor improvements:
- Backfill rollback bash example now lists operator pre-conditions (cwd at repo root, npm on PATH, jq installed, `.env.prod.readonly` present).
- E2E variants Parent-rating `[600, 2400]` band rationale now explains the precision/sanity split (precision lives in the unit test; the E2E band catches scale-mismatch).

**Iteration 6 final score: Sec 5/5 ✓, Arch 5/5 ✓, Test 5/5 ✓ — full consensus.**

The architecture reviewer confirmed all 7 iteration-5 critical gaps resolved with 0 new critical gaps and 0 minor issues. Summary of their verification (each iteration-5 gap traced to its iteration-6 fix):

1. ✅ Phase 2 integration test: three cases (legacy data shape via raw INSERT, deletion-recovery, regression-pin) with logger.warn spy.
2. ✅ Phase 1 backfill test: three steps with trigger-bypass meaningful test.
3. ✅ Phase 6 U4 Combobox: permanent E2E spec at `08-sources/source-combobox-behavior.spec.ts`, tagged `@critical`.
4. ✅ Phase 2 pre-work trace findings: comment-block at top of `getRunCostWithFallback.ts` AND `## B1 root cause` in PR body.
5. ✅ Phase 1 Path A migration: explicit `BEGIN; ... COMMIT;` with statements in execution order (ALTER → backfill → trigger).
6. ✅ Phase 8 B14 criteria: "**2 or more** of the 5 sample runs (≥ 40% of cases)".
7. ✅ CI hardening `needs: [deploy-migrations]`: pre-merge requirement enforced by reviewer rejection; author responsibility.

This plan is ready for execution.
