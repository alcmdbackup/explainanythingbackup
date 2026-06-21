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

The 6 main design decisions were resolved in the `/research` walkthrough (`_research.md` "Open Questions").

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
  - Chosen: debounced (~300ms) one-liner above the Launch button. Color-shifts red on cap overflow.
  - Rejected: dedicated card (more vertical space), both (over-scoped).

- [x] **CI whiskers on agreement rates — DECIDED: include everywhere (leaderboard + detail)**
  - Chosen: render `78% [72, 84]` on every agreement rate on both surfaces.

- [x] **CI math strategy — DECIDED: Wilson + per-rate denominator queries**
  - Chosen: Wilson score interval for all proportions (the right tool for proportions, no extra DB load when the denominator is known). Each rate gets CI from its OWN denominator, NOT from `n_calls`:
    - `strict_agree_rate` → denom = total error-free calls (= `n_calls` from view).
    - `both_decisive_agree_rate` → denom = both-decisive calls (NOT `n_calls`).
    - `abstain_divergence_rate` → denom = total error-free calls (= `n_calls`) — but the OTHER buckets within it have their own n.
  - The SQL view `judge_eval_agreement_leaderboard` exposes ONLY `n_calls`, so `getAgreementLeaderboardAction` issues ONE supplemental aggregation query per page-of-rows against `judge_eval_agreement_calls` to fetch `both_decisive_n` and `exactly_one_decisive_n` keyed by `(agreement_run_id, pair_kind)`. Wilson math is then applied per rate with its correct denominator. No view migration.
  - Rejected: pulling `bootstrapMeanCI` from `evolution/src/lib/metrics/computations/propagation.ts` (it's for means of variance-bearing samples, not proportions).
  - Rejected: extending the SQL view (contradicts the no-migration constraint).

- [x] **Reducer type-shape — DECIDED: additive parallel CI fields (non-breaking)**
  - Chosen: add `<rateName>Ci: { low: number | null; high: number | null } | null` PARALLEL to each existing rate field (e.g. `perRepeatAgreeRate: number` and `perRepeatAgreeRateCi: { low, high } | null`). Existing rate fields keep their `number | null` type. Per-criterion table grows `agreeRateCi`, `disagreeRateCi`, `abstainRateCi`, `groundTruthAccuracyCi`. No call-site cascade; existing test assertions stay valid; new tests add CI fields.
  - Rejected: breaking `RateWithCI` shape change (would cascade into ~10 consumer sites in `runs/[agreementRunId]/page.tsx` L126-129, L177-178, L217, the per-criterion table, plus ~10 existing assertions in `agreementMetrics.test.ts` L42-166).

- [x] **wilsonCI.ts location — DECIDED: `evolution/src/lib/shared/wilsonCI.ts`**
  - Chosen: shared/ alongside `rating.ts` (the existing general-purpose math module). Keeps the agreement reducer focused on agreement semantics.

- [x] **`estimateSweepCost` per-call multiplication — DECIDED: agreement is `× 2` over regular sweep**
  - Confirmed via `cost.ts:51-72`: `estimateSweepCost` returns the cost for ONE 2-pass comparison (forward + reverse) per pair × repeat × cell. Agreement does TWO 2-pass comparisons per repeat (holistic + rubric). `estimateAgreementCostAction` therefore multiplies the helper's output by 2. Plan-frozen; no runtime "verify" needed.

## Phased Execution Plan

### Phase 1: Reducer + server actions (foundational, no UI)

**Reducer extension** — `evolution/src/lib/judgeEval/agreementMetrics.ts`:
- [ ] Add ADDITIVE parallel CI fields to `AgreementMetrics`:
  - `perRepeatAgreeRateCi`, `perPairModalAgreeRateCi`, `bothDecisiveAgreeRateCi`, `bothDecisiveOppositeRateCi`, `abstainDivergenceRateCi`, `holisticAccuracyCi`, `rubricAccuracyCi` — each `{ low: number | null; high: number | null } | null`. Null when the rate itself is null (n=0 case).
- [ ] Add ADDITIVE parallel CI fields to `AgreementCriterionMetrics`: `agreeRateCi`, `disagreeRateCi`, `abstainRateCi`, `groundTruthAccuracyCi`.
- [ ] Add `holisticPositionBiasRate: number`, `rubricPositionBiasRate: number`, plus `holisticPositionBiasRateCi`, `rubricPositionBiasRateCi`.
- [ ] **Per-pass derivation invariant**: `computePositionBias(calls)` reads raws + parses each pass. **Null policy** (spec'd to avoid undefined behavior):
  - both passes parse to a winner → counted; mismatch ⇒ position-bias incremented.
  - one parses + one returns null → EXCLUDED from denominator (under-determined).
  - both null → EXCLUDED from denominator (no signal).
  - Denominator is "calls where both passes parsed to a non-null winner". Document this exactly in the function's JSDoc.
- [ ] **`computePairAgreement` extension**: take an EXTENDED `AgreementCallMetricsInput` that adds the four `*_raw` strings; the existing call sites (engine + run-detail page) populate raws from the same fields they already read. (The launcher leaderboard does NOT call the reducer; only the run-detail page does — see Phase 3.)

**New helper** — `evolution/src/lib/shared/wilsonCI.ts`:
- [ ] Export `wilsonScoreCI(successes: number, n: number, z: number = 1.96): { low: number; high: number } | null`. Edge cases:
  - `n === 0` → return `null` (caller renders as `—`).
  - `successes === 0` or `successes === n` → still well-defined under Wilson (unlike normal-approx); return finite bounds clamped to `[0, 1]`.
  - Negative inputs → throw `Error('wilsonScoreCI: negative input')`.
- [ ] Pure module, no side effects.

**New server action** — `estimateAgreementCostAction` in `evolution/src/services/judgeEvalActions.ts`:
- [ ] **Top-of-file comment ABOVE the action**:
  ```ts
  // estimateAgreementCostAction is a ZERO-LLM-CALL action. It must perform only:
  //   1. loadTestSetByName (DB read)
  //   2. test-set member filter by kindFilter (in-memory)
  //   3. estimateSweepCost (pure math)
  //   4. Wilson cap-status check (pure math)
  // It MUST NOT invoke createCallLLMJudge, runJudgeEval, or any LLM dispatcher.
  // The live-preview loop calls this on every input change — a single inadvertent LLM
  // call here would burn the global evolution cap on each keystroke.
  ```
- [ ] Input: `{ testSetName, kindFilter, repeats, judgeModel, reasoningEffort }`.
- [ ] Steps: `loadTestSetByName` → fetch members → filter by `kindFilter` → call `estimateSweepCost({ models: [judgeModel], temperatures: [0], reasoningEfforts: [reasoningEffort], promptVariants: 1, pairs, repeats, explainReasoning: reasoningEffort !== null })` THEN `estimatedCostUsd *= 2` (agreement runs 2 holistic + 2 rubric passes = 2× the regular sweep's 2-pass cost) and `plannedCalls = pairs × repeats × 4`.
- [ ] Output: `{ pairCount, plannedCalls, estimatedCostUsd, capStatus: 'ok' | 'over_calls' | 'over_usd', maxCalls, maxUsd }`. NON-throwing wrapper around the cap check (return the status; don't throw — the live preview is non-blocking UX).
- [ ] **Auth**: must be wrapped in `adminAction` (auth-gated, service-role DB client) — same pattern as `getAgreementLeaderboardAction`.

**Leaderboard extension** — `getAgreementLeaderboardAction`:
- [ ] After reading the SQL view rows, for each leaderboard row issue ONE supplemental aggregation query against `judge_eval_agreement_calls`:
  ```sql
  -- conceptual; actual code uses Supabase JS client + .in() batched per page
  SELECT agreement_run_id, pair_kind,
         COUNT(*) FILTER (WHERE holistic_confidence > 0.6 AND rubric_confidence > 0.6) AS both_decisive_n,
         COUNT(*) FILTER (WHERE (holistic_confidence > 0.6) <> (rubric_confidence > 0.6)) AS exactly_one_decisive_n,
         COUNT(*) FILTER (WHERE holistic_confidence > 0.6 AND rubric_confidence > 0.6 AND holistic_winner = rubric_winner) AS both_decisive_agree_n,
         COUNT(*) FILTER (WHERE holistic_confidence > 0.6 AND rubric_confidence > 0.6 AND holistic_winner <> rubric_winner) AS both_decisive_oppose_n,
         COUNT(*) FILTER (WHERE holistic_winner = rubric_winner) AS strict_agree_n
  FROM judge_eval_agreement_calls
  WHERE agreement_run_id IN (...) AND error IS NULL
  GROUP BY agreement_run_id, pair_kind;
  ```
  Use Supabase JS aggregation: batched `IN` over the visible run ids (leaderboard pagination already bounds this — typically ≤ 50 rows).
- [ ] Apply Wilson CI per rate with its CORRECT denominator (`strict_agree_rate` ← `strict_agree_n` / `n_calls`; `both_decisive_agree_rate` ← `both_decisive_agree_n` / `both_decisive_n`; `abstain_divergence_rate` ← `exactly_one_decisive_n` / `n_calls`). Return all 6 CI bounds on each row.
- [ ] Worst-criterion column: parallel batched query against `judge_eval_agreement_criterion_verdicts JOIN judge_eval_agreement_calls`, group by `(agreement_run_id, pair_kind, criteria_name)`, compute disagree rate per criterion, pick max per `(run, pair_kind)`. **Index hint**: relies on existing index on `judge_eval_agreement_criterion_verdicts.agreement_call_id`; verify the index is present pre-implementation (it was created in migration `20260619000001`; if missing add to a follow-up migration, not this PR).
- [ ] Return: `{ ..., worst_criterion_name, worst_criterion_disagree_rate, worst_criterion_disagree_rate_ci }`. Null when n=0 for that criterion's denominator.

**New paginated-matches server actions**:
- [ ] `getAgreementCallsAction({ runId, limit, offset, kindFilter?, disagreeOnly? })` — paginated Core rows from `judge_eval_agreement_calls` excluding `*_raw` columns. When `disagreeOnly: true`, filter to `holistic_confidence > 0.6 AND rubric_confidence > 0.6 AND holistic_winner <> rubric_winner`. Returns `{ calls, total }`. Default limit 25.
- [ ] `getAgreementCallDetailAction({ callId })` — single call's raws + criterion verdicts joined on `agreement_call_id`. Mirrors `getJudgeEvalCallDetailAction`.

### Phase 2: Launcher UX (`agreement/page.tsx`)

**Live cost preview** — correct debounce / cancellation:
- [ ] New `useEffect` with the following SHAPE (explicit so reviewers can verify):
  ```ts
  useEffect(() => {
    // Min-input-length guard: skip estimate when key inputs missing.
    if (!testSetName || !judgeModel || repeats < 1) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const res = await estimateAgreementCostAction({
        testSetName, kindFilter: kind, repeats, judgeModel, reasoningEffort: reasoning === 'none' ? null : reasoning,
      });
      if (cancelled || controller.signal.aborted) return;       // stale-response guard
      if (!res.success) {
        setEstimate({ error: true });                            // graceful fallback
        return;
      }
      setEstimate(res.data);
    }, 300);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [testSetName, judgeModel, kind, repeats, reasoning]);
  ```
  - Timer LIVES in the effect body, CLEARED in cleanup (NOT vice versa).
  - `cancelled` flag PLUS AbortController guards against stale responses if a slow request races a new input.
  - Min-input-length guard short-circuits empty/invalid state.
  - **Error fallback**: render `Cost preview unavailable` inline (faded), do NOT disable Launch (preserves user agency when a transient action failure occurs).
- [ ] Render the compact one-liner with `data-testid="agreement-cost-preview"` (required for E2E selector): `${pairCount} pairs × ${repeats} repeats × 4 calls = ${plannedCalls} calls · est $${costUsd.toFixed(4)}`. Color-shift red + append `· exceeds $${maxUsd} cap` when `capStatus === 'over_usd'` (same for over_calls).
- [ ] Disable Launch button when `capStatus !== 'ok'` (NOT when estimate failed — see fallback above).

**Label clarity**:
- [ ] Add `title="..."` on the three terse `<th>` cells: `Per-rep` → "Per-repeat agreement: fraction of (pair × repeat) calls where rubric winner equals holistic winner. Strict — no decisive filter."; `Both-dec` → "Both-decisive agreement: subset of calls where both judges had confidence > 0.6, fraction that agreed."; `Abstain` → "Abstain divergence: fraction of calls where exactly one judge was decisive (the other abstained / returned TIE)."
- [ ] Add a `<details data-testid="agreement-definitions"><summary>What do these mean?</summary>` block immediately above the leaderboard table with the verbatim definitions from `_research.md` Key Findings.
- [ ] Add faded `<p>` subtitle under `repeats` input: "Each pair is judged N times. 4 LLM calls per repeat (2 holistic + 2 rubric). Doubling repeats doubles cost; halves per-pair noise."
- [ ] Add faded `<p>` subtitle under temperature input: "0 (recommended — matches production judge path). Higher introduces judge noise on nano-class models. See `docs/analysis/judge_agreement_summary_tables.md`."

**Leaderboard new column**:
- [ ] Add `<th title="The criterion whose verdict most often diverged from the holistic judge in this run.">Worst criterion (disagree%)</th>` and render `${worst_criterion_name} (${pct(rate)})` with `data-testid="agreement-leaderboard-worst-criterion"`. `—` when null.
- [ ] Render CI on existing rate columns via a new `pctWithCI(value, ci)` helper: `78% [72, 84]`. Add `data-testid` per cell (`agreement-leaderboard-per-rep`, etc.).

### Phase 3: Detail page UX (`agreement/runs/[agreementRunId]/page.tsx`)

- [ ] **Label unification** — pick one wording per metric and use the SAME wording on the launcher and detail:
  - `perRepeatAgreeRate` → "Per-repeat agreement" (launcher: `Per-rep` with `title`; detail tile: "Per-repeat agreement")
  - `perPairModalAgreeRate` → "Per-pair (modal) agreement"
  - `bothDecisiveAgreeRate` → "Both-decisive agreement"
  - `abstainDivergenceRate` → "Single-judge abstain"
  - **Note**: SQL view column names (`strict_agree_rate`, `both_decisive_agree_rate`, `abstain_divergence_rate`) intentionally diverge from UI labels (no migration). Mapping lives in `getAgreementLeaderboardAction`. Add a 1-line comment at the action's mapping site.
- [ ] Add 2 new tiles to the MetricGrid: "Holistic position bias" (`holisticPositionBiasRate`) and "Rubric position bias" (`rubricPositionBiasRate`), each with `title="Fraction of calls where forward-pass and reverse-pass picked different winners. High values indicate the judge's verdict depends on text ordering."` and `data-testid="agreement-position-bias-{holistic|rubric}"`. Total tiles → 6.
- [ ] Add the same `<details data-testid="agreement-definitions"><summary>What do these mean?</summary>` block at the top of the page (above the tiles).
- [ ] Add `title="..."` on the per-criterion table column headers (Agree / Disagree / Abstain / GT-Acc), and on the inline note about `rubricAHolisticBRate` / `rubricBHolisticARate`.
- [ ] Render CI on every rate (tiles + per-criterion table). Reuse `pctWithCI` helper from Phase 2.
- [ ] Replace the current 100-row capped Disagreement drill-down with a link to the new `/matches` sub-route filtered to `?disagree=1` (keeps the count headline on the detail page, full browse via the new page).
- [ ] Add a "View all matches →" link at the top of the page pointing to the new sub-route, `data-testid="agreement-view-all-matches"`.

### Phase 4: New `/matches` sub-route

- [ ] Create `src/app/admin/evolution/judge-lab/agreement/runs/[agreementRunId]/matches/page.tsx`:
  - Direct port of `src/app/admin/evolution/judge-lab/runs/[evalRunId]/matches/page.tsx`.
  - Replace `getJudgeEvalCallsAction` → `getAgreementCallsAction`; `getJudgeEvalCallDetailAction` → `getAgreementCallDetailAction`.
  - Column set: `Pair · Kind · Rep · Holistic (winner/conf) · Rubric (winner/conf) · Agree? · GT · Actions` with `data-testid="agreement-matches-row"` per row.
  - `?disagree=1` query param filter (read via `useSearchParams`) — passed to `getAgreementCallsAction({ disagreeOnly: true })`. Add a checkbox toggle "Show only disagreements" wired to a router push that adds/removes the param.
- [ ] `AgreementAuditDetail` component (sibling to `AuditDetail` from the regular sweep):
  - **Render contract**: every raw / reasoning / prompt field is rendered as **plain text only** via the same `TextBlock` pattern (`<pre>` with auto-escaping). NO `dangerouslySetInnerHTML`, NO Markdown-to-HTML pipeline. Explicit in the file's top-of-file comment.
  - Two-column layout: Holistic forward/reverse + Rubric forward/reverse `TextBlock` panels (4 collapsible blocks).
  - Per-criterion verdict table for this call: criterion name · weight · forward verdict · reverse verdict · dimension winner · agrees_with_holistic · matches_ground_truth.
  - **Reuse imports** (avoid re-implementing): import `TextBlock`, `extractTexts`, and the `reasoningStateLabel` helper from `runs/[evalRunId]/matches/page.tsx`. If those aren't exported today, extract them to a sibling `evolution/src/components/evolution/matches/` module in this PR (one small refactor; documented).
  - "Open in Match Viewer" link via `findArenaComparisonForVariantsAction` (identical to existing pattern).
- [ ] Update `EvolutionBreadcrumb` chain: `Evolution > Judge Lab > Agreement > Run abc12345 > Matches` (5 segments — one more than the regular sweep's 4 because Agreement is its own nav group; `EvolutionBreadcrumb` supports arbitrary depth).

### Phase 5: Tests + docs

- [ ] Update `docs/feature_deep_dives/judge_evaluation.md` Agreement Sweep section:
  - Document new label wording (single canonical name per metric).
  - Document the new `/matches` sub-route under "Admin UI".
  - Document the new `worst_criterion_name` field on the leaderboard.
  - Document the live cost-preview behavior and the in-UI temperature default advice.
- [ ] Update `evolution/docs/visualization.md` route table with the new `/matches` sub-route + the updated detail page (new tiles, CI rendering).
- [ ] Update `evolution/docs/cost_optimization.md` to document `estimateAgreementCostAction` as the canonical live-preview surface (one-liner under the Judge-Eval cost section).
- [ ] Run all checks per `/finalize` flow (lint/tsc/build/unit/integration/e2e:critical).

## Testing

### E2E test posture (spec'd globally — applies to all E2E items below)
- [ ] **No LLM calls.** The spec uses `page.route('**/api/...createAgreementSweep*', ...)` mocks AND mocks the server action by routing to a fixture-returning handler. The spec NEVER triggers real `createAgreementSweepAction`.
- [ ] **No DB writes.** The spec consumes seeded pre-completed `judge_eval_agreement_runs` / `_calls` / `_criterion_verdicts` rows created in `test:e2e:setup` (one-time staging fixture). If new rows ARE needed for any flow, add `test.afterAll(async () => { await deleteAgreementRunById(...) })` per the ESLint `flakiness/require-test-cleanup` rule.
- [ ] **Debounce assertion uses `expect.poll`** — banned: `waitForTimeout`, fixed sleeps. Pattern:
  ```ts
  await page.fill('[data-testid="agreement-repeats-input"]', '20');
  await expect.poll(
    () => page.locator('[data-testid="agreement-cost-preview"]').textContent(),
    { timeout: 5000 }
  ).toContain('20 repeats');
  ```
- [ ] **Cap-overflow path uses a Playwright route mock** of the `estimateAgreementCostAction` endpoint to return synthetic `{ capStatus: 'over_usd', estimatedCostUsd: 9999, maxUsd: 5 }`. No env-var manipulation, no real cost cap trigger. The mock route is registered in `beforeEach` and unregistered in `afterEach` via `page.unrouteAll({ behavior: 'wait' })` per Rule 10.
- [ ] **No `networkidle`** — wait on specific selectors (`expect(locator).toBeVisible()` etc.).

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/agreementMetrics.test.ts` — extend existing test file:
  - Position-bias derivation:
    - both passes parse to same winner → no position bias.
    - both passes parse to opposite winners → position bias ++.
    - one parses to A, other returns null → EXCLUDED from denominator.
    - both null → EXCLUDED from denominator.
    - Mix of patterns → correct rate over the included-only subset.
  - Wilson CI integration: each existing rate also asserts its CI bounds with stub `wilsonScoreCI` (verify call shape).
  - Existing rate computations still produce the same scalar values (regression check — confirms additive parallel fields don't break legacy).
- [ ] `evolution/src/lib/shared/wilsonCI.test.ts` (new):
  - Known proportions → known intervals (cross-check against published Wilson tables for `(s=8, n=10)`, `(s=0, n=10)`, `(s=10, n=10)`).
  - `n === 0` → returns `null`.
  - Non-default `z` (e.g., 90% CI = z=1.645) — at least one test.
  - Negative inputs throw.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-judge-eval-agreement.integration.test.ts` — extend existing file:
  - `estimateAgreementCostAction` happy path returns plausible `pairCount × repeats × 4 = plannedCalls`.
  - `estimateAgreementCostAction` returns `capStatus: 'over_usd'` when `JUDGE_EVAL_MAX_USD` env var is set to a low value at the start of the test (settings.ts reads env at call time, not module-load — verified in research).
  - **`estimateAgreementCostAction` makes ZERO LLM calls**: mock `createCallLLMJudge` / `callLLM` at module level; assert call count is 0 after running the action.
  - `getAgreementLeaderboardAction` returns the new `worst_criterion_name` / `worst_criterion_disagree_rate` / CI columns over a seeded run.
  - `getAgreementLeaderboardAction` Wilson CIs use the correct denominator per rate (assert CI width differs between `strict_agree_rate` and `both_decisive_agree_rate` when their underlying denominators differ).
  - `getAgreementCallsAction` paginated reads return expected rows + `total`. Test `kindFilter` parameter and pagination boundary (`offset >= total` returns empty array, total unchanged).
  - `getAgreementCallsAction` with `disagreeOnly: true` returns only the both-decisive-opposite subset.
  - `getAgreementCallDetailAction` returns the raws + criterion verdicts for one call.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts` (new spec, `{ tag: '@evolution' }`):
  - **Launcher cost-preview updates as `repeats` changes** — assert text contains the new pair × repeats × 4 formula via `expect.poll`.
  - **Launch button disables when synthetic over-cap is mocked** — Playwright route-mock the action to return `over_usd`; assert button is disabled.
  - **Estimate failure ≠ Launch disabled** — Playwright route-mock the action to throw 500; assert "Cost preview unavailable" appears AND Launch stays enabled.
  - **Tooltip-bearing column headers** expose `title` attributes; the `<details data-testid="agreement-definitions">` block expands and collapses.
  - **Detail page renders 6 tiles** (including 2 new position-bias tiles); each tile shows `xx% [yy, zz]` CI format.
  - **"View all matches →" link** navigates to the new `/matches` sub-route.
  - **Matches page pagination** works; row expand fetches audit payload; "Open in Match Viewer" opens a new tab.
  - **`?disagree=1` filter** — assert that adding the query param narrows the row count vs no filter (against the seeded fixture where row count is known).

### Manual Verification
- [ ] On staging, launch an Agreement sweep against a real test set with `temperature=0`, `repeats=5`, and verify the live cost preview matches the post-launch billed cost within the 1.3× reserve margin. **Expected estimate range**: for the smallest seeded fixture (~10 pairs × 5 repeats × 4 calls = 200 calls × ~$0.0001/call ≈ $0.02). Abort if preview shows > $1 — indicates a math bug.
- [ ] Open a historical agreement run pre-dating this PR — verify position-bias tiles render correctly (raws were already persisted) and CI whiskers render with sane bounds.
- [ ] Cross-check label wording: launch the launcher and the detail page side-by-side, confirm each metric has exactly one canonical label.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts` against the local server (via `ensure-server.sh`) and verify all assertions pass on Chromium.
- [ ] Manually launch the local server, navigate to `/admin/evolution/judge-lab/agreement`, and walk through: change inputs → see live cost preview → expand "What do these mean?" → click a leaderboard row → see CI on tiles → click "View all matches →" → expand a row → see audit detail → click "Open in Match Viewer".

### B) Automated Tests
- [ ] `npm test -- evolution/src/lib/judgeEval/agreementMetrics.test.ts evolution/src/lib/shared/wilsonCI.test.ts`
- [ ] `npm run test:integration -- src/__tests__/integration/evolution-judge-eval-agreement.integration.test.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts`
- [ ] **CI workflow check**: confirm `09-admin/` is already classified under `EVOLUTION_ONLY_PATHS` in `.github/workflows/ci.yml` (it is per `_research.md` notes — verify with `grep '09-admin' .github/workflows/ci.yml` pre-PR). No workflow file edit expected.
- [ ] Full local check trio at `/finalize`: `npm run lint && npm run typecheck && npm run build && npm test && npm run test:integration && npm run test:e2e:critical`

## Rollback
- UI-only changes + 2 new server actions. No DB migration, no env-var changes, no new dependencies.
- **Rollback path**: `git revert <merge_commit_sha>`. No data migration to reverse. Historical agreement runs persist their raws — reverting the UI does not lose data.
- New server actions (`estimateAgreementCostAction`, `getAgreementCallsAction`, `getAgreementCallDetailAction`) are net-additive; reverting removes them but does not affect existing actions.
- The additive parallel CI fields on `AgreementMetrics` are non-breaking — reverting only removes the fields; existing scalar rates stay valid.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — **REQUIRED**: document new `/matches` sub-route, new leaderboard columns (`worst_criterion_*`), CI whisker rendering, position-bias tiles, label-unification wording, live cost preview, in-UI temperature/repeats advice.
- [ ] `evolution/docs/visualization.md` — **REQUIRED**: add the new `/matches` sub-route to the route table; update the agreement run-detail row to reflect new tiles + tooltips + label wording.
- [ ] `evolution/docs/cost_optimization.md` — **REQUIRED**: document `estimateAgreementCostAction` as the canonical live-preview surface under the Judge-Eval cost section. Includes the zero-LLM-call invariant.
- [ ] `evolution/docs/implicit_rubric_weights.md` — **OPTIONAL**: cross-reference if we want the closest analog tool to converge on the same label wording / cost-preview pattern.
- [ ] `evolution/docs/rating_and_comparison.md` — **OPTIONAL**: one-liner cross-reference if the position-bias tile reuses `parseWinner` / `parseRubricVerdict` in a new way.
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

### Iteration 1 (plan-review)

| Perspective | Score | Critical gaps |
|---|---|---|
| Security & Technical | 4/5 | 2 (S1 debounce shape, S2 zero-LLM-call invariant) |
| Architecture & Integration | 3/5 | 2 (A1 RateWithCI type cascade, A2 leaderboard CI denominators) |
| Testing & CI/CD | 3/5 | 3 (T1 E2E cleanup posture, T2 cap-overflow gating, T3 expect.poll commitment) |

**All 7 critical gaps addressed in this revision:**
- **S1** → Phase 2 launcher hook spec rewritten with correct debounce shape (timer in effect body, AbortController + cancelled flag, min-input-length guard, error fallback).
- **S2** → Phase 1 action spec includes top-of-file invariant comment + integration test that mocks LLM client and asserts zero invocations.
- **A1** → Options Considered pivoted to additive parallel CI fields (no breaking change); existing consumers unaffected.
- **A2** → Options Considered + Phase 1 leaderboard spec explicit: supplemental aggregation query fetches per-rate denominators (`both_decisive_n`, `exactly_one_decisive_n`) from `judge_eval_agreement_calls`; Wilson CI applied per rate with correct n.
- **T1** → Testing section has a global "E2E test posture" block declaring no LLM calls, no DB writes (or `afterAll` cleanup if writes are needed), pre-seeded fixtures.
- **T2** → "E2E test posture" block names Playwright route mock as the cap-overflow gating mechanism; no env-var manipulation.
- **T3** → "E2E test posture" block commits to `expect.poll` for the debounce assertion with concrete pattern; `data-testid` added throughout for selectors.

High-impact minor items folded in: Wilson n=0 → null; position-bias null policy; cost-preview error fallback; index hint for criterion-verdict query; wilsonCI.ts → `evolution/src/lib/shared/`; breadcrumb 5-segment note; estimateSweepCost ×2 multiplication frozen; cost_optimization.md promoted to REQUIRED; rollback section added; data-testid plumbing throughout; explicit `?disagree=1` E2E assertion; AgreementAuditDetail plain-text-only render contract.
