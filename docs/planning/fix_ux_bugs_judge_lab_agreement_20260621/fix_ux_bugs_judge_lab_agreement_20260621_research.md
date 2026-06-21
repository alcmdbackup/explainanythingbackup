# Fix UX Bugs Judge Lab Agreement Research

## Problem Statement
Fix UX issues and bugs surfaced while using the Judge Lab Agreement sweep tool (rubric ↔ holistic agreement mode at `/admin/evolution/judge-lab/agreement`). Improve in-context explanations of sweep knobs (`repeats`, judging temperature default) and metric labels (`per-rep`, `both-dec`, `abstain`), make pre-flight cost preview use the existing cost-estimation infrastructure, and build a detail/drill-down view that surfaces individual matches with per-criterion agreement vs. the holistic verdict. Add a summary view that aggregates forward vs. reverse pass agreement and per-criterion disagreement rates against the holistic assessment.

## Requirements (from GH Issue #1248)
- Explain more clearly in UI/UX what "repeats" does
- Preview cost accurately using pre-existing infrastructure
- What is the best judging temperature? Do we have a default to advise?
- Build a detail view that allows you to view the results in much more detail - e.g. individual matches, which criteria agreed vs. didn't with overall
- Compute useful summary view that shows how often we had forward vs. reverse pass for holistic vs. criteria runs agreeing, how often individual criteria disagreed with wholistic assessment, etc
- Clearly explain what "per-rep", "both-dec" and "abstain" mean

## High Level Summary

The Agreement sweep (project `Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619`) shipped a working pipeline but a sparse UI. All six requirements are scoped to the launcher (`agreement/page.tsx`, ~390 lines) and the run-detail page (`agreement/runs/[agreementRunId]/page.tsx`, ~300 lines) — no schema migration is strictly required to fulfill any of them:

- **Labels (`repeats`, `per-rep`, `both-dec`, `abstain`)** are well-defined in the reducer (`agreementMetrics.ts:9-30, 89-194`) but ship with no inline tooltips. The launcher has a single faded footer line explaining only two of the four labels (`agreement/page.tsx:384`); the detail-page tiles relabel the same metrics with inconsistent wording ("Per-pair agree" / "Agree (both-dec)" / "Abstain / diverge" / "Per-repeat agree" at `agreement/runs/[agreementRunId]/page.tsx:125-130`).
- **Cost preview** has a complete pre-existing estimator (`evolution/src/lib/judgeEval/cost.ts::estimateSweepCost`) that already returns `{ cells, comparisons, estimatedCostUsd }` and is enforced by `assertWithinJudgeEvalCap` (`settings.ts:156`). The launcher only surfaces this estimate AFTER the user clicks "Dry run" (`agreement/page.tsx:132-135`); a tight loop calls the full action (which fetches the test set + rubric server-side) instead of estimating live as inputs change.
- **Temperature default** is `0` (`agreement/page.tsx:64`, schema default at `judgeEvalActions.ts:548`), which matches the production judge path (`compareWithBiasMitigation` pins temperature 0 for the ranking phase) and the empirical evidence in `docs/analysis/judge_agreement_summary_tables.md`: at temp=0, gpt-4.1-mini / deepseek-chat hit 100% decisive agreement on large-gap pairs; gpt-4.1-nano drops from 90% (temp 0) to 60% (temp 1.0). The right move is to surface "0 (matches production judge)" as in-UI guidance, not to change the default.
- **Match-by-match detail view** does not exist for agreement runs. The existing run-detail page surfaces a "Disagreement pairs" drill-down (`agreement/runs/[agreementRunId]/page.tsx:246-294`) limited to both-decisive opposite-winner calls, capped at 100, with NO audit-payload expansion. The regular judge-eval sweep already has a paginated match-history sub-route `runs/[evalRunId]/matches/page.tsx` (~284 lines, lazy audit-payload expand pattern via `getJudgeEvalCallDetailAction`) that we can mirror almost line-for-line.
- **Forward-vs-reverse pass summary** is achievable WITHOUT a migration: `judge_eval_agreement_calls` already persists `holistic_forward_raw` / `holistic_reverse_raw` / `rubric_forward_raw` / `rubric_reverse_raw` (engine writes them at `agreement.ts:226-229`). The engine derives the aggregated winner via `parseWinner(...) → aggregateWinners(...)` (`agreement.ts:194-199`); we can replay that same parser on read in either a derived reducer or a new server action and surface forward-vs-reverse agreement rates per side (holistic vs rubric). Backfill is "free" — historical rows already have the raws.
- **Per-criterion disagreement aggregate** is already computed by the reducer (`agreementMetrics.ts:160-177`, `perCriterion[].disagreeRate`) and rendered in the per-criterion table on the run-detail page. The leaderboard does NOT surface this aggregate, so a researcher comparing runs at a glance can't see "which run had the most rebellious criterion." Adding a "worst-criterion disagreement" column to the leaderboard (or a histogram) is small.

The single biggest unknown that needs a planning-phase decision is **detail-view scope**: do we mirror the regular-sweep match-history pattern (a separate `runs/[agreementRunId]/matches` sub-route) or fold the same content into an expand-on-click row inside the existing run-detail page. The plan should pick one; either fits the codebase patterns.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (discovered for this project)
- docs/feature_deep_dives/judge_evaluation.md — Judge Lab feature deep dive; defines the agreement-sweep tables and what each run's `settings_key` covers
- docs/analysis/judge_agreement_summary_tables.md — empirical 80-call/model judge-agreement matrix (4 temperatures × 5 judge models × 2 variant pairs); evidence for the temp-default recommendation
- evolution/docs/implicit_rubric_weights.md — closest analog tool; mirrors the 4-call-per-(pair × repeat) cost shape (`judgeEvalActions.ts:578` invokes the same per-call dispatcher as the weight-inference auto mode)
- evolution/docs/rating_and_comparison.md — `buildComparisonPrompt`, `parseWinner`, `aggregateWinners`, `buildRubricComparisonPrompt`, `parseRubricVerdict`, the 2-pass reversal contract
- evolution/docs/visualization.md — Judge Lab admin route inventory + shared components (`MetricGrid`, `EvolutionBreadcrumb`, `EntityListPage`)
- evolution/docs/cost_optimization.md — `assertWithinJudgeEvalCap`, `JUDGE_EVAL_MAX_USD` / `MAX_CALLS` envelope, `calculateLLMCost`
- evolution/docs/criteria_agents.md — `evolution_criteria` rubric anchors → `evolution_judge_rubric_dimensions` weight read at `judgeRubricActions.ts::getJudgeRubricForEvaluation`
- evolution/docs/data_model.md — `judge_eval_agreement_runs` (one row per `settings_key`), `judge_eval_agreement_calls` (per pair × repeat — including the four raws), `judge_eval_agreement_criterion_verdicts` (flat per-criterion verdict)
- evolution/docs/metrics.md — `decisive_rate` = `confidence > 0.6` (same threshold the reducer uses at `agreementMetrics.ts:10`)
- evolution/docs/strategies_and_experiments.md — bootstrap-CI patterns (potentially useful if we later want CI whiskers on agreement rates)
- evolution/docs/architecture.md — V2 pipeline context (orientation)
- evolution/docs/arena.md — match-data origin context
- evolution/docs/entities.md — admin-UI entity registry shape
- evolution/docs/reference.md — file index + env vars (`JUDGE_EVAL_*`)
- evolution/docs/README.md — evolution doc map

## Code Files Read

### Agreement UI (the main edit surface)
- `src/app/admin/evolution/judge-lab/agreement/page.tsx` — launcher + leaderboard
  - `repeats` state: `useState<number>(10)` at L66; bare `<input type="number" min=1 max=50>` at L273-282; no help text
  - Temperature state: `useState<number>(0)` at L64; bare `<input type="number" step=0.1 min=0 max=2>` at L244-254; no help text
  - Reasoning state: `useState<'none' | 'low' | 'medium'>('none')` at L65; dropdown at L257-270
  - Cost preview: `estimate` text rendered ONLY after `run(dryRun)` returns at L286-290; formula at L132-135 `"${pairCount} pairs × ${repeats} repeats × 4 calls = ${plannedCalls} calls · est $${estimatedCostUsd.toFixed(4)}"`
  - Leaderboard footer (the only label hint): L383-386 `"Per-rep = per-repeat label match · Both-dec = agreement when both judges decisive · Acc Δ = rubric − holistic accuracy vs Elo ground truth"` — **"Abstain" is undefined in UI text**
  - Leaderboard column maps `r.strict_agree_rate → "Per-rep"` (L374), `r.both_decisive_agree_rate → "Both-dec"` (L375), `r.abstain_divergence_rate → "Abstain"` (L376)

- `src/app/admin/evolution/judge-lab/agreement/runs/[agreementRunId]/page.tsx` — run detail
  - 4 metric tiles at L125-130 with inconsistent wording vs leaderboard ("Per-pair agree" vs "Per-rep", "Agree (both-dec)" vs "Both-dec", "Abstain / diverge" vs "Abstain", "Per-repeat agree" vs none on launcher)
  - Per-criterion table at L183-224 already shows Agree / Disagree / Abstain / GT-Acc per criterion — usable; needs tooltips
  - Disagreement drill-down at L246-294 — both-decisive opposite-winner only; sliced to top 100; NO per-pass / NO audit-payload expansion; has "Match Viewer ↗" link via `findArenaComparisonForVariantsAction`
  - Reducer call at L83-113 — passes call inputs + criterion inputs through `computeAgreementMetrics` derived from `getAgreementRunDetailAction` payload
  - Reducer output unused by UI: `metrics.perRepeatAgreeRate` rendered as "Per-repeat agree" tile, `metrics.rubricAHolisticBRate` / `rubricBHolisticARate` rendered as a one-line muted note at L176-179
  - **What's missing for the user's "summary view" ask:** forward-vs-reverse pass agreement breakdown — neither the reducer nor the page touches per-pass winners

### Agreement engine + reducer (semantics source of truth)
- `evolution/src/lib/judgeEval/agreement.ts` — engine
  - `AgreementCallResult` interface at L48-83 — defines what each persisted row carries, **including** `holistic_forward_raw`, `holistic_reverse_raw`, `rubric_forward_raw`, `rubric_reverse_raw` (raws are persisted; per-pass parsed winners are NOT stored — they're derived at line 194 in-memory only)
  - `evaluatePairAgreement` at L168-241 — for one pair × `repeats` repeats, dispatches 4 LLM calls per repeat (2 holistic + 2 rubric) via `Promise.all`, then aggregates via `aggregateWinners` (holistic) and `aggregateRubric` (rubric)
  - `computePairAgreement` at L89-116 — pure: takes holistic winner + rubric breakdown → per-criterion `agrees_with_holistic` (true/false/null where null = abstain on TIE or unparsed both passes)
  - Engine never persists per-pass winners — only raws. Replay on read with `parseWinner` / `parseRubricVerdict` is the cheap path; adding columns is the durable path

- `evolution/src/lib/judgeEval/agreementMetrics.ts` — pure reducer (the semantics canon)
  - L10 `DECISIVE_THRESHOLD = 0.6` (matches `metrics.ts` / `finalization.ts` `decisive_rate`)
  - L13-22 `AgreementCallMetricsInput` — the per-call shape the reducer reads
  - L47-74 `AgreementMetrics` output — defines `perPairModalAgreeRate`, `perRepeatAgreeRate`, `bothDecisiveAgreeRate`, `bothDecisiveOppositeRate`, `abstainDivergenceRate`, `rubricAHolisticBRate`, `rubricBHolisticARate`, `holisticAccuracy`, `rubricAccuracy`, `accuracyDelta`, `perCriterion[]`
  - **Exact definition of each term we need to explain in UI:**
    - **per-rep / per-repeat agreement** (L96-97): `(rubric_winner === holistic_winner) over ALL calls` — strict label match across every (pair × repeat) row, no decisive filter
    - **per-pair (modal) agreement** (L99-113): reduce each judge to its *modal* winner per pair across repeats, then compare once per pair — smooths over per-call noise
    - **both-decisive agreement** (L116-122): subset of calls where BOTH `holistic_confidence > 0.6` AND `rubric_confidence > 0.6`, fraction that agree — strips out noise from indecisive calls (= the cleanest "do they really agree" signal)
    - **abstain divergence** (L123-128): fraction of calls where EXACTLY ONE judge was decisive (the other abstained / TIE'd) — interpreted as "rubric abstained when holistic committed, or vice versa"
    - **rubricAHolisticB / rubricBHolisticA** (L129-134): the two directions of disagreement (rubric prefers A while holistic prefers B, etc.) — exposed as a one-line muted note on the detail page

### Cost-preview infrastructure (the "pre-existing infrastructure")
- `evolution/src/lib/judgeEval/cost.ts` — exactly what we need to reuse
  - `estimateComparisonCostUsd(model, charsA, charsB, explainReasoning)` at L14-32 — per-2-pass-comparison estimate using `getModelInfo` per-1M pricing + `chars/4` token approximation; intentionally rough; the per-call onUsage estimate during the run is authoritative
  - `estimateSweepCost(input)` at L51-72 — totals over selected pairs × repeats × `cells` (models × temps × reasoning × prompt variants); already returns `{ cells, comparisons, estimatedCostUsd }`
  - For agreement: `cells = 1` (single model + single temp + single reasoning), but each repeat = 4 calls (2 holistic + 2 rubric) — the launcher dry-run path computes `pairCount × repeats × 4 = plannedCalls` directly, so the reuse path is straightforward
- `evolution/src/lib/judgeEval/settings.ts:plannedCalls / assertWithinJudgeEvalCap` at L143-176 — the hard ceiling (`JUDGE_EVAL_MAX_CALLS=20000`, `JUDGE_EVAL_MAX_USD=5`) is the existing guard; live preview should not re-implement it, just call the same estimator with current form state
- `evolution/src/services/judgeEvalActions.ts:createAgreementSweepAction` at L555-592 — current dry-run path: parses input → loads test set + rubric → calls `executeAgreementSweep({ dryRun: true })` → returns `{ pairCount, plannedCalls, estimate: { estimatedCostUsd } }`. For live preview, the cheaper path is a new `estimateAgreementCostAction` that reuses `loadTestSetByName` + `estimateSweepCost` (no rubric fetch needed since rubric only affects token count slightly)

### Server actions + persistence
- `evolution/src/services/judgeEvalActions.ts:getAgreementLeaderboardAction` at L600-614 — reads the SQL view `judge_eval_agreement_leaderboard` (per run × `pair_kind` aggregates), zero LLM cost. Leaderboard fields exposed: `strict_agree_rate`, `both_decisive_agree_rate`, `abstain_divergence_rate`, `holistic_accuracy`, `rubric_accuracy`, `n_calls`, `total_cost_usd`
- `evolution/src/services/judgeEvalActions.ts:getAgreementRunDetailAction` at L621-656 — reads the run + all Core call rows + all criterion verdicts in three queries; the page slices kind + runs the reducer. `CORE_AGREEMENT_CALL_COLUMNS` does NOT include the four `*_raw` audit fields — for the new detail view we'd want a dedicated `getAgreementCallDetailAction` (mirror of `getJudgeEvalCallDetailAction`) that lazily fetches a single call's audit payload, keeping the list query off TOAST
- `evolution/src/lib/judgeEval/agreementPersist.ts` — persists `judge_eval_agreement_runs` row + per-call rows + per-criterion verdicts; engine result rows already carry every field we need
- `evolution/src/lib/judgeEval/schemas.ts` — `judgeEvalCallSchema` at L103-141 (regular sweep) has `forward_winner` / `reverse_winner` columns at L110-111; **the agreement schema does NOT** — confirms the per-pass-winner data lives only in the raws on the agreement side

### Reference: existing match-detail pattern (the model to mirror)
- `src/app/admin/evolution/judge-lab/runs/[evalRunId]/matches/page.tsx` — the regular sweep's match history
  - 25-per-page paginated list of `JudgeEvalCallCore` via `getJudgeEvalCallsAction` (L99-122)
  - Lazy expand-on-click loads audit payload via `getJudgeEvalCallDetailAction` (L128-151), cached in `auditById` map keyed by call id
  - `AuditDetail` component (L55-94) renders: split Content A / Content B (from prompt regex), reasoning-state label, forward + reverse `TextBlock`s (prompt / reasoning / raw output)
  - `extractTexts` helper at L30-35 regex-matches `## Text A ... ## Text B` from the prompt
  - "Open in Match Viewer" cross-link via `findArenaComparisonForVariantsAction` (L156-171)
  - **Direct template for the new `agreement/runs/[agreementRunId]/matches/page.tsx`** — same shape, swap data source

### Evidence for the temperature default
- `docs/analysis/judge_agreement_summary_tables.md` — empirical agreement matrix
  - Large gap (A vs B, 25 mu / 404 Elo): gpt-4.1-nano drops 90% → 60% as temp goes 0 → 1.0; gpt-4.1-mini, deepseek, gpt-oss-20b stay 100% at all temperatures
  - Close pair (C vs D, 0.09 mu / 1.4 Elo): temperature has no measurable effect — capable models stay 100% decisive, weak models stay 100% TIE
  - Conclusion: **temp=0 is the right default** (matches production judge, costs nothing extra, only helps weak models)
  - The default 0 already matches the production rubric judge path (`evolution/src/lib/shared/rubricJudge.ts` is called via `compareWithBiasMitigation` which pins temp 0 — verified in `rating_and_comparison.md`)
  - **No need to change the default; just add an inline hint** like "0 (recommended — matches production judge)" near the input

## Key Findings (numbered for plan reference)

1. **Six requirements map to ~8 small UI-layer changes**, none of which require a DB migration. The biggest single change is a new match-history sub-route (`runs/[agreementRunId]/matches`) that mirrors the regular-sweep pattern.

2. **The label inconsistency is bigger than it looks.** Three labels — `Per-rep` (launcher), `Per-pair agree` (detail tile 1), `Per-repeat agree` (detail tile 4) — span the launcher and detail page on the same screen for the *same* test set. Two of those refer to one metric (`perRepeatAgreeRate`) and one to another (`perPairModalAgreeRate`). Picking ONE name per metric and using it everywhere is the cheapest correctness win.

3. **`repeats` is the most ambiguous knob.** With the default 10 it controls `pairs × 10 × 4 = 40 × pairs` LLM calls. Users likely don't realize that a 100-pair test set + 10 repeats = 4000 calls (just under the `JUDGE_EVAL_MAX_CALLS = 20000` ceiling). The fix is a one-line subtitle under the input: "Each pair is judged N times (4 LLM calls/repeat = 2 holistic + 2 rubric). Doubles cost; halves per-pair noise."

4. **Live cost preview is two function calls away.** A new `estimateAgreementCostAction({ testSetName, kindFilter, repeats, judgeModel, explainReasoning })` that does (a) `loadTestSetByName` (b) `estimateSweepCost` and returns `{ pairCount, plannedCalls, estimatedCostUsd, capStatus: 'ok' | 'overCalls' | 'overUsd' }`. The launcher debounces input changes and renders the result inline next to the Launch button. Reuses 100% existing math — zero new estimators.

5. **Temperature default is correct; the missing piece is in-UI advice.** Add a faded help line under the temperature input: "0 (recommended — matches production judge path; see `docs/analysis/judge_agreement_summary_tables.md`). Higher temps introduce judge noise for nano-class models."

6. **Forward-vs-reverse agreement is recoverable without a migration.** `parseWinner(holistic_forward_raw)` + `parseWinner(holistic_reverse_raw)` give the holistic per-pass winners; `parseRubricVerdict(rubric_*_raw, dimNames)` gives the rubric per-pass winners. A new reducer pass — added to `agreementMetrics.ts` — can emit `holisticPositionBiasRate` (fwd disagrees with rev) and `rubricPositionBiasRate` (same for rubric), surfaced as two new tiles on the detail page. Replay parsing cost is microseconds per call.

7. **Per-criterion disagreement isn't visible on the leaderboard.** The launcher leaderboard already has columns for the aggregate buckets, but doesn't reveal which run had the worst per-criterion disagreement (i.e., "your rubric's `engagement` criterion sided against the holistic judge 80% of the time"). One column ("Worst criterion / disagree%") would help researchers triage runs at a glance — requires a new derived field in `getAgreementLeaderboardAction` (or compute client-side from a parallel `getMaxCriterionDisagreementAction`).

8. **The detail view has a working "Open in Match Viewer" link** for individual disagreement rows. Good news: any new match-history sub-route we build inherits this for free.

9. **The Disagreement drill-down is silently capped at 100 rows** (`agreement/runs/[agreementRunId]/page.tsx:270`). On a 4000-call run with significant disagreement, the operator can't see what's past row 100. Either paginate or move the entire concept into the new match-history sub-route (which paginates by default at 25).

10. **The empirical research that justifies temp=0** is captured in `docs/analysis/judge_agreement_summary_tables.md` and `docs/analysis/judging_accuracy_20260412.md`. We can directly link to those from the in-UI temperature help text instead of re-summarizing — they're shipped in the repo.

## Open Questions (to resolve in `/plan-review` or with user)

- **Detail-view scope:** new sub-route at `runs/[agreementRunId]/matches` (paginated, mirrors regular sweep) OR expand-on-click inline within the existing detail page? Recommendation: separate sub-route for consistency with regular sweep and to avoid bloating an already-busy detail page. Either is small.
- **Forward-vs-reverse persistence:** parse raws on read each time (cheap, no migration) OR backfill four new columns via a one-time migration (durable, queryable from SQL view)? Recommendation: parse on read for now — if we ever want to surface position-bias on the leaderboard SQL view, the migration follows.
- **Tooltip mechanism:** plain `<abbr title="...">` (browser native, works) OR shadcn-style popover (richer, requires component). Recommendation: native `title` for terse labels + a single "What do these mean?" expandable details block at the top of the leaderboard with the full definitions copied verbatim from this research doc.
- **Leaderboard column additions:** should "Worst criterion / disagree%" be a new column on the leaderboard, or only surface on detail? Recommendation: add as a leaderboard column — it's the highest-signal "what went wrong" indicator and the leaderboard is the triage surface.
- **Live cost preview UX:** show the estimate inline next to Launch (compact) OR as a separate "Cost preview" card under the form (verbose)? Recommendation: compact inline next to the Launch button + a tooltip with the breakdown `pairs × repeats × 4 calls × per-call cost`.
- **Does the user want CI whiskers on agreement rates?** The bootstrap CI infrastructure in `evolution/src/lib/metrics/computations/propagation.ts` exists, but adding it is a layer up from the listed requirements. Defer unless asked.
