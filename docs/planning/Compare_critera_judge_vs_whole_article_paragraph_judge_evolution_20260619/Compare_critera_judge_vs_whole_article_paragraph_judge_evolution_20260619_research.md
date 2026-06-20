# Compare Criteria Judge vs Whole Article/Paragraph Judge Research

## Problem Statement
Build into Judge Lab the ability to compare a rubric (criteria-based) judge against the whole-article or paragraph **holistic** (no-rubric) judge. Run a test that assesses how often a given rubric agrees with comparisons made WITHOUT a rubric, for both paragraph and whole-article comparisons, and show how often the **individual** criteria decisions — and the **aggregated** criteria decision — agree or disagree with the article-level (holistic) winner/loser.

## Requirements (from GH Issue #1228)
Run a test to assess how often a given type of rubric agrees with comparisons without rubric

Build this capability into judge lab

Make sure this supports both paragraph and whole article comparisons

Be able to show how often the individual criteria decisions (as well as aggregated criteria decisions) or disagree with the article level winner/loser

## Clarifications Received (2026-06-19)
1. **"Article-level winner" = the HOLISTIC no-rubric judge's winner.** Per pair, run BOTH a holistic A/B/TIE judge AND a rubric judge; measure how often the aggregated-rubric winner and each individual criterion agree with the *holistic* winner. This is a true "rubric vs without-rubric" comparison (NOT the rubric's own aggregate — that distinction matters, see Finding 6).
2. **Rubric judge = one 2-pass call scoring all criteria in one response** (reuses `buildRubricComparisonPrompt`). Cost = **4 LLM calls per pair·repeat** (2 holistic + 2 rubric), single judge model. (Not the per-criterion `criteria_split` planner.)

## High Level Summary

The Judge Lab (`/admin/evolution/judge-lab`, deep dive `docs/feature_deep_dives/judge_evaluation.md`) is a mature batch-measurement layer for evaluating the arena judge over a **frozen test set** of comparison pairs, split first-class by `pair_kind` ∈ {article, paragraph}. **Every primitive this project needs already exists** — holistic judging, rubric judging (all-criteria-in-one-pass), per-pair ground-truth snapshots, frozen test sets, cost gating, a pure-reducer metrics pattern, and a `'use client'` admin UI calling `adminAction`-wrapped server actions. What does **not** exist is a path that runs the holistic judge and the rubric judge on the **same pair** and computes their agreement. The work is therefore a thin, well-scoped vertical slice: a new "agreement sweep" that fans both judges over one frozen test set and surfaces aggregate + per-criterion agreement, sliced by article/paragraph.

Confidence is high that this is a small-to-medium feature (one migration, one engine function reusing existing pure judging functions, one cost-gated server action, one CLI subcommand, one admin page) rather than new judging machinery.

## Key Findings

1. **Holistic and rubric verdicts are produced by the same entry point, switched by one arg.** `compareWithBiasMitigation(textA, textB, callLLM, cache?, mode, rubricContext?)` in `evolution/src/lib/shared/computeRatings.ts:789` returns a `ComparisonResult { winner: 'A'|'B'|'TIE'; confidence; turns; rubricBreakdown?; submatches? }` (`computeRatings.ts:319-330`). With `rubricContext` **undefined** → holistic (one A/B/TIE verdict). With `rubricContext` set (a `ResolvedJudgeRubric`) → rubric verdict whose `rubricBreakdown.overall` is the aggregated winner AND whose `rubricBreakdown.dimensions[]` carry per-criterion `forwardVerdict`/`reverseVerdict` (already real-frame). Both run 2-pass reversal; rubric still costs only **2 LLM calls** (all dimensions in one response).

2. **Both winners are directly comparable A/B/TIE labels in the same frame.** Holistic `winner` and rubric `rubricBreakdown.overall.winner` are both real-frame (A=textA, B=textB), produced by the *same* 5-value confidence table (`aggregateWinners` for holistic at `computeRatings.ts:641`; `reconcilePasses` for rubric at `rubricJudge.ts:161`, "mirrors the holistic table without flipping"). So **agreement = identical label**. Per-criterion winner = `reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner` (both already real-frame). This makes the agreement computation trivial pure code.

3. **Both modes (`article`/`paragraph`) are supported by the rubric judge.** `buildRubricComparisonPrompt(textA, textB, rubric, mode, ...)` (`rubricJudge.ts:284`) only changes the unit noun ("article"/"paragraph"); the dimension blocks + per-line `dimension: A|B|TIE` contract are identical. Holistic `buildComparisonPrompt` swaps in mode-specific rubric prose. So the same agreement engine works for both kinds — satisfying "support both paragraph and whole article comparisons."

4. **The injected-LLM (`JudgeFn`) pattern lets one shared `callLLM` closure power both judges.** A `(prompt: string) => Promise<string>` closure wrapping `callLLM` from `@/lib/services/llms` (call_source e.g. `evolution_judge_eval`, with `onUsage` cost capture, E2E stub, bounded retry) is passed to both `compareWithBiasMitigation` calls — one holistic, one rubric. Same model, same cost path, two comparable verdicts. Engine precedent: `runJudgeEval.ts` `createCallLLMJudge` (`:248-317`) and `arenaActions.ts` `rejudgeComparisonAction` (`:726-737`).

5. **Frozen test sets already guarantee identical, kind-split pairs.** `judge_eval_test_sets` + `judge_eval_test_set_members` freeze a per-kind sample (`size_article`/`size_paragraph`, strategy, seed). `loadTestSetPairs(db, testSetId, kindFilter)` resolves members to full pairs with text + ground-truth snapshot (`mu/sigma`, `gap_kind`, `expected_winner`, `baseline_confidence`). The agreement sweep reuses this verbatim — no new sampling code, and article/paragraph slicing is inherent.

6. **The existing `favored_match_winner` answers a DIFFERENT question and cannot be reused.** `judge_eval_dimension_verdicts.favored_match_winner` (written only by rubric-mode escalation sweeps, `escalationPersist.ts:171-190`) compares each criterion to the **rubric's own consolidated winner**, not to a holistic winner (`migration 20260614000003:16-18`: "did this dimension favor the consolidated MATCH winner"). For the confirmed cross-mode reading we need criterion-vs-**holistic**, so a fresh comparison is required. (One agent initially suggested "no migration needed" by reusing this column — that conflates the rubric aggregate with the holistic winner and is incorrect for this project.)

7. **No existing code or column pairs a holistic verdict with a rubric verdict for the same pair.** In the judge-eval engine, holistic vs rubric is a *per-run mode* (`judge_eval_runs.prompt_variant`/`_hash` → a different `settings_key`); a holistic run and a rubric run are two separate rows over the same `test_set_id`, and nothing joins them. In production ranking (`computeRatings.ts:666-700` `runSingleComparison`) it is a single `if (rubricContext) {…} else {…}` branch — one or the other. On the arena side, `evolution_arena_comparisons.rubric_breakdown` is NULL for holistic matches. So the pairing must be introduced.

8. **Metrics follow a pure-reducer pattern, computed in TS (not SQL).** `evolution/src/lib/judgeEval/metrics.ts` `computeMetrics(calls, opts)` is a pure function reused by both the run-detail UI and CLI (`decisiveRate`, `selfConsistency`, `avgConfidence`, `positionBiasRate`, `accuracy` vs ground truth on large-gap pairs, `costPerDecisiveUsd`, etc.). Article/paragraph slicing is done by the *caller* filtering before calling the reducer. The agreement metrics should be a sibling pure reducer (`agreement.ts` + `agreement.test.ts`), keeping the same testable, I/O-free shape.

9. **Cost gating is centralized and easy to extend.** `assertWithinJudgeEvalCap({cells, matchingPairs, repeats, estimatedCostUsd, chainCap?})` (`settings.ts:130`) runs BEFORE any LLM call; `plannedCalls = cells * pairs * repeats * 2 * chainCap`. Caps: `JUDGE_EVAL_ENABLED`, `JUDGE_EVAL_MAX_CALLS` (20000), `JUDGE_EVAL_MAX_USD` ($5). For an agreement sweep, **call factor = 4** (2 holistic + 2 rubric) → pass `chainCap = 2` (gives the ×4) or add a dedicated factor. Cost estimate via `estimateComparisonCostUsd` (`cost.ts`), summed twice (holistic + rubric).

10. **Admin UI house style is fixed and easy to match.** All judge-lab pages are `'use client'` components calling `adminAction`-wrapped server actions (`ActionResult<T>`), using `EvolutionBreadcrumb`, `MetricGrid` (shared metric tiles), kebab-case `data-testid`s (`leaderboard-table`, `kind-block-{kind}`, `per-pair-table`), CSS-var styling (`var(--accent-gold)`), and `sonner` toasts. E2E specs live at `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab*.spec.ts`. A new agreement page/section drops cleanly into this.

11. **Migration conventions are strict (idempotency-linted).** New tables: `CREATE TABLE IF NOT EXISTS`; indexes `CREATE INDEX IF NOT EXISTS`; `DROP POLICY IF EXISTS` before `CREATE POLICY`; deny-all + `service_role_all` RLS (per `evolution_arena_submatches`, `20260614000004:64-74`); views `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT SELECT ... TO service_role`. `settings_key` is `TEXT NOT NULL UNIQUE` for idempotent re-runs.

## Proposal

### Recommended approach: a dedicated "Agreement Sweep" in Judge Lab (Option A)

Add a third Judge Lab sweep mode — **Agreement** — alongside Single-judge and Escalation. For each pair in a frozen test set (article + paragraph), it runs the **holistic** judge and the **rubric** judge with one shared `callLLM` closure, then records per (pair × repeat): the holistic winner, the rubric aggregate winner, whether they agree, and each criterion's winner + whether it agrees with the holistic winner. Aggregate + per-criterion agreement metrics are computed by a pure reducer and surfaced in a new agreement page, sliced Article / Paragraph / Both and per rubric.

This was chosen over the alternatives because it is the most faithful to "**run a test** … **build this capability into judge lab**," is the cheapest correct option (4 calls/pair·repeat vs criteria_split's 2 + 2·N), guarantees the holistic and rubric judges see identical pairs/repeats/model, and reuses every existing judging primitive without touching the production ranking path.

#### Alternatives considered
- **Option B — pair two existing runs + read-time VIEW** (`judge_eval_agreement_runs` linking a holistic run and a rubric run + a SQL view). Rejected as the primary: a *single-judge* rubric run does NOT persist per-criterion verdicts today (only escalation `criteria_split` does, at 2·N calls), so this either forces the expensive criteria_split path or still requires extending the single-judge engine to persist a rubric breakdown — at which point a purpose-built agreement sweep is cleaner. Kept as a fallback if the user later wants to compare *arbitrary already-run* settings.
- **Option C — reuse `favored_match_winner`.** Rejected: it compares criteria to the rubric aggregate, not the holistic winner (Finding 6). Wrong question.
- **Option D — new `criteria_split`-style planner that also runs holistic.** Viable but heavier; criteria_split's per-criterion dispatch is more cost and complexity than the confirmed "one rubric call, all criteria" requirement needs.

### Engine sketch (new `evolution/src/lib/judgeEval/agreement.ts`)
Per pair, build one shared judge closure and call both judges:
```ts
// holistic verdict (no rubric)
const holistic = await compareWithBiasMitigation(a, b, callLLM, undefined, mode);            // {winner, confidence}
// rubric verdict (all criteria, one 2-pass call)
const rubric   = await compareWithBiasMitigation(a, b, callLLM, undefined, mode, resolved);  // {winner, confidence, rubricBreakdown}

const aggregateAgrees = rubric.winner === holistic.winner;                                    // aggregated-criteria vs holistic
const perCriterion = rubric.rubricBreakdown!.dimensions.map(d => {
  const cw = reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner;                      // criterion winner (real-frame)
  return { criteriaId: d.criteriaId, name: d.name, weight: d.weight, winner: cw,
           agreesWithHolistic: cw === 'TIE' ? null : cw === holistic.winner };
});
```
A bounded-concurrency worker pool (mirroring `runJudgeEval.ts:214`) fans this over the test set's pairs; partial-failure handling mirrors the existing `partialResults` protocol so a failed sweep persists what completed. A pure reducer `computeAgreementMetrics(rows, {byKind})` produces the rates below.

### Persistence (new migration, leanest viable shape)
Two new tables following the deny-all + `service_role_all` RLS + idempotency conventions:
- **`judge_eval_agreement_runs`** — one row per agreement-sweep settings tuple: `id`, `test_set_id` FK, `judge_model`, `temperature NUMERIC(4,2)`, `reasoning_effort`, `kind_filter`, `judge_rubric_id`, `repeats`, `settings_key TEXT NOT NULL UNIQUE` (= sha256 over the tuple, for idempotent re-runs), `created_at`.
- **`judge_eval_agreement_calls`** — one row per (pair × repeat): `id`, `agreement_run_id` FK CASCADE, `pair_label`, `pair_kind`, `repeat_index`, `holistic_winner`, `holistic_confidence`, `rubric_winner`, `rubric_confidence`, `rubric_matches_holistic BOOLEAN`, `criteria_breakdown JSONB` (`[{criteria_id, name, weight, winner, agrees_with_holistic}]` — mirrors the `evolution_arena_comparisons.rubric_breakdown` JSONB precedent and avoids a third table; per-criterion rollups are done in the TS reducer, consistent with the metrics.ts pattern), cost/token columns, and the frozen ground-truth snapshot (`gap_kind`, `expected_winner`, `variant_a_id`/`variant_b_id`, `mu/sigma`) copied from the resolved pair. (Open question O3 weighs JSONB vs a child `judge_eval_agreement_criterion_verdicts` table for SQL-queryable per-criterion rollups.)

### Metrics to surface ("show how often")
Computed per kind (Article / Paragraph / Both) and per rubric:
- **Aggregate agreement rate** — fraction of (pair·repeat) where `rubric_winner === holistic_winner`. Plus a "decisive-on-both" variant and a disagreement breakdown (rubric-A/holistic-B, TIE mismatches). Optional chance-corrected Cohen's κ.
- **Per-criterion agreement rate** — for each criterion, fraction of pairs where that criterion's winner equals the holistic winner ("how often does criterion X side with the whole-article winner/loser"), plus a weighted concordance. TIE criteria abstain (null).
- **Disagreement drill-down** — the pairs where aggregate or a given criterion disagrees with the holistic winner, expandable to the snapshot texts + Open-in-Match-Viewer.

### Server action + CLI
- `createAgreementSweepAction(input)` in `evolution/src/services/judgeEvalActions.ts` — `adminAction`-wrapped, Zod-validated (`testSetName`, `kindFilter`, `judgeModel`, `temperatures`, `reasoningEffort`, `judgeRubricId`, `repeats`, `dryRun`), validates the model + resolves the rubric via `getJudgeRubricForEvaluation`, runs `assertWithinJudgeEvalCap` with the ×4 factor, executes, persists, returns a `SweepOutcome`-style result with the cost estimate.
- `getAgreementRunDetailAction({runId, kind})` + `getAgreementLeaderboardAction({testSetId, kind})` — zero-cost readers (explicit column lists, no `SELECT *`).
- CLI: `agreement-sweep` subcommand in `evolution/scripts/judge-eval.ts`.

### Admin UI
A new sub-route `src/app/admin/evolution/judge-lab/agreement/` (launcher + leaderboard) and `runs/[agreementRunId]/page.tsx` (per-kind aggregate `MetricGrid` + per-criterion agreement table + disagreement drill-down), matching the existing `'use client'` + `MetricGrid` + `kind-block` + `data-testid` patterns. Add a third option to the launcher mode toggle.

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

### Relevant Docs
- docs/feature_deep_dives/judge_evaluation.md — **central**: Judge Lab pair-banks/test-sets/runs/calls, escalation + criteria_split, dimension verdicts, metrics, cost gates, admin UI.
- evolution/docs/rating_and_comparison.md — 2-pass reversal, `aggregateWinners`, `buildComparisonPrompt` article/paragraph modes, Rubric-Based Judging (`rubricJudge.ts`), Match Viewer re-judge.
- evolution/docs/criteria_agents.md — `evolution_criteria` + `evolution_judge_rubrics`/`_dimensions`.
- evolution/docs/arena.md — `evolution_arena_comparisons` vs the separate `judge_eval_*` tables.
- evolution/docs/data_model.md — judge_eval table family, dimension verdicts, submatches.
- (context) all other evolution docs.

### Existing related analyses
- docs/analysis/judge_agreement_summary_tables.md — empirical judge-model agreement data.
- docs/analysis/judging_accuracy_20260412.md — judge calibration data.

## Code Files Read (deep)
- evolution/src/lib/judgeEval/{schemas,runJudgeEval,executeSweep,persist,metrics,escalation,executeEscalationSweep,escalationPersist,settings,cost,testSet,seed}.ts — engine, sweep orchestration, cost gating, dimension-verdict write path.
- evolution/src/lib/shared/computeRatings.ts — `compareWithBiasMitigation`, `buildComparisonPrompt`, `run2PassReversal`, `aggregateWinners`, `parseWinner`, `ComparisonResult`, `ComparisonMode` (note: `comparison.ts` + `reversalComparison.ts` were consolidated into this file).
- evolution/src/lib/shared/rubricJudge.ts — `buildRubricComparisonPrompt`, `parseRubricVerdict`, `scorePass`, `reconcilePasses`, `aggregateRubric`, `RubricBreakdown`/`RubricDimensionBreakdown`.
- evolution/src/lib/shared/judgeRubrics.ts — `ARTICLE_SANDBOX_RUBRIC`/`PARAGRAPH_SANDBOX_RUBRIC` (prose sandbox defaults, NOT structured rubrics).
- evolution/src/lib/shared/judgeEnsemble/{types,aggregation,planner}.ts — `criteria_weighted` fold, aggregation registry.
- evolution/src/services/judgeEvalActions.ts — all server actions (launch + read), cost-gate wiring, `CORE_/AUDIT_CALL_COLUMNS`.
- evolution/src/services/judgeRubricActions.ts — `getJudgeRubricForEvaluation` resolver (rubric id → normalized dimensions+weights).
- src/app/admin/evolution/judge-lab/** — launcher (mode toggle, escalation rubric/planner selectors), leaderboard, run detail, matches, test-sets, pair-banks.
- supabase/migrations/2026060600001_judge_eval_tables.sql, 20260610000001 (audit+snapshot), 20260613000001 (escalation cols), 20260614000001 (leaderboard view), 20260614000002 (submatch unique), 20260614000003 (dimension verdicts), 20260614000004 (arena submatches).

## Resolved Open Questions (2026-06-19)
- **O1 — Repeats handling → SHOW BOTH.** Persist every per-(pair × repeat) row. Surface TWO metrics: a **per-pair-modal** headline (each judge reduced to its most-frequent winner across repeats, compared once per pair) AND a **per-repeat rate**. Reducer computes both; raw rows retained for self-consistency drill-down.
- **O2 — TIE semantics → THREE BUCKETS.** Report (1) strict agreement (all pairs, exact label match), (2) **agreement-among-both-decisive** (`confidence > 0.6` on both — the honest headline), and (3) **abstain/divergence rate** (one judge commits, the other TIEs). Per-criterion: a criterion TIE is an **abstain** — excluded from that criterion's agree/disagree denominator, tracked as a separate abstain rate.
- **O3 — Per-criterion persistence → CHILD TABLE.** New `judge_eval_agreement_criterion_verdicts` (flat row per criterion per call, FK→agreement_calls CASCADE), consistent with `judge_eval_dimension_verdicts` and directly SQL-queryable for ad-hoc `query:staging` studies + future `/analysis` reports. (Not JSONB.)
- **O4 — Holistic source → RE-JUDGE IN-SWEEP.** Always run holistic + rubric together per pair, **sharing one judge model/temp/reasoning** (controlled comparison — only the prompt differs). No reuse of cached holistic runs. Self-contained, apples-to-apples; cost already capped.
- **O5 — Ground-truth axis → YES, INCL. PER-CRITERION.** Also report holistic accuracy, rubric accuracy, AND per-criterion accuracy vs the Elo-gap `expected_winner` (large-gap pairs only; close pairs excluded, clearly labeled). Reuses the existing `computeMetrics(accuracy)` + the already-stored ground-truth snapshot. Answers "which judge — and which criteria — track true quality," not just "they differ."

### Net effect on the design
- **Persistence:** 3 new objects — `judge_eval_agreement_runs` (settings tuple + `settings_key` UNIQUE), `judge_eval_agreement_calls` (per pair × repeat: holistic + rubric winner/confidence, `rubric_matches_holistic`, decisive flags, cost/tokens, frozen ground-truth snapshot), and `judge_eval_agreement_criterion_verdicts` (per criterion: winner, `agrees_with_holistic` nullable-on-TIE, `matches_ground_truth` nullable, weight, position).
- **Reducer (`agreement.ts`):** emits per kind (Article/Paragraph/Both) and per rubric — per-pair-modal + per-repeat agreement, the three TIE buckets, per-criterion agreement + abstain rates, and the holistic/rubric/per-criterion ground-truth accuracy.
- **Cost factor:** 4 LLM calls/pair·repeat (2 holistic + 2 rubric) → `assertWithinJudgeEvalCap` with the ×4 factor.
