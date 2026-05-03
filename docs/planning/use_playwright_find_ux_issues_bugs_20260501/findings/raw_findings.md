# Raw Findings — bugs-ux Playwright Sweep 2026-05-01

Format: `[Page] Severity — Description (suspected cause / repro)`. Pass-1 sweep; pass-2 audit will drop false positives.

Severity legend:
- **Bug-Critical / P0** — crash, data loss, security
- **Bug-Major / P1** — feature broken, console error, blocked flow
- **Bug-Minor / P2** — visual glitch, minor behavior
- **UX-Major / P1** — confusing flow, blocked task, missing feedback
- **UX-Minor / P2** — friction, unclear label, slow

---

## Dashboard (`/admin/evolution-dashboard`)

1. **UX-Minor** — Three "Completed" runs (`90441b07`, `97a6cf50`, `ba2ccfc1`) show `$0.00` in the **Spent** column despite being marked completed. Either the runs genuinely cost nothing (early-exit) or the cost rollup never wrote — there is no visual distinction between "cost = 0" and "cost unknown / not yet rolled up". The inline `!`/`!!` over-budget badge has no negative counterpart for "cost missing".
2. **UX-Minor** — Heading "Evolution Dashboard" appears three times: sidebar header (top-left), breadcrumb, and `<h1>`. Breadcrumb is a single segment so it has no nav value at the dashboard route.
3. **UX-Minor** — Sidebar nav items use emoji as icons (📊 🧪 🔬 📝 ⚙️ ⚔️ 🔄 🤖 📄 🏟️). Emoji rendering is OS-dependent (Linux often falls back to monochrome / boxes), and screen readers may read emoji names as content (e.g. "crossed swords" for Tactics). No `aria-hidden` on the emoji `<generic>` spans.
4. **Bug-Minor** — `↻ Refresh` button has only the unicode arrow + visible text "Refresh"; visible text is fine, but the live region "Updated 9s ago" is not labelled as `aria-live="polite"` (it's a plain `<generic>`). Screen readers won't announce the freshness change.
5. **UX-Minor** — Status badges in the Recent Runs table use only the green check + word "Completed". Color is the only differentiator across statuses — verified later when sweeping `/runs` with mixed statuses.
6. **UX-Minor** — "Hide test content" checkbox label says "Hide test content" but staging has a strategy literally named `Test new reflection agent` that *is* showing. Either the strategy isn't flagged via `is_test_content` (likely — name doesn't match `evolution_is_test_name` patterns) or the filter is broken. Need source-code audit.
7. **UX-Major** — Stat cards (Active Runs, Queue Depth, Completed Runs, Failed Runs, Total Cost, Avg Cost) are not clickable. "Failed Runs: 9" should drill down to `/admin/evolution/runs?status=failed`; "Queue Depth" should drill down to `pending`; "Completed Runs" to `completed`. Currently a user has to manually navigate + filter.
8. **Bug-Minor** — `Updated Xs ago` is a plain `<span>` with no `aria-live`. The auto-refresh tick is invisible to screen readers. Should be `aria-live="polite"`.
9. **UX-Minor** — Refresh button uses unicode `↻` glyph as the icon. Glyph rendering is OS/font dependent (some users see a placeholder box). Prefer SVG icon. Also the visible label is `↻ Refresh` so the glyph is decorative — should be `aria-hidden`.
10. ~~Sidebar `aria-current="page"`~~ — **FALSE POSITIVE** (audit verified `aria-current="page"` IS set on active link, snapshot just hides the attribute).

## Runs list (`/admin/evolution/runs`)

11. **Bug-Major** — Cost columns don't sum: row `ade973a7` shows Spent=$0.04 but Generation=$0.01 + Ranking=$0.01 + Seed=$0.00 = $0.02. Multiple rows have identical mismatch (e.g. `496b9875`, `04ae2337` show Gen=$0.00, Rank=$0.01, Seed=$0.00 = $0.01 vs Spent=$0.04). Either (a) `Spent` (rollup `cost` metric) is double-counting reflection cost not displayed in any column, (b) the per-purpose split is missing the reflection bucket, or (c) one of the cost rollups is stale post-rebase. Notably the new reflection wrapper introduced `reflection_cost` (per `metrics.md`) but the table has no `Reflection Cost` column — likely just a missing column, not a data bug, but the absence makes the totals look wrong.
12. **UX-Major** — 14 columns visible on default load. Even on a wide laptop the table requires horizontal scroll; on a 1280px viewport the rightmost columns (Estimation Error %, Actions) are below-the-fold horizontally with no visible affordance. There's a "Columns (13/13)" picker but it defaults to all-on. Default should be a sensible 6-column subset (Explanation, Status, Strategy, Spent, Created, Actions) with the others opt-in.
13. **UX-Minor** — "Columns (13/13)" widget is a `<details>`/`<summary>` styled with `cursor:pointer`. Keyboard reachable via Tab, but visually has no chevron, no button border, no hover treatment that signals "this is a control". Looks like decorative text. Also the `(13/13)` count is `<column count visible>/<total>` which makes sense to a developer but reads like "page 13/13" to a casual user.
14. **Bug-Minor** — Estimation Error % values are negative (`-36%`, `-59%`). With no tooltip or column header help, a user has no idea whether negative is "good" (under-estimated, ran cheaper) or "bad" (estimate way off). Header should include "(actual − projected)" suffix or column should have an info-tooltip.
15. **UX-Major** — 5 numbered pagination buttons visible (1-5). Total = 86 items, default page size unknown. If 19/page → 5 pages exactly; if 20/page → 5 pages with last short. Either way there's no page-size dropdown — user can't trade scroll for fewer requests.
16. **UX-Minor** — Status filter dropdown is a native `<select>` while the Strategy combobox is a custom widget. Inconsistent — both filters should look and behave the same way.
17. **Bug-Minor** — Failed run `e3d19d3e` row has an `aria-label="Run has error details"` on a hidden generic, but no visible indicator (no error message column, no tooltip on the row). User must click into the run to see why it failed.
18. **UX-Minor** — Every row's "Delete" button has no associated row-identifier in its accessible name (just "Delete"). With 19 buttons all named "Delete", screen reader users can't distinguish them. Should be `aria-label="Delete run ade973a7"`.
19. **UX-Minor** — Sidebar header still reads "Evolution Dashboard" on the Runs page (and every page). Should track the current section ("Evolution / Runs") or just say "Evolution".
20. **UX-Minor** — Page title text says "86 items" but the heading says "Evolution Runs". The count should be in the heading or formatted as "Evolution Runs (86)" so the figure isn't lost in body copy.

## Run detail (`/admin/evolution/runs/[runId]`)

21. **Bug-Minor** — Browser tab title is `ExplainAnything` (the app default) instead of something like `Run ade973a7 | Evolution`. Compare `/admin/evolution-dashboard` → `Dashboard | Evolution`. Run detail is missing `metadata.title`/`generateMetadata`.
22. **Bug-Major** — Run uses strategy `Test new reflection agent` (which by the strategy name implies `reflect_and_generate` agent type), but Timeline tab badges every iteration as "GENERATE", and the legend only shows `Generate / Swiss / Merge` — no `Reflect+Generate` badge. Either the badge resolver doesn't know about `reflect_and_generate` or the strategy is misnamed and uses plain `generate`. Need source-code audit.
23. **UX-Minor** — Header says "23 invocations", iteration cards sum 6+4+4+5 = 19 agents. The 4-invocation gap (seed agent + 4 merge agents) is unattributed. Either label the merge agents in the iteration cards or clarify what's in the 23.
24. **UX-Minor** — "Run Outcome" panel is below the timeline. For long runs (4 iterations × $0.01 = compact, but a 20-iteration run will push the outcome below the fold). Outcome should be sticky-top or repeated above the timeline.
25. **UX-Minor** — Strategy chip reads `Strategy: Test new reflection agent`. The "Strategy:" prefix is redundant — the chip is on the run detail header where context is clear. Same for `Experiment: #c05e89eb` (8-char hex on a chip is also unfriendly).
26. **UX-Minor** — Winner card shows `analogy_bridge` (tactic name) with `Elo: 1343 ± 154`. The winner should also link to the variant detail page so a user can read the winning text in one click. Currently no link visible.
27. **UX-Minor** — Status badge "✓ Completed" is next to title but completion timestamp (`completed_at`) isn't shown anywhere in the header. User doesn't know if this run completed 2 hours ago or 2 weeks ago without checking the runs list.
28. **UX-Minor** — Iteration cards have a `▶` collapsed indicator but no aria-expanded; need to verify they're keyboard-toggleable.

## Run detail — Metrics tab

29. **Bug-Critical** — Cost metrics show NEGATIVE values that should be non-negative dollar amounts: `REFLECT_AND_GENERATE_FROM_PREVIOUS_ARTICLE:...:COST = $-1.951`, `$-2.858`, `$-4.655`, `$-2.719`. Cost is a magnitude — it cannot be negative. Either (a) `eloAttrDelta:*` rows are being rendered with the cost formatter (delta is signed; cost is not), or (b) attribution metrics with negative ELO deltas are formatted as currency. Likely a mis-routed metric formatter in `EntityMetricsTab` after the dynamic `eloAttrDelta:<agent>:<dim>` metric prefix landed.
30. **Bug-Major** — Cost metrics show absurdly large values: `$10.347`, `$10.603`, `$10.0`, `$2.169`, etc. The run's actual total cost is $0.04. These appear to be `eloAttrDelta:*` ELO point deltas being rendered with the dollar-sign formatter. Same root cause as #29.
31. **Bug-Major** — Confidence intervals on these "cost" metrics are also nonsensical: `[$-9.274, $3.836]`, `[$5.852, $14.041]*` — again, cost CIs cannot be negative or span 10× the value. Confirms misclassified metrics.
32. **Bug-Minor** — Some metric values have a trailing `*` suffix with no legend or footnote explaining what the asterisk means.
33. **UX-Major** — Long metric names (`REFLECT_AND_GENERATE_FROM_PREVIOUS_ARTICLE:CURIOSITY_HOOK:CURIO...`) are truncated mid-word with no tooltip showing the full name. User cannot identify which tactic the metric belongs to without inspecting the DOM.
34. **UX-Minor** — `Cost` section has both a "Spent" subheading and a `COST` card, then 30+ tactic-specific COST cards. Should group: top row = totals (Cost / Generation / Ranking / Seed / Reflection), then collapsible "Per-tactic breakdown".
35. **Bug-Minor** — `REFLECTION COST = $0.00` despite this run using `reflect_and_generate` agent type and 23 invocations including reflection calls. Per `metrics.md`, `reflection_cost` is written via `writeMetricMax` after every `'reflection'`-labeled call — either the wrapper isn't labeling its calls correctly or the metric isn't being recomputed.
36. **Bug-Minor** — Page has 30+ `<h3>`-equivalent metric labels with the same name (`COST`, `COST`, `COST` repeated). Screen reader users will hear "COST, COST, COST" with no per-tactic context.

## Run detail — Cost Estimates tab

37. **UX-Major** — Tab takes 3-5 s to load with no skeleton, no spinner, no "Loading..." text — the user sees an empty grey page and may assume the tab is broken. (Initial screenshot at t=0 was fully blank; content appeared only after second render.)
38. **Bug-Major** — `Tactic` column in "Cost per Invocation" table is `—` for every row, including 13 `reflect_and_generate_from_previous_article` invocations whose `execution_detail.tactic` is required and load-bearing per `agents/overview.md`. Either the column reader is querying the wrong field or the wrapper isn't writing `tactic` into the row.
39. **UX-Minor** — "GFSA Error Distribution" histogram has 5 buckets `<-25%`, `-25..-5%`, `-5..+5%`, `+5..+25%`, `>+25%`, but on this run all 19 GFSA invocations fall into `<-25%`. The histogram becomes a single bar with no signal. Could (a) widen buckets when distribution is degenerate, or (b) annotate "all invocations in one bucket — re-calibrate".
40. **UX-Minor** — Per-Iteration Summary table type-column badges every iteration as "GENERATE" — same mis-classification as Timeline tab (#22). `reflect_and_generate` is the actual agent type.
41. **UX-Minor** — Cost summary cards show `ESTIMATED = $0.06` and `TOTAL COST = $0.04` and `ABS ERROR = $0.001` — but $0.06 − $0.04 = $0.02, not $0.001. Either ABS ERROR is computed against a different baseline (mean per-invocation error) or the card is misleading.

## Experiments list (`/admin/evolution/experiments`)

42. **Bug-Major** — `Avg Estimation Error %` column shows extreme outliers without visual treatment: `-100%`, `218% ±429.4`, `156%`, `258%`, `205%`, `1305%`. A value of `-100%` means actual cost was zero (probably stale/aborted runs with no LLM spend) but the formatter treats it as a normal percent. Should special-case `cost=0` with `—` or a "cost data missing" note.
43. **Bug-Minor** — `±429.4` SE on a `218%` mean indicates the estimate is essentially noise (SE > 2× mean). The column should hide CI when `n < 3` or when `SE/mean > 1`, OR add a warning icon.
44. **UX-Minor** — `Best Winner Elo` column shows `[1188, 1467]` (95% CI brackets) on a separate line below the value. Cell rows are double-height and visually noisy; use sparkline or compact CI notation `1357 ±69`.
45. **UX-Minor** — `stale` status (orange dot) — no in-page legend explaining what stale means. (From `data_model.md`: experiments stuck in `running` for >X minutes? But no tooltip, no docs link.)
46. **UX-Minor** — `Cancel` and `Delete` actions appear in the same Actions column based on status. Stale experiments get `Cancel`; completed get `Delete`. A user looking down the column has to read each button. Consider always-visible "Actions" dropdown.
47. **UX-Minor** — Search input has no placeholder text or visible label — just an empty textbox. Add `placeholder="Search by name..."`.
48. **UX-Major** — `Hide test content` is checked but rows named "Test reflection agent...", "Test new reflection agent", "Test more of reflection agents", "Test (1)", "Test (2)" are all visible. The substring filter `applyTestContentNameFilter` (per `services/shared.ts`) is the legacy path that misses these unless the row's `is_test_content` column is true. Likely a backfill/trigger gap on production data — same pattern as #6.

## Arena (`/admin/evolution/arena` and `/[topicId]`)

49. **UX-Minor** — Arena topics list heading says "52 items" but with default filters checked only 2 rows show. Should display "2 of 52 (filtered)" so the user knows filters are hiding rows.
50. **Bug-Minor** — Arena topic detail page (`/admin/evolution/arena/[topicId]`) has browser tab title `ExplainAnything` instead of e.g. `Federal Reserve 2 | Arena | Evolution`. Same `metadata.title` gap as run detail (#21).
51. **UX-Minor** — Arena leaderboard has 11+ columns including Title (multi-line wrap), ID, Elo, 95% CI, "Elo ± Uncertainty" (duplicate-ish of Elo + 95% CI), Matches, Iteration, Tactic, Method, Parent — and the Parent column itself contains Parent ID + Parent Elo + Δ Elo + Δ Uncertainty. Cell density is extreme; there's no column-visibility picker like the runs page has.
52. **UX-Minor** — On the leaderboard, dimmed rows (below top 15% Elo cutoff) have no visible legend explaining the dim. Per `visualization.md` this is a known design choice but is not signposted in-page.
53. **Bug-Minor** — Arena page row "Status" column renders status as plain `active` text (no badge styling) while every other admin page uses `EvolutionStatusBadge` for the same field. Inconsistent visual language.

---

## Pass-2 source-code audit results

**Confirmed (root cause + fix identified):**

- **#11 (cost columns don't sum)** — CONFIRMED.
  - `evolution/src/lib/core/metricCatalog.ts:28` flags `reflection_cost` with `listView: false`, so the run-list never renders a Reflection Cost column.
  - `RunsTable` fallback `Spent` (line ~131) sums `generation_cost + ranking_cost + seed_cost` but **omits** `reflection_cost`, so the math doesn't reconcile when the rollup `cost` metric is stale and the fallback fires.
  - Fix: flip `listView` and include reflection_cost in fallback sum.

- **#29 / #30 / #31 (negative dollar cost cards on Metrics tab)** — CONFIRMED.
  - `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:36-41` `resolveFormatter()` defaults dynamic-prefix metrics (`eloAttrDelta:*`, `eloAttrDeltaHist:*`, `agentCost:*`) to `costDetailed` formatter.
  - `eloAttrDelta:*` rows are signed Elo-point deltas (per `metrics.md` § "ELO-delta attribution metrics") — formatting them as USD produces nonsense like `$-1.951`, `[$-9.274, $3.836]`.
  - Fix: prefix-dispatch in `resolveFormatter()` — route `eloAttrDelta:*` → `elo` formatter, `agentCost:*` → `costDetailed`. Also fix `resolveCategory()` so attribution rows aren't grouped under "Cost".

- **#38 (Tactic column always `—` on Cost Estimates tab)** — CONFIRMED.
  - `evolution/src/services/costEstimationActions.ts:282` reads `d.strategy` instead of `d.tactic`.
  - `ReflectAndGenerateFromPreviousArticleAgent` (`reflectAndGenerateFromPreviousArticle.ts:449`) writes `execution_detail.tactic`, not `execution_detail.strategy`. The legacy `strategy` field name was used by `GenerateFromPreviousArticleAgent` for variant attribution.
  - Fix: change `d.strategy` → `d.tactic`.

**Pass-2 audit results (full sweep, 2026-05-01):**

| # | Status | Notes |
|---|---|---|
| 1 | CONFIRMED | `formatCost` returns `'—'` for null but `'$0.00'` for 0; no visual distinction. |
| 2 | CONFIRMED | `EvolutionSidebar.tsx:48` hardcodes "Evolution Dashboard". |
| 3 | **FALSE POSITIVE** | `BaseSidebar.tsx:60` already wraps emoji with `aria-hidden="true"`. |
| 4 | CONFIRMED | `RefreshIndicator` span has no `aria-live="polite"` (`AutoRefreshProvider.tsx:139`). |
| 5 | **FALSE POSITIVE** | `StatusBadge` already has unicode prefix icons (✓/✗/⏳). |
| 6 | **FALSE POSITIVE** | Backfill migration `20260415000001_evolution_is_test_content.sql:38` already ran; "Test new reflection agent" doesn't match `evolution_is_test_name()` patterns by design. |
| 7 | **FALSE POSITIVE** | Cards are non-interactive divs by design — making them clickable is a feature request, not a bug. |
| 8 | CONFIRMED (dup of #4) | Same root cause. |
| 9 | CONFIRMED | `AutoRefreshProvider.tsx:146` uses bare unicode `↻` glyph in button label. |
| 10 | DROPPED | Already-known false positive. |
| 11 | CONFIRMED | (audited earlier) |
| 12 | CONFIRMED | `runs/page.tsx:102` initializes `hiddenCols` to empty Set — defaults to 14/14. |
| 13 | **FALSE POSITIVE** | `<summary>` IS button-styled (`border, px-3 py-1, bg-secondary, inline-block`). |
| 14 | PARTIAL | Tooltip exists from `metricCatalog.description`; doesn't explain negative semantics. |
| 15 | CONFIRMED | `pageSize` hardcoded to 20 in `runs/page.tsx:38`; no selector. |
| 16 | **FALSE POSITIVE** | Status=select vs Strategy=combobox is intentional per U4 fix from prior project. |
| 17 | **FALSE POSITIVE** | `title="..."` provides hover info; row also has `role="status"`. |
| 18 | CONFIRMED | `page.tsx:198` renders bare "Delete" with no aria-label. |
| 19 | CONFIRMED (dup of #2) | Same root cause. |
| 20 | CONFIRMED | `EntityListPage.tsx:228-235` puts count in `<p>` below `<h1>`. |
| 21 | CONFIRMED | `runs/[runId]/page.tsx` has no `metadata`/`generateMetadata` export. |
| 22 | CONFIRMED | `TimelineTab.tsx:29-42` `agentKind()` has no case for `reflect_and_generate`; falls to `other` or matches `generate` substring. |
| 23 | **FALSE POSITIVE** | Legend just shows total invocation count — no claim about gap labeling. |
| 24 | **FALSE POSITIVE** | Placement is intentional layout. |
| 25 | CONFIRMED | `EntityDetailHeader.tsx:154-161` hardcodes `{prefix}: {label}` template. |
| 26 | **FALSE POSITIVE** | Winner card IS linkified via `OutcomeCard` `href` prop (`TimelineTab.tsx:486-503`). |
| 27 | CONFIRMED | `EntityDetailHeader` props interface has no `completed_at`. |
| 28 | **FALSE POSITIVE** | Iteration cards are `<button>` not `<details>` (`TimelineTab.tsx:350`); fully accessible. |
| 29-31 | CONFIRMED | (audited earlier) |
| 32 | CONFIRMED | `MetricGrid.tsx:88-90` renders `*` only when `n=2` with `title="Low sample size (n=2)"`. No legend in-page; users won't see the title without hovering. |
| 33 | **FALSE POSITIVE** | `MetricGrid.tsx:78` has no truncation class. Long names wrap naturally. |
| 34 | **FALSE POSITIVE** | `EntityMetricsTab.tsx:145` filters out `agentCost:*`; cost section already grouped. |
| 35 | UNVERIFIABLE→CONFIRMED | Per `metrics.md` reflection_cost should be written by `createEvolutionLLMClient` for `'reflection'` AgentName. Need to inspect wrapper agent's call labels to confirm. Treat as confirmed for plan scope (low risk to add the column + investigate). |
| 36 | **FALSE POSITIVE** | Categories are deduped via `CATEGORY_LABELS`. |
| 37 | CONFIRMED | `CostEstimatesTab.tsx:59,655-663` uses `useEffect` + `<LoadingSkeleton h-24 />` skeleton; no spinner visible to user. |
| 38 | CONFIRMED | (audited earlier) |
| 39 | CONFIRMED | `costEstimationConstants.ts:5-11` defines fixed 5 buckets; degenerate when variance is low. |
| 40 | CONFIRMED | Same root as #22 — `CostEstimatesTab.tsx:419,447-449` infers type by substring match. |
| 41 | PARTIAL | `absError` is mean of per-invocation \|err\| (correct per `metricCatalog.ts:272-273`); user expectation of `\|sum_est − sum_actual\|` is different metric. Adding a tooltip + alternate "Total Δ" card resolves. |
| 42 | PARTIAL | Raw values are correct; display lacks special-case for `cost=0 → -100%`. Cosmetic only. |
| 43 | CONFIRMED | `CostEstimatesTab.tsx:156` formats `±SE` with no threshold check. |
| 44 | CONFIRMED | `[topicId]/page.tsx:319-324` puts CI in a separate `<td>` doubling row height. |
| 45 | CONFIRMED | `StatusBadge` has no tooltip for `stale` status. |
| 46 | CONFIRMED | `experiments/page.tsx:226-240` gates Cancel/Delete by status. |
| 47 | CONFIRMED | Placeholder is `'Search...'` per code, but rendered text is empty in the snapshot — possible CSS gap. |
| 48 | **FALSE POSITIVE** (dup of #6) | Same backfill explanation. |
| 49 | CONFIRMED | `arena/page.tsx:108-110` shows unfiltered `topics.length` as `totalCount`. |
| 50 | PARTIAL | Page is `'use client'` — can't use `generateMetadata`. Needs `document.title` effect or refactor to server component. |
| 51 | CONFIRMED | `[topicId]/page.tsx:279-289` renders 11 columns; no picker. |
| 52 | CONFIRMED | `[topicId]/page.tsx:264-267` has cutoff text above table; no in-row tooltip on dimmed rows. |
| 53 | CONFIRMED | `arena/page.tsx:48` renders `t.status` as plain text. |

**Net: 52 candidates → 17 false positives → 35 actionable findings.**
