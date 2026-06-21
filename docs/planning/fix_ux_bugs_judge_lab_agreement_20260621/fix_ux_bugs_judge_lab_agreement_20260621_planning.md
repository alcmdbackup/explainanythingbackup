# Fix UX Bugs Judge Lab Agreement Plan

## Background
Fix UX issues and bugs surfaced while using the Judge Lab Agreement sweep tool (rubric ↔ holistic agreement mode at `/admin/evolution/judge-lab/agreement`). Improve in-context explanations of sweep knobs (`repeats`, judging temperature default) and metric labels (`per-rep`, `both-dec`, `abstain`), make pre-flight cost preview use the existing cost-estimation infrastructure, and build a detail/drill-down view that surfaces individual matches with per-criterion agreement vs. the holistic verdict. Add a summary view that aggregates forward vs. reverse pass agreement and per-criterion disagreement rates against the holistic assessment.

## Requirements (from GH Issue #1248)
- Explain more clearly in UI/UX what "repeats" does
- Preview cost accurately using pre-existing infrastructure
- What is the best judging temperature? Do we have a default to advise?
- Build a detail view that allows you to view the results in much more detail - e.g. individual matches, which criteria agreed vs. didn't with overall
- Compute useful summary view that shows how often we had forward vs. reverse pass for holistic vs. criteria runs agreeing, how often individual criteria disagreed with wholistic assessment, etc
- Clearly explain what "per-rep", "both-dec" and "abstain" mean

## Problem
The Agreement sweep shipped a working backend but a sparse, mostly-unexplained UI. Three terse metric labels (`per-rep`, `both-dec`, `abstain`) and two undocumented knobs (`repeats`, `temperature`) leave researchers reading the source to interpret results. Pre-flight cost preview only fires on Dry-run click, so users can't tell whether changing inputs will fit under the `JUDGE_EVAL_MAX_USD` cap. The run-detail page surfaces aggregates and a 100-row capped disagreement drill-down, but doesn't let researchers (1) browse all matches with their full audit payload, (2) see per-criterion agreement for an individual call, or (3) see whether the rubric and holistic judges disagree because of position bias (forward ≠ reverse pass) rather than genuine quality difference. Per-criterion disagreement is computed but only visible after clicking into a run, making cross-run triage from the leaderboard impossible.

## Options Considered

The 6 main design decisions were resolved in the `/research` walkthrough (`_research.md` "Open Questions"). One open fork remains:

- [x] **Detail view location — DECIDED: new sub-route**
  - Chosen: new sub-route `runs/[agreementRunId]/matches/page.tsx` mirroring the regular-sweep pattern.
  - Rejected: expand-on-click inline within existing run-detail (keeps detail focused, consistent nav with regular sweep).

- [x] **Per-pass winner data — DECIDED: parse raws on read**
  - Chosen: reducer replays `parseWinner` / `parseRubricVerdict` over the persisted `*_raw` columns at read time.
  - Rejected: migration + backfill (no schema change in this PR; upgrade path stays open).

- [x] **Label-explanation mechanism — DECIDED: native `title` + inline `<details>`**
  - Chosen: `<th title="...">` on terse column headers, plus a single `<details><summary>What do these mean?</summary>` block at the top of the leaderboard + detail page. Faded `<p>` subtitles under the `repeats` and temperature inputs.
  - Rejected: shadcn Tooltip/Popover (avoids new dependency in judge-lab routes), and rewriting labels to be self-explanatory (would widen table columns).

- [x] **Leaderboard column additions — DECIDED: add `Worst criterion (disagree%)`**
  - Chosen: one column showing the criterion with the highest `disagreeRate` for each run, e.g. `engagement (62%)`.
  - Rejected: per-criterion sparkline (harder to scan), detail-only (loses triage value).

- [x] **Live cost preview UX — DECIDED: compact one-liner next to Launch**
  - Chosen: debounced (~300ms) one-liner above the Launch button: `120 pairs × 10 repeats × 4 calls = 4,800 calls · est $0.12 · within $5 cap`. Color-shifts red on cap overflow.
  - Rejected: dedicated card (more vertical space), both (over-scoped).

- [x] **CI whiskers on agreement rates — DECIDED: include everywhere (leaderboard + detail)**
  - Chosen: render `78% [72, 84]` on every agreement rate on both surfaces.
  - Sub-decision still open (folded into the phased plan as an option, not blocking):
    - [ ] **Option A — Wilson score interval (closed-form, no extra query)**: for proportions like `agree / n_calls`, compute 95% CI analytically using the n + p already available in the SQL view (`n_calls`, `strict_agree_rate`). Zero extra DB load. Slightly different math from `bootstrapMeanCI` but the right tool for proportions.
    - [ ] **Option B — Bootstrap CI client-side from per-call rows**: fetch per-call `holistic_winner` / `rubric_winner` booleans for each leaderboard row, run `bootstrapMeanCI` in TS. Reuses existing infra but adds N reads.
    - [ ] **Option C — Extend `judge_eval_agreement_leaderboard` SQL view with CI columns**: durable, queryable from SQL elsewhere, requires a migration.
  - Recommendation: Option A (Wilson) — proportions deserve proportion math, no extra queries, no migration. Bootstrap stays appropriate for the detail-page reducer because that already iterates calls in memory.

## Phased Execution Plan

### Phase 1: Reducer + server actions (foundational, no UI)
- [ ] Extend `evolution/src/lib/judgeEval/agreementMetrics.ts`:
  - Add `holisticPositionBiasRate` + `rubricPositionBiasRate` to `AgreementMetrics` (fraction of calls where forward-pass parsed winner ≠ reverse-pass parsed winner, per side).
  - Add a new pure helper `computePositionBias(calls)` that takes `AgreementCallMetricsInput` extended with `holistic_forward_raw / holistic_reverse_raw / rubric_forward_raw / rubric_reverse_raw` and runs `parseWinner` (holistic) / `parseRubricVerdict` (rubric, needs `dimNames`).
  - Wrap every existing rate in a CI computation (Wilson for proportions: `agreeCount / n`, `bothDecisiveAgree / bothDecisive.length`, etc.). Add `RateWithCI = { value: number | null; ciLow: number | null; ciHigh: number | null }` shape. **Output type bump** — `AgreementCriterionMetrics` and `AgreementMetrics` rates change from `number | null` to `RateWithCI`.
  - Pure helper `wilsonScoreCI(successes, n, z = 1.96)` in `evolution/src/lib/judgeEval/wilsonCI.ts` (or co-locate in `agreementMetrics.ts`). Returns `{ low, high }` clamped to `[0, 1]`.
- [ ] New server action `estimateAgreementCostAction` in `evolution/src/services/judgeEvalActions.ts`:
  - Input: `{ testSetName, kindFilter, repeats, judgeModel, reasoningEffort }`.
  - Steps: `loadTestSetByName` → fetch members → filter by `kindFilter` → call `estimateSweepCost({ models: [judgeModel], temperatures: [0], reasoningEfforts: [reasoningEffort], promptVariants: 1, pairs, repeats: 1, explainReasoning: reasoningEffort !== null })` THEN multiply for the 4-calls-per-repeat shape (2 holistic + 2 rubric) — verify `estimateSweepCost` already accounts for the "2 calls per pass" via its return formula; agreement is `× 2` over the regular sweep (rubric adds a second 2-pass set).
  - Output: `{ pairCount, plannedCalls, estimatedCostUsd, capStatus: 'ok' | 'over_calls' | 'over_usd', maxCalls, maxUsd }`. Reuses `assertWithinJudgeEvalCap` semantics WITHOUT throwing (returns the cap status instead).
- [ ] Extend `getAgreementLeaderboardAction`:
  - Compute Wilson CI on each rate from the SQL-view `n_calls` + each rate; return `{ ..., strict_agree_ci_low, strict_agree_ci_high, both_decisive_agree_ci_low, both_decisive_agree_ci_high, abstain_divergence_ci_low, abstain_divergence_ci_high }`.
  - Compute `worst_criterion_name` + `worst_criterion_disagree_rate` per row by aggregating `judge_eval_agreement_criterion_verdicts` for that run's calls (one extra batched query keyed by `agreement_run_id` joined through the calls table).
- [ ] New server action `getAgreementCallsAction({ runId, limit, offset, kindFilter? })` — paginated Core rows from `judge_eval_agreement_calls` excluding `*_raw` columns. Returns `{ calls, total }`.
- [ ] New server action `getAgreementCallDetailAction({ callId })` — single call's raws + criterion verdicts for that call (joined on `agreement_call_id`). Mirrors `getJudgeEvalCallDetailAction`.

### Phase 2: Launcher UX (`agreement/page.tsx`)
- [ ] Hook live cost preview:
  - New `useEffect` that calls `estimateAgreementCostAction` whenever `testSetName / kindFilter / repeats / judgeModel / reasoningEffort` changes (debounced 300ms via `setTimeout` in the effect cleanup).
  - Render a compact one-liner above the Launch button: `${pairCount} pairs × ${repeats} repeats × 4 calls = ${plannedCalls} calls · est $${costUsd.toFixed(4)}`. Color-shift red + append `· exceeds $${maxUsd} cap` when `capStatus === 'over_usd'` (same for over_calls).
  - Disable Launch button when `capStatus !== 'ok'`.
- [ ] Label clarity:
  - Add `title="..."` on the three terse `<th>` cells: `Per-rep` → "Per-repeat agreement: fraction of (pair × repeat) calls where rubric winner equals holistic winner. Strict — no decisive filter."; `Both-dec` → "Both-decisive agreement: subset of calls where both judges had confidence > 0.6, fraction that agreed."; `Abstain` → "Abstain divergence: fraction of calls where exactly one judge was decisive (the other abstained / returned TIE)."
  - Add a `<details><summary>What do these mean?</summary>` block immediately above the leaderboard table containing the verbatim definitions from `_research.md` Key Findings #2.
  - Add faded `<p>` subtitle under `repeats` input: "Each pair is judged N times. 4 LLM calls per repeat (2 holistic + 2 rubric). Doubling repeats doubles cost; halves per-pair noise."
  - Add faded `<p>` subtitle under temperature input: "0 (recommended — matches production judge path). Higher introduces judge noise on nano-class models. See `docs/analysis/judge_agreement_summary_tables.md`."
- [ ] Leaderboard new column `Worst criterion (disagree%)` — render `${worst_criterion_name} (${pct(rate)})` or `—` when null. Add `title="..."` explaining the metric.
- [ ] Render CI on existing rate columns: `{pct(rate)} [<small>{pct(ciLow)}, {pct(ciHigh)}</small>]` via a new `pctWithCI(value, low, high)` helper. Add data-testid attributes for E2E selectors.

### Phase 3: Detail page UX (`agreement/runs/[agreementRunId]/page.tsx`)
- [ ] Unify labels — pick one wording per metric and use the SAME wording on the launcher and detail:
  - `perRepeatAgreeRate` → "Per-repeat agreement" (launcher: `Per-rep` with `title`; detail tile: "Per-repeat agreement")
  - `perPairModalAgreeRate` → "Per-pair (modal) agreement"
  - `bothDecisiveAgreeRate` → "Both-decisive agreement"
  - `abstainDivergenceRate` → "Single-judge abstain"
- [ ] Add 2 new tiles to the MetricGrid: "Holistic position bias" (`holisticPositionBiasRate`) and "Rubric position bias" (`rubricPositionBiasRate`), each with `title="Fraction of calls where forward-pass and reverse-pass picked different winners. High values indicate the judge's verdict depends on text ordering."` Total tiles → 6.
- [ ] Add the same `<details><summary>What do these mean?</summary>` block at the top of the page (above the tiles).
- [ ] Add `title="..."` on the per-criterion table column headers (Agree / Disagree / Abstain / GT-Acc), and on the inline note about `rubricAHolisticBRate` / `rubricBHolisticARate`.
- [ ] Render CI on every rate (tiles + per-criterion table). Reuse `pctWithCI` helper from Phase 2.
- [ ] Replace the current 100-row capped Disagreement drill-down with a link to the new `/matches` sub-route filtered to `?disagree=1` (keeps the count headline + first 10 rows on the detail page, full browse via the new page).
- [ ] Add a "View all matches →" link at the top of the page pointing to the new sub-route.

### Phase 4: New `/matches` sub-route
- [ ] Create `src/app/admin/evolution/judge-lab/agreement/runs/[agreementRunId]/matches/page.tsx`:
  - Direct port of `src/app/admin/evolution/judge-lab/runs/[evalRunId]/matches/page.tsx`.
  - Replace `getJudgeEvalCallsAction` → `getAgreementCallsAction`; `getJudgeEvalCallDetailAction` → `getAgreementCallDetailAction`.
  - Column set: `Pair · Kind · Rep · Holistic (winner/conf) · Rubric (winner/conf) · Agree? · GT · Actions`.
  - Optional `?disagree=1` query param filter — when set, show only calls with `holistic_decisive && rubric_decisive && holistic_winner !== rubric_winner`.
- [ ] `AgreementAuditDetail` component (sibling to `AuditDetail` from the regular sweep):
  - Two-column layout: Holistic forward/reverse + Rubric forward/reverse `TextBlock` panels (4 collapsible blocks).
  - Per-criterion verdict table for this call: criterion name · weight · forward verdict · reverse verdict · dimension winner · agrees_with_holistic · matches_ground_truth.
  - Split Content A / Content B from one of the holistic prompts using the existing `extractTexts` regex helper.
  - "Open in Match Viewer" link via `findArenaComparisonForVariantsAction` (identical to existing pattern).
- [ ] Update `EvolutionBreadcrumb` chain: `Evolution > Judge Lab > Agreement > Run abc12345 > Matches`.

### Phase 5: Tests + docs
- [ ] Update `docs/feature_deep_dives/judge_evaluation.md` Agreement Sweep section:
  - Document new label wording (single canonical name per metric).
  - Document the new `/matches` sub-route under "Admin UI".
  - Document the new `worst_criterion_name` field on the leaderboard.
  - Document the live cost-preview behavior and the in-UI temperature default advice.
- [ ] Run all checks per `/finalize` flow (lint/tsc/build/unit/integration/e2e:critical).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/agreementMetrics.test.ts` — extend existing test file:
  - Position-bias derivation: stubbed `*_raw` strings → expected per-pass winners → expected `holisticPositionBiasRate`/`rubricPositionBiasRate`.
  - Wilson CI computation: known proportions → known intervals (compare against canonical Wilson formulas; degenerate cases p=0, p=1, n=0).
  - Existing rate computations still produce the same values inside the new `RateWithCI` shape.
- [ ] `evolution/src/lib/judgeEval/wilsonCI.test.ts` (new) — pure helper tests for `wilsonScoreCI(successes, n, z)`.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-judge-eval-agreement.integration.test.ts` — extend existing file:
  - `estimateAgreementCostAction` happy path returns plausible `pairCount` × `repeats` × 4 = `plannedCalls`.
  - `estimateAgreementCostAction` returns `capStatus: 'over_usd'` when forced over the cap with an env override.
  - `getAgreementLeaderboardAction` returns the new `worst_criterion_name` / `worst_criterion_disagree_rate` / CI columns over a seeded run.
  - `getAgreementCallsAction` paginated reads return expected rows + `total`.
  - `getAgreementCallDetailAction` returns the raws + criterion verdicts for one call.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts` (new spec, `{ tag: '@evolution' }`):
  - Launcher cost-preview updates as `repeats` changes (assert text contains the new pair × repeats × 4 formula).
  - Launch button disables when an artificially-low cap is hit (override via E2E env var or fixture data).
  - Tooltip-bearing column headers expose `title` attributes; the `<details>` block expands and collapses.
  - Detail page renders 6 tiles (including 2 new position-bias tiles); each tile shows `xx% [yy, zz]` CI format.
  - "View all matches →" link navigates to the new `/matches` sub-route.
  - Matches page: pagination works; row expand fetches audit payload; "Open in Match Viewer" opens a new tab.

### Manual Verification
- [ ] On staging, launch an Agreement sweep against a real test set with `temperature=0`, `repeats=5`, and verify the live cost preview matches the post-launch billed cost within the 1.3× reserve margin.
- [ ] Open a historical agreement run pre-dating this PR — verify position-bias tiles render correctly (raws were already persisted) and CI whiskers render with sane bounds.
- [ ] Cross-check label wording: launch the launcher and the detail page side-by-side, confirm each metric has exactly one canonical label.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts` against the local server (via `ensure-server.sh`) and verify all assertions pass on Chromium.
- [ ] Manually launch the local server, navigate to `/admin/evolution/judge-lab/agreement`, and walk through: change inputs → see live cost preview → expand "What do these mean?" → click a leaderboard row → see CI on tiles → click "View all matches →" → expand a row → see audit detail → click "Open in Match Viewer".

### B) Automated Tests
- [ ] `npm test -- evolution/src/lib/judgeEval/agreementMetrics.test.ts evolution/src/lib/judgeEval/wilsonCI.test.ts`
- [ ] `npm run test:integration -- src/__tests__/integration/evolution-judge-eval-agreement.integration.test.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts`
- [ ] Full local check trio at `/finalize`: `npm run lint && npm run typecheck && npm run build && npm test && npm run test:integration && npm run test:e2e:critical`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — **REQUIRED**: document new `/matches` sub-route, new leaderboard columns (`worst_criterion_*`), CI whisker rendering, position-bias tiles, label-unification wording, live cost preview, in-UI temperature/repeats advice.
- [ ] `evolution/docs/implicit_rubric_weights.md` — **OPTIONAL**: if we want the closest analog tool to use the same label wording / cost-preview pattern, document the convergence in a "see also" note.
- [ ] `evolution/docs/rating_and_comparison.md` — **OPTIONAL**: if the position-bias tile reuses `parseWinner` / `parseRubricVerdict` in a new way, add a one-liner cross-reference; otherwise no change.
- [ ] `evolution/docs/visualization.md` — **REQUIRED**: add the new `/matches` sub-route to the route table; update the agreement run-detail row to reflect new tiles + tooltips + label wording.
- [ ] `evolution/docs/cost_optimization.md` — **OPTIONAL**: if we want to document `estimateAgreementCostAction` as the preferred live-preview surface, add a one-liner under the Judge-Eval cost section.
- [ ] `evolution/docs/criteria_agents.md` — likely no change (rubric/criteria semantics unchanged).
- [ ] `evolution/docs/data_model.md` — likely no change (no migration).
- [ ] `evolution/docs/metrics.md` — likely no change (no new metric registry entries).
- [ ] `evolution/docs/strategies_and_experiments.md` — likely no change.
- [ ] `evolution/docs/architecture.md` — likely no change.
- [ ] `evolution/docs/arena.md` — likely no change.
- [ ] `evolution/docs/entities.md` — likely no change.
- [ ] `evolution/docs/reference.md` — likely no change (no new env vars / scripts).
- [ ] `evolution/docs/README.md` — likely no change.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
