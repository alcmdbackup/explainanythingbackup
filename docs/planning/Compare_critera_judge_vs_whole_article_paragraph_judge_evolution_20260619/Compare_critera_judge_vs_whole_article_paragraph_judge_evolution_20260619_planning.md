# Compare Criteria Judge vs Whole Article/Paragraph Judge Plan

## Background
Build into Judge Lab the ability to compare rubric (criteria-based) judges against whole-article or paragraph holistic judges. We want to assess how often a given rubric agrees with comparisons made WITHOUT a rubric (holistic A/B/TIE), for both paragraph and whole-article comparisons, and to show how often the individual criteria decisions — and the aggregated criteria decision — agree or disagree with the article-level (holistic) winner/loser.

## Requirements (from GH Issue #1228)
Run a test to assess how often a given type of rubric agrees with comparisons without rubric

Build this capability into judge lab

Make sure this supports both paragraph and whole article comparisons

Be able to show how often the individual criteria decisions (as well as aggregated criteria decisions) or disagree with the article level winner/loser

## Problem
Judge Lab can already run holistic sweeps and rubric (`criteria_split`) sweeps over frozen test sets, split by `pair_kind` (article/paragraph), and it persists per-dimension verdicts. What is missing is an explicit **holistic-vs-rubric agreement comparison**: for each pair, run both the no-rubric holistic judge and the rubric judge, then measure and display (1) aggregated-criteria-winner vs holistic-winner agreement and (2) each-individual-criterion-winner vs holistic-winner agreement, sliced by article/paragraph and by rubric. The existing `favored_match_winner` compares a dimension to the rubric's own aggregate, not to a separately-run holistic verdict — so a new comparison axis and surfacing are needed.

## Confirmed Decisions (from /research, 2026-06-19)
- **Baseline = HOLISTIC no-rubric judge.** Per pair, run both a holistic A/B/TIE judge and a rubric judge; agreement = same A/B/TIE label. (NOT the rubric's own aggregate — the existing `favored_match_winner` answers that different question and is not reused.)
- **Rubric judge = one 2-pass call scoring all criteria** (reuses `buildRubricComparisonPrompt`). Cost = **4 LLM calls per pair·repeat** (2 holistic + 2 rubric), single judge model.
- **Both `pair_kind`s supported** for free — holistic + rubric prompts both take `mode ∈ {article, paragraph}`.

See the research doc's **Proposal** section for the full engine/schema/metrics/UI sketch.

## Options Considered
- [x] **Option A (CHOSEN): New "Agreement Sweep" mode (holistic + rubric paired per pair)**: A third Judge Lab sweep mode that, for each pair in a frozen test set, runs the holistic judge AND the rubric judge with one shared `callLLM` closure, records holistic winner / rubric aggregate winner / per-criterion winners, and computes agreement (aggregate-vs-holistic + per-criterion-vs-holistic). Cheapest correct option (4 calls/pair·repeat), guarantees identical pairs/repeats/model, reuses every existing judging primitive, never touches production ranking.
- [x] **Option B: Post-hoc join of two existing eval runs** (`judge_eval_agreement_runs` + read-time VIEW). Rejected as primary — a single-judge rubric run doesn't persist per-criterion verdicts today (only `criteria_split` does, at 2·N calls), so this forces the expensive path or still needs engine work. Kept as a possible later "compare arbitrary existing runs" feature.
- [x] **Option C: Reuse `favored_match_winner`**. Rejected — compares criteria to the rubric aggregate, not the holistic winner (wrong question).
- [x] **Option D: `criteria_split`-style planner that also runs holistic**. Rejected — per-criterion dispatch is more cost/complexity than the confirmed "one rubric call, all criteria" needs.

## Phased Execution Plan

### Phase 1: Research & design (deep read + decision)
- [x] Deep-read `escalation.ts`, `runJudgeEval.ts`, `metrics.ts`, `rubricJudge.ts`, `judgeEvalActions.ts`, `judgeRubricActions.ts`, judge-lab admin pages, and the judge_eval migrations
- [x] Decide Option A / B / C (agreement computation locus) and the persistence shape (new column(s) vs new table vs read-time join)
- [x] Define the agreement metrics precisely (aggregate-vs-holistic agreement %, per-criterion-vs-holistic agreement %, TIE/null handling, large-gap vs close-pair handling)

### Phase 2: Data model + engine
- [x] **Migration** (one file, idempotent — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each `CREATE POLICY`; passes `npm run lint:migrations`). RLS follows the **child-table precedent** (`20260614000003_judge_eval_dimension_verdicts.sql`): enable RLS, single `service_role_all` policy + `REVOKE ALL FROM PUBLIC, anon, authenticated` (deny-all is implicit once RLS is on with no permissive policy). Three tables:
  - `judge_eval_agreement_runs` — settings tuple (`test_set_id` FK, `judge_model`, `temperature NUMERIC(4,2)`, `reasoning_effort`, `kind_filter`, `judge_rubric_id`, `repeats`) + `settings_key TEXT NOT NULL UNIQUE`. **`settings_key` = sha256 over `agreement|judge_model|temperature.toFixed(2)|reasoning_effort|judge_rubric_id|kind_filter|repeats|test_set_id`** — the `agreement|` prefix mirrors `buildEscalationSettingsKey` and the per-table UNIQUE cannot collide with `judge_eval_runs.settings_key`. Re-running identical settings upserts the same run row.
  - `judge_eval_agreement_calls` — per (pair × repeat): `agreement_run_id` FK CASCADE, `pair_label`, `pair_kind`, `repeat_index`, `holistic_winner`, `holistic_confidence`, `holistic_decisive` (GENERATED `confidence > 0.6`), `rubric_winner`, `rubric_confidence`, `rubric_decisive` (GENERATED), `rubric_matches_holistic BOOLEAN`, cost/token columns (holistic + rubric summed AND split), `forward_raw`/`reverse_raw` per judge (audit, nullable), `error` (nullable), and the frozen ground-truth snapshot (`mu_a/b`, `sigma_a/b`, `gap_kind`, `expected_winner`, `variant_a_id`/`variant_b_id`).
  - `judge_eval_agreement_criterion_verdicts` — per criterion per call: `agreement_call_id` FK CASCADE, `criteria_id`, `criteria_name`, `weight`, `forward_verdict`, `reverse_verdict`, `dimension_winner`, `agrees_with_holistic BOOLEAN` (NULL on criterion TIE/abstain), `matches_ground_truth BOOLEAN` (NULL unless large-gap), `position` [O3].
- [x] **Engine `evolution/src/lib/judgeEval/agreement.ts`** (engine) — per pair, build ONE shared `JudgeFn` via `createCallLLMJudge` (call_source `evolution_judge_eval`, honors `E2E_TEST_MODE` stub, bounded retry, `onUsage` cost/token capture, `trackingDb` → `llmCallTracking`). **Mirror `escalation.ts`/`runJudgeEval.ts`'s inlined-2-pass pattern — do NOT use `compareWithBiasMitigation`** (it returns `(prompt)=>Promise<string>`-only, discards per-pass raw/cost/reasoning, ignores temperature/reasoning, and has a text-only cache; the engine header forbids it). Concretely, per (pair × repeat):
  - **Holistic:** `buildComparisonPrompt(a, b, mode)` fwd + `(b, a, mode)` rev → `JudgeFn` (Promise.all) → `aggregateWinners(parseWinner(fwd), parseWinner(rev))` → `{winner, confidence}` + raw/cost/tokens.
  - **Rubric (all criteria, one 2-pass call):** `buildRubricComparisonPrompt(a, b, resolvedRubric, mode)` fwd + rev → same `JudgeFn` → `aggregateRubric(parseRubricVerdict(fwd, dimNames), parseRubricVerdict(rev, dimNames), resolvedRubric)` → `{winner, confidence, rubricBreakdown}`.
  - **Per-criterion winner:** `reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner` for each `d` in `rubricBreakdown.dimensions` (there is NO precomputed `winner` field; both verdicts are real-frame `Verdict|null`; a both-null criterion = abstain per O2).
  - Temperature/reasoning reach the model ONLY through the `JudgeFn` closure's `CallLLMOptions` (the `rejudgeComparisonAction` precedent), not via prompt-builder args. **4 LLM calls/pair·repeat** (2 holistic + 2 rubric), one shared model [O4]. Bounded-concurrency worker pool + `partialResults` protocol (persist completed rows on partial failure).
- [x] **Orchestration `evolution/src/lib/judgeEval/executeAgreementSweep.ts`** — `loadTestSetPairs(db, testSetId, kindFilter)` → `assertWithinJudgeEvalCap({cells, matchingPairs, repeats, estimatedCostUsd, chainCap: 2})` (chainCap 2 yields `plannedCalls = cells*pairs*repeats*2*2 = ×4`; add a `// 4 calls/pair·repeat = 2 holistic + 2 rubric` comment so the overload is clear) → upsert run → run engine → persist. Pre-flight cost = `estimateComparisonCostUsd` called **twice** (holistic + rubric, each already a 2-pass ×2) summed. Inherits the `JUDGE_EVAL_ENABLED` kill switch via `assertWithinJudgeEvalCap`.
- [x] **Persistence `evolution/src/lib/judgeEval/agreementPersist.ts`** — `replaceCalls`-style delete-then-insert into the 3 tables (idempotent re-run), mirroring `escalationPersist.ts`.
- [x] **Pure reducer `computeAgreementMetrics(rows, {byKind})` + `agreement.test.ts`** (sibling to `metrics.ts`, reused by UI + CLI): per-pair-modal + per-repeat agreement [O1]; three TIE buckets — strict / both-decisive (conf>0.6) / abstain-divergence [O2]; per-criterion agree/disagree/abstain (criterion TIE excluded from that criterion's agree/disagree denominator) [O2]; holistic/rubric/per-criterion accuracy vs Elo `expected_winner` on large-gap pairs only [O5]; sliced Article/Paragraph/Both and per rubric.

### Phase 3: Server actions + CLI
- [x] `createAgreementSweepAction(input)` in `evolution/src/services/judgeEvalActions.ts` — `adminAction`-wrapped (`requireAdmin`), Zod-validated (`testSetName`, `kindFilter`, `judgeModel`, `temperatures`, `reasoningEffort`, `judgeRubricId`, `repeats`, `dryRun`). Validates `judgeModel` against `getDeployableEvolutionModelIds()`. **Resolves the rubric via `getJudgeRubricForEvaluation` and HARD-FAILS with a validation error when it returns `null`** (rubric is required; do not silently fall back to holistic). Runs `executeAgreementSweep` (cap-gated, `trackingDb` passed for `llmCallTracking`). Returns a `SweepOutcome`-style result incl. the cost estimate.
- [x] Readers (zero-cost, explicit column lists — no `SELECT *` on audit columns): `getAgreementRunDetailAction({runId, kind})` (loads agreement_calls + criterion_verdicts for the run → reducer in the page, matching `runs/[evalRunId]` TS pattern) and `getAgreementLeaderboardAction({testSetId, kind})`.
- [x] **Leaderboard data source decision:** add a SQL VIEW `judge_eval_agreement_leaderboard` (one row per run × `pair_kind`) for the headline aggregates — both-decisive agreement rate, abstain/divergence rate, and rubric−holistic accuracy-Δ (all simple `COUNT(*) FILTER` aggregates over `judge_eval_agreement_calls.{rubric_matches_holistic, holistic_decisive, rubric_decisive, matches_ground_truth}`). This matches the existing `judge_eval_settings_leaderboard` view pattern (leaderboard = SQL view; run-detail = TS reducer). RLS-lock the view (`REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT TO service_role`).
- [x] CLI subcommand `agreement-sweep` in `evolution/scripts/judge-eval.ts` (mirrors `escalation-sweep`; `--test-set`, `--model`, `--rubric`, `--temperatures`, `--repeats`, `--dry-run`).

### Phase 4: Admin UI (new sub-route `src/app/admin/evolution/judge-lab/agreement/`)
- [x] Add a third **Agreement** option to the existing launcher mode toggle (`data-testid="judge-lab-mode"`); render the agreement launcher form + leaderboard (wireframes ①–③). Rubric `<select>` from `listJudgeRubricsAction({status:'active'})`; model `<select>` from `getJudgeModelOptionsAction`.
- [x] **Run-detail page at `src/app/admin/evolution/judge-lab/agreement/runs/[agreementRunId]/page.tsx`** — MUST nest under `agreement/` (Next.js forbids a second dynamic param name at the existing `judge-lab/runs/[evalRunId]/` level). `'use client'`, `EvolutionBreadcrumb`, `view-{kind}` toggle re-slicing every panel, `MetricGrid` tiles (3 TIE buckets + per-repeat), per-criterion agreement table, ground-truth accuracy panel (wireframe ④).
- [x] Disagreement drill-down (wireframe ⑤): expandable pairs where aggregate/criterion disagrees with the holistic winner/loser; **Open in Match Viewer** via `findArenaComparisonForVariantsAction`.

### Phase 5: Docs
- [x] Update `docs/feature_deep_dives/judge_evaluation.md` with the agreement capability

## UI Flow & Wireframes

The Agreement feature adds a third Judge Lab mode. The kind toggle (`Both / Article / Paragraph`) re-slices every panel on the run-detail screen — article and paragraph metrics are never mixed. Screen ④ maps 1:1 to the resolved decisions: the top tile row = O2's three TIE buckets + O1's per-repeat rate; the per-criterion table = the core requirement (individual + aggregated criteria vs the holistic winner/loser) with O2's abstain column; `GT-Acc` + the bottom panel = O5.

### Flow overview
```
/admin/evolution/judge-lab
   │
   ├─ Mode toggle:  [ Single judge ] [ Escalation chain ] [ Agreement ◄new ]
   │                                                          │
   │                                              ┌───────────┘
   │                                              ▼
   │                                   ① Agreement launcher form
   │                                       │  Dry run → ② estimate
   │                                       │  Launch  → runs sweep (4 calls/pair·repeat)
   │                                       ▼
   │                                   ③ Agreement leaderboard (runs for this test set)
   │                                       │ click a run
   │                                       ▼
   └──────────────────────────────►   ④ Agreement run detail
                                           │  kind toggle: Both / Article / Paragraph
                                           │  ├─ aggregate metric tiles (3 TIE buckets)
                                           │  ├─ per-criterion agreement table
                                           │  ├─ ground-truth accuracy panel
                                           │  └─ ⑤ disagreement drill-down → Match Viewer
```

### ① Launcher — Agreement mode selected (`src/app/admin/evolution/judge-lab/agreement/`)
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Evolution ▸ Judge Lab                                                       │
│  Mode:  ( Single judge )  ( Escalation chain )  (●Agreement )   data-testid: │
│                                                    judge-lab-mode             │
│  ┌──────────────────────── Agreement sweep ───────────────────────────────┐ │
│  │  Run a holistic (no-rubric) judge AND a rubric judge on the same pairs, │ │
│  │  then measure how often the rubric — overall and per criterion —        │ │
│  │  agrees with the holistic winner.                                       │ │
│  │  Test set      [ fr2-smoke ▾ ]            Kind  [ Both ][Article][Para] │ │
│  │  Judge model   [ qwen-2.5-7b-instruct ▾ ]   ◄ one model, both judges    │ │
│  │  Rubric        [ Core article rubric (5 criteria) ▾ ]   ◄ required      │ │
│  │  Temperature   [ 0 ▾ ]      Reasoning [ none ▾ ]     Repeats [ 10 ]     │ │
│  │  ▸ Advanced (custom holistic prompt override)            [collapsed]    │ │
│  │              [ Dry run ]            [ Launch sweep ]                     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### ② Dry-run estimate (inline)
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Estimate                                                  data-testid:     │
│  ───────────────────────────────────────────────────────  agreement-est    │
│  20 pairs × 10 repeats × 4 calls  =  800 LLM calls                         │
│  (2 holistic + 2 rubric per pair·repeat)                                   │
│  est. cost  ~$0.42      within cap ($5.00 / 20,000 calls)  ✓               │
│              [ Dry run ]            [ Launch sweep ]                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### ③ Agreement leaderboard (below launcher)
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Agreement runs                       view: [ Both ][ Article ][ Paragraph ]│
│  ──────────────────────────────────────────────────────────────────────────│
│  Run       Model            Rubric        Kind  Agree(dec)  Both-dec  Acc Δ  │
│  ─────────────────────────────────────────────────────────────────  data-   │
│  a1b2c3d4  qwen-2.5-7b      Core article  Art    71%        82%      +4%  ►  │  testid:
│  a1b2c3d4  qwen-2.5-7b      Core article  Para   63%        77%      −2%  ►  │  agreement-
│  9f8e7d6c  gpt-4.1-nano     Core article  Art    80%        88%      +9%  ►  │  leaderboard
│  ──────────────────────────────────────────────────────────────────  -row  │
│  Agree(dec) = agreement among both-decisive pairs · Acc Δ = rubric − holistic│
│              accuracy vs Elo ground truth (large-gap pairs)                 │
└────────────────────────────────────────────────────────────────────────────┘
```

### ④ Agreement run detail (`agreement/runs/[agreementRunId]/page.tsx` — nested under `agreement/`, NOT siblinged to the existing `runs/[evalRunId]`) — core screen
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Judge Lab ▸ Agreement ▸ Run a1b2c3d4…              [copy id]                │
│  qwen-2.5-7b-instruct · temp 0 · Core article rubric · 20 pairs · 10 reps   │
│  Kind:  (●Both )  ( Article )  ( Paragraph )           ◄ view-{kind}         │
│  ┌── Rubric ↔ Holistic agreement ──────────────────────────────┐  ◄MetricGrid│
│  │  Strict agree    Agree (both-dec)   Abstain/diverge   Per-rep │  kind-block │
│  │      68%              82%                14%            79%    │            │
│  │  (all pairs)    (both conf>0.6)   (one TIEs)      (per-repeat)│            │
│  └──────────────────────────────────────────────────────────────┘            │
│  ┌── When they DISAGREE (both decisive, opposite winner) ───────┐            │
│  │   18% of pairs   ·   rubric A / holistic B: 11%              │            │
│  │                      rubric B / holistic A:  7%              │            │
│  └──────────────────────────────────────────────────────────────┘            │
│  ┌── Per-criterion agreement with holistic winner ─────────────────────────┐ │
│  │  Criterion          Weight  Agree   Disagree  Abstain(TIE)  GT-Acc       │ │
│  │  ───────────────────────────────────────────────────────────  data-      │ │
│  │  Clarity             0.25    74%      18%         8%         70%   ►      │ │ testid:
│  │  Structure & flow    0.25    66%      26%         8%         61%   ►      │ │ per-
│  │  Accuracy/depth      0.20    81%      12%         7%         77%   ►      │ │ criterion-
│  │  Engagement          0.15    58%      30%        12%         55%   ►      │ │ table
│  │  Grammar & style     0.15    62%      24%        14%         52%   ►      │ │
│  │  ─────────────────────────────────────────────────────────────────       │ │
│  │  Aggregated rubric   —       82%      18%         —          —            │ │
│  │  GT-Acc = criterion winner vs true higher-Elo article (large-gap pairs)  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│  ┌── Accuracy vs Elo ground truth (large-gap pairs, n=12) ──────┐            │
│  │     Holistic judge   78%        Rubric judge   82%   (+4%)    │            │
│  └──────────────────────────────────────────────────────────────┘            │
│  [ ▾ Show disagreement pairs (⑤) ]              [ Match history ]            │
└────────────────────────────────────────────────────────────────────────────┘
```

### ⑤ Disagreement drill-down (expand criterion ► or "Show disagreement pairs")
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Disagreement pairs — Structure & flow (criterion ↔ holistic)   data-testid:│
│  ──────────────────────────────────────────────────────────  disagree-table │
│  Pair        Kind  Holistic   Rubric   This crit  GT      Gap                │
│  ────────────────────────────────────────────────────────────────────────── │
│  fr2-0142    Art    A (0.9)    B (0.7)    B         A(lg)  +180  ▸ expand     │
│  fr2-0088    Art    A (0.7)    A (1.0)    B         A(lg)  +210  ▸ expand     │
│  fr2-0203    Para   TIE        B (0.7)    B         —      close ▸ expand     │
│  ──────────────────────────────────────────────────────────────────────────│
│      ▼ expanded: fr2-0142                                                    │
│      ┌── Text A (mu 25.3) ────────────┐ ┌── Text B (mu 23.1) ──────────────┐ │
│      │ The Federal Reserve was …      │ │ Established in 1913, the Fed …    │ │
│      └────────────────────────────────┘ └──────────────────────────────────┘ │
│      Holistic: A · Rubric overall: B · Structure crit: B · Truth: A          │
│                                            [ Open in Match Viewer ↗ ]        │
└────────────────────────────────────────────────────────────────────────────┘
```

Reuses existing plumbing: `MetricGrid` tiles, `EvolutionBreadcrumb`, the `view-{kind}` toggle pattern, and **Open in Match Viewer** via `findArenaComparisonForVariantsAction`.

## Rollback & Kill Switch
- **Kill switch (inherited):** `createAgreementSweepAction` runs through `assertWithinJudgeEvalCap`, which honors `JUDGE_EVAL_ENABLED='false'` (short-circuits all sweeps) plus `JUDGE_EVAL_MAX_CALLS`/`JUDGE_EVAL_MAX_USD`. No new flag needed; an existing op control already disables the feature.
- **Rollback:** the migration is purely **additive** (3 new tables + 1 view, no edits to existing tables) and the engine **never touches production ranking** (`compareWithBiasMitigation` prod path is untouched; agreement runs write nothing to `evolution_variants`/`evolution_arena_comparisons`/`evolution_metrics`). Rollback = leave the additive tables in place + set `JUDGE_EVAL_ENABLED=false` (or revert the UI/action commit); no data migration to undo.

## Testing

### Unit Tests
- [x] `evolution/src/lib/judgeEval/agreement.test.ts` — `computeAgreementMetrics` math, enumerating the resolved-decision edge cases as named cases: **three TIE buckets** (strict all-pairs / both-decisive conf>0.6 / abstain-divergence one-TIEs) [O2]; **per-pair-modal vs per-repeat** divergence [O1]; **per-criterion TIE abstains** are excluded from that criterion's agree/disagree denominator but counted in abstain rate [O2]; **ground-truth accuracy only on `gap_kind='large'` pairs** (close excluded) [O5]; per-rubric + per-`pair_kind` slicing; degenerate inputs — empty rows, zero-criteria rubric, all-TIE pair, criterion with both verdicts null.
- [x] Verify per-criterion winner derivation: `reconcilePasses(forward, reverse)` handles `null`/partial inputs as O2 expects (both-null → abstain).

### Integration Tests
- [x] `src/__tests__/integration/judge-eval-agreement.integration.test.ts` — an agreement sweep over a seeded article+paragraph test set persists rows into **all three** new tables (`judge_eval_agreement_runs` + `_calls` + `_criterion_verdicts`); asserts `rubric_matches_holistic` and `agrees_with_holistic` are populated. **Auto-skips when evolution tables aren't migrated** by probing a column on a NEW table (e.g. `judge_eval_agreement_calls.rubric_matches_holistic`), mirroring the existing escalation-integration probe. **`afterAll` deletes the seeded bank/test-set/run** (FK CASCADE cleans children) — required since the test imports evolution DB helpers.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts` (`{ tag: '@evolution' }`, NOT `@critical` — admin is host-gated). **Deterministic, no real LLM spend:** follow the existing judge-lab spec convention — seed **pre-completed** agreement rows directly via the DB helper and assert the **read** surfaces (leaderboard, run-detail tiles, per-criterion table, `view-{kind}` re-slice, disagreement drill-down), plus exercise the launcher **Dry-run estimate** path only. If a live Launch is exercised at all, the agreement engine's shared `JudgeFn` must honor `E2E_TEST_MODE` (both holistic + rubric closures stubbed) so no provider call is made. Flakiness-rule compliant: `data-testid` selectors only, **hydration wait** before interacting with the kind toggle (Rule 18), **no `networkidle`** (Rule 9), point-in-time-free assertions on post-toggle `kind-block-{kind}` (Rule 4), and **`adminTest.afterAll` cleanup** of the seeded rows across all 3 tables (Rule 16).

### Manual Verification
- [x] Seed a small article+paragraph test set, run an agreement sweep on staging, confirm agreement %s + per-criterion table + GT-accuracy render for both kinds.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Judge Lab agreement page renders aggregate + per-criterion agreement for article and paragraph (local server via ensure-server.sh)

### B) Automated Tests
- [x] `npm run test:unit -- --grep "agreement"`
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-agreement.spec.ts`

### C) Migration verification
- [x] `npm run lint:migrations` — new migration passes the idempotency lint (`CREATE TABLE/INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`)
- [x] `npm run migration:verify` — applies all migrations to ephemeral Docker postgres (runs in `/finalize` Step 5.5 since the PR touches `supabase/migrations/**`); also the `check-migration-order` + `check-migration-append-only` CI gates
- [x] CI note: the `@evolution` E2E + integration tests **auto-skip until the agreement tables are migrated on staging** (CI `deploy-migrations` applies on merge to `main`). Until then, a green CI run means those specs *skipped*, not passed — verify locally against a migrated staging DB.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/judge_evaluation.md` — add the holistic-vs-rubric agreement capability (new sweep mode/metrics/UI)
- [x] `evolution/docs/rating_and_comparison.md` — note holistic-vs-rubric agreement measurement if rubric/holistic primitives change
- [x] `evolution/docs/data_model.md` — document any new column/table for agreement persistence
- [x] `evolution/docs/criteria_agents.md` — cross-reference if criteria/rubric usage changes
- [x] `evolution/docs/arena.md` — cross-reference only if pair-bank seeding changes

## Review & Discussion

### Iteration 1 — scores: Security 3/5 · Architecture 4/5 · Testing 3/5
Critical gaps fixed:
1. **[Security/Arch — wrong engine primitive]** Plan specified `compareWithBiasMitigation` for the LLM calls, which the judge-eval engine explicitly forbids (discards per-pass cost/raw/reasoning, ignores temperature, text-only cache). → Phase 2 rewritten to mirror `escalation.ts`/`runJudgeEval.ts`: shared `JudgeFn` (from `createCallLLMJudge`, with `onUsage`/`trackingDb`/`E2E_TEST_MODE`), `buildComparisonPrompt`/`buildRubricComparisonPrompt` + `aggregateWinners`/`aggregateRubric`, per-criterion via `reconcilePasses`. Temperature/reasoning flow through the closure's `CallLLMOptions`.
2. **[Testing — migration verification absent]** → Added Verification §C: `npm run lint:migrations` + `npm run migration:verify` + the order/append-only gates + the auto-skip-until-migrated CI caveat.
3. **[Testing — E2E real-LLM-spend / flakiness]** → E2E bullet now mandates the deterministic seed-pre-completed-rows + Dry-run-only pattern (or `E2E_TEST_MODE`-stubbed launch), plus hydration wait / no-networkidle / data-testid / `afterAll` cleanup across all 3 tables.

Minor issues addressed:
- **[Arch — routing param collision]** Agreement run-detail nested at `agreement/runs/[agreementRunId]/` (cannot sibling the existing `runs/[evalRunId]`). Wireframe ④ path corrected.
- **[Arch — engine file split]** Named `agreement.ts` (engine) + `executeAgreementSweep.ts` (orchestration) + `agreementPersist.ts` (persistence), matching the escalation family layout.
- **[Arch — leaderboard data source]** Decided: SQL VIEW `judge_eval_agreement_leaderboard` for headline aggregates (matches existing leaderboard-view pattern); TS reducer for run-detail.
- **[Security — null rubric guard]** Action hard-fails when `getJudgeRubricForEvaluation` returns null (no silent holistic fallback).
- **[Security — settings_key]** Composition specified with `agreement|` prefix + `judge_rubric_id` included; per-table UNIQUE cannot collide with `judge_eval_runs`.
- **[Security/Arch — RLS + cost factor]** Child-table RLS follows the leaner `service_role_all` + REVOKE precedent; `chainCap:2` (→ ×4) annotated; unit-test edge cases enumerated; kill-switch/rollback section added.

### Iteration 2 — scores: Security 5/5 · Architecture 5/5 · Testing 5/5 → **CONSENSUS REACHED**
All three reviewers independently re-verified their iteration-1 blockers against the actual code and confirmed resolution. No critical gaps remain. Plan is ready for execution.

**Non-blocking execution caveats (fold in during implementation — not blockers):**
- **GENERATED columns:** use the full `BOOLEAN GENERATED ALWAYS AS (confidence > 0.6) STORED` form (per `judge_eval_tables.sql:74`), referencing `holistic_confidence`/`rubric_confidence` in the same `CREATE TABLE`.
- **Abstain detection:** `reconcilePasses(null, null)` returns `{winner:'TIE'}` (not null), so the reducer must treat `forwardVerdict==null && reverseVerdict==null` as **abstain** explicitly, not via `winner!=='TIE'`.
- **Field-name mapping in `agreementPersist`:** in-memory `RubricDimensionBreakdown` uses `criteriaId`/`name` (no per-dim `weight` — weight comes from the resolved rubric); map to migration columns `criteria_id`/`criteria_name`/`weight`.
- **Error rows (NULL confidence):** `holistic_decisive`/`rubric_decisive` are NULL on `error` rows → reducer must treat NULL-decisive as "not both-decisive" (don't throw); add an error-row case to the unit edge-case list.
- **Leaderboard view denominators:** specify `COUNT(*) FILTER (...)` denominators to avoid divide-by-zero / NULL-in-denominator when a run has zero large-gap pairs; add one integration/E2E read that exercises the `judge_eval_agreement_leaderboard` view (second computation path beyond the TS reducer).
- **E2E cleanup:** prefer `trackEvolutionId` + `cleanupAllTrackedEvolutionData()` (track the run/test-set/bank ids; FK CASCADE cleans `_calls`/`_criterion_verdicts`) over manual 3-table deletes; use the same new-table-column probe (`judge_eval_agreement_calls.rubric_matches_holistic`) for pre-migration auto-skip.
