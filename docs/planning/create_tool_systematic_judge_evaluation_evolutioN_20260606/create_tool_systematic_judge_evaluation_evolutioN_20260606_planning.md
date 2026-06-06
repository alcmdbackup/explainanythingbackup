# Create Tool Systematic Judge Evaluation (Evolution) Plan

## Background
Create a new tool that helps systematically evaluate judge performance. The "judge" is the LLM that performs pairwise (A/B/TIE) comparisons of text variants in the evolution arena, producing winner verdicts and confidence/decisiveness scores that drive the Elo ratings. Today judge quality is studied ad-hoc; there's no repeatable tool to log match history, record the exact judge settings used, and measure whether custom prompt / temperature / added reasoning improves the decisiveness rate. This project builds that tool, storing results in a structured, retrievable way (keyed by judge settings) and replicating the methodology of the historical judge analyses already done in this repo and on GitHub.

## Requirements (from GH Issue #1167)
- Keep logs of match history
- Record settings used
- Test out if custom prompt/temperature/adding reasoning improves decisiveness rate
- Figure out how to store results in a structured way for later retrieval, including judging settings used
- Look at historical judge analysis, and see what we can learn from the methodology there
- How should this interact with match viewer and prompt modifier?
    - OK if this is adhoc
- Base this on the past judge analyses that have been done. Look at Github to find the historical records of the judge analyses that were done and try to replicate the methodology.

## Decisions (from user, 2026-06-06)
1. **Scope** = the **arena pairwise judge only** (`compareWithBiasMitigation`). The separate score-based `contentQualityCompare`/`contentQualityEval` judge is OUT of scope.
2. **Surface** = **script + DB tables + a Judge Lab admin page** (`/admin/evolution/judge-lab`). Interactive single-match re-judge stays in the existing Match Viewer; Judge Lab is the batch/sweep + persisted-results + leaderboard surface.
3. **Ground truth** = **mu/Elo gap only** (replicate history). Large-gap pairs get accuracy + implied-beta; close pairs are tie-acceptable (accuracy/beta skipped).
4. **Source the bank from the "Federal Reserve 2" arena topic** (`a546b7e9-f066-403d-9589-f5e0d2c9fa4f`) — pull **ALL** its recorded comparisons, not hand-picked pairs: ~6,972 article + ~1,889 paragraph distinct pairs (texts present). Real arena history, not synthetic.
5. **Article vs paragraph are FIRST-CLASS and filterable separately** everywhere — pair tagging, sweep selection, comparison_mode, metrics, and leaderboard. Each pair carries `pair_kind ∈ {article, paragraph}`; the judge auto-uses `mode='article'`/`'paragraph'` accordingly.
6. **Seed full bank, sample into a reusable Test Set.** Storing ~8,861 pairs is cheap; a full-grid sweep (~1.4M calls) is not. Sampling is **persisted as a named, frozen Test Set** (per-kind size + strategy + seed) — NOT recomputed per sweep — so **consecutive runs reference the same `test_set_id` and are directly comparable** on the identical subset. The full bank stays queryable; `--sample all` runs the whole bank deliberately.

## Problem
Judge decisiveness directly affects ranking signal: low-confidence/TIE-heavy verdicts don't move Elo, wasting LLM spend and slowing convergence (a recent baseline measured only ~2.4% decisive). The just-merged **Match Viewer (#1168, commit `23230ece`)** made judging *inspectable* and gave a one-match-at-a-time re-judge sandbox (model / temperature / custom prompt / reasoning) — but it **persists nothing and does no aggregate measurement**. There is no repeatable way to run a fixed bank of A/B pairs through the judge under varying settings, log every match + the exact settings, and compare decisiveness/agreement/cost across settings to pick a better default. The historical judge analyses (`docs/research/judge_agreement_summary_tables.md`, `judging_accuracy_20260412.md`; scripts on unmerged branch `feat/estimate_match_noise_evolution_20260411`) did this once, ad-hoc. This project turns that methodology into a reusable tool with structured, retrievable storage, built on the Match Viewer's re-judge primitive.

## Options Considered
- [x] **Option C (CHOSEN): Persistence + batch-measurement layer over the Match Viewer primitive.** Reuse `rejudgeComparisonAction` / `buildComparisonPrompt(customPromptOverride)` / `parseVerdictFromReasoning` (all on main post-#1168) as the judging primitive. Add a fixed pair-bank, a sweep engine over a settings grid, three `judge_eval_*` tables, a leaderboard VIEW, a CLI driver, AND a Judge Lab admin page. Smallest viable build that meets every requirement; ad-hoc interactive needs already covered by Match Viewer.
- [ ] **Option A: Standalone script + tables only (headless).** Rejected per user — wanted a Judge Lab admin page for discoverability/launching sweeps.
- [ ] **Option B: Full new admin tool duplicating match list + re-judge UI.** Rejected — #1168 already ships the interactive re-judge UI; duplicating it is high-cost waste. Judge Lab links to existing Match Viewer for single-match drilldown.

## Phased Execution Plan

### Phase 0: Methodology recovery + pair-bank seed (no app code)
- [ ] Recover the lost scripts for reference via per-file git (NEVER whole-dir, per CLAUDE.md): `git show 58fc7bff:evolution/scripts/judge-agreement-test.ts`, `git show 56023ed1:evolution/scripts/beta-analysis.ts`, `…:beta-sigma-impact.ts`. Capture exact agreement %, modal-winner, implied-beta formulas into `_research.md` (mostly done).
- [ ] Read `docs/planning/match_viewer_with_experimentation_procedures_20260605/` (on main) to align with #1168's contracts; confirm `rejudgeComparisonAction` signature + `buildComparisonPrompt` arity on rebased `838d2956` (re-verify cited line numbers).
- [ ] **Seed the bank from Federal Reserve 2 (`a546b7e9`), ALL pairs, split by kind** (data confirmed in `_research.md`). Seed script (Phase 3 CLI, `--seed-from-topic`) pulls: (a) article pairs = distinct `(entry_a,entry_b)` from `evolution_arena_comparisons WHERE prompt_id=a546b7e9`; (b) paragraph pairs = distinct pairs from `prompt_kind='paragraph'` comparisons whose `run_id ∈` FR2 runs. For each pair store `pair_kind`, both `variant_content` snapshots, the variants' `mu`/`sigma` (→ Elo gap = ground truth, large-gap only), and the recorded baseline confidence as a reference column. Skip the ~33 pairs whose variants were deleted. One pair-bank row with mixed kinds (filterable) OR two banks — implementation detail; `pair_kind` is the load-bearing tag either way.
- [ ] **Create the default Test Sets** off that bank: `fr2-smoke` (10 art + 10 para, stratified_confidence, seed 1) and `fr2-standard` (50 art + 50 para, stratified_confidence, seed 1) — materialize + freeze membership so all later runs compare on the same pairs.

### Phase 1: Schema + storage (idempotent migration + Zod + types)
- [ ] Migration `supabase/migrations/<next-ts>_judge_eval_tables.sql` (idempotent, deny_all + service_role_all RLS, mirrors `20260524000003`):
  - `judge_eval_pair_banks` — pairs JSONB array of `{label, pair_kind:'article'|'paragraph', variant_a_id, variant_b_id, text_a, text_b, mu_a, mu_b, sigma_a, sigma_b, expected_winner?, gap_kind, baseline_confidence}`; `source_topic_id`; name UNIQUE.
  - `judge_eval_test_sets` — the reusable frozen sample: id, pair_bank_id FK, name UNIQUE, description, `strategy TEXT CHECK ∈ ('random','stratified_confidence','stratified_gap','manual')`, seed BIGINT, size_article INT, size_paragraph INT, created_at.
  - `judge_eval_test_set_members` — frozen membership: `test_set_id UUID FK CASCADE`, `pair_label TEXT`, `pair_kind TEXT`, PRIMARY KEY(test_set_id, pair_label). Written once at create; never mutated.
  - `judge_eval_runs` — settings tuple + `test_set_id UUID FK` (the sample this run used) + `kind_filter TEXT CHECK ∈ ('article','paragraph','both')`; UNIQUE(settings_key, test_set_id) where `settings_key` includes judge_model/temp/reasoning/prompt_hash/kind_filter + **test_set_id** (so same settings on the same test set = idempotent upsert; same settings on a different test set = distinct row).
  - `judge_eval_calls` — one per (run × pair × repeat); **denormalized `pair_kind`** + `comparison_mode` (so the leaderboard slices by kind without joining the bank JSONB); `decisive GENERATED ALWAYS AS (confidence > 0.6) STORED`; UNIQUE(eval_run_id, pair_label, repeat_index).
  - VIEW `judge_eval_settings_leaderboard` — GROUP BY (**test_set_id**, run settings, **pair_kind**) so every settings row has an article line AND a paragraph line, scoped to a test set (cross-run comparability). Indexes: members(test_set_id), calls(eval_run_id), calls(eval_run_id, pair_kind, decisive).
- [ ] `npm run lint:migrations` (idempotency lint) + `npm run db:types` to regen `src/lib/database.types.ts`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (or a `judgeEval` schema module): `judgeEvalPairBankSchema` (incl. `pair_kind` enum), `judgeEvalTestSetSchema` (incl. `strategy` enum + per-kind sizes + seed), `judgeEvalRunSchema` (incl. `test_set_id` + `kind_filter`), `judgeEvalCallSchema` (incl. `pair_kind` + `comparison_mode`) — reuse the reasoning-effort enum (`schemas.ts:828-840`), `z.enum(['A','B','TIE'])` winners, `z.enum(['article','paragraph'])` kinds, confidence literal-union {0,0.3,0.5,0.7,1.0}.

### Phase 2: Eval engine (settings sweep over the pair-bank)
- [ ] `evolution/src/lib/judgeEval/testSet.ts` — `materializeTestSet(bank, {strategy, seed, size_article, size_paragraph})` selects pairs deterministically (seeded; strategies: random / stratified_confidence / stratified_gap / manual) and **freezes** membership into `judge_eval_test_set_members`. `loadTestSet(testSetId, kindFilter)` returns the frozen members (optionally filtered to a kind). Sweeps ALWAYS run against a test set — ad-hoc inline `--sample` auto-creates an auto-named test set so even one-off runs are reproducible. `--sample all` materializes a test set containing the whole bank.
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.ts` — for each `loadTestSet`-selected (pair × repeat) drive `run2PassReversal` DIRECTLY (bypass cache, like `rejudgeComparisonAction`) via a sandbox `callLLM` (plain `callLLM`, NOT `createEvolutionLLMClient`, so temperature is honored and nothing writes to ratings/metrics). **`comparisonMode` is derived from the pair's `pair_kind`** (article→'article', paragraph→'paragraph'); thread `{judgeModel, temperature, reasoningEffort, customPromptOverride}`. Capture per-pass `{prompt, rawResponse, parsedWinner}`; parse via `parseVerdictFromReasoning` when reasoning on, else `parseWinner`; aggregate via `aggregateWinners`. Per-call budget/kill catch; concurrency cap + retry; `call_source='judge_eval'`.
- [ ] `evolution/src/lib/judgeEval/metrics.ts` — pure reducer over a repeat array → {decisive_rate (conf>0.6), self_consistency, avg_confidence, position_bias_rate, accuracy_vs_truth (large-gap only), med_wall_ms, med_fwd_ms, avg_output_tokens, avg_reasoning_tokens, avg_cost_usd, cost_per_decisive, implied_beta (large-gap only)} — **computed per `pair_kind` as well as overall**, so article and paragraph decisiveness are reported separately. Formulas per `_research.md`.
- [ ] `evolution/src/lib/judgeEval/persist.ts` — upsert run by settings_key (incl. kind_filter + **test_set_id**) for idempotent re-run; bulk-insert calls with denormalized `pair_kind` + `comparison_mode`; compute `prompt_variant_hash = sha256(mode + (customPrompt ?? builtin-template))`.

### Phase 3: CLI driver (+ seed command)
- [ ] `evolution/scripts/judge-eval.ts` (`npx tsx`, dotenv + service-role client, mirrors `test-judge-models-v2.ts` + `debugProposerApproverFailures.ts` patterns).
  - `--seed-from-topic <prompt_id>` (default `a546b7e9` = Federal Reserve 2) — builds/refreshes the pair-bank by pulling ALL article + paragraph pairs (per the Phase 0 recipe), tagging `pair_kind`, snapshotting texts + mu/sigma + baseline confidence.
  - `--create-test-set <name> --from-bank <bank> --size-article N --size-paragraph M --strategy stratified_confidence --seed S` — materialize + freeze a reusable sample.
  - Sweep flags: **`--test-set <name>`** (run against a frozen set — the recommended path for comparable consecutive runs) OR ad-hoc `--pair-bank <name> --sample count:N|stratified:N|all` (auto-creates a named test set so it's still reproducible). Plus `--kind article|paragraph|both` (default both, intersect with the set), `--models <list>`, `--temperatures 0,0.3,0.7,1.0`, `--reasoning none,low`, `--prompt-variant <name|file>`, `--repeats 10`, `--dry-run` (pre-flight cost + max-calls/max-$ cap), `--output <json>`.
  - Concurrency cap + retry/backoff. Prints the historical summary table **with separate Article and Paragraph blocks**, notes the `test_set_id` used, + writes rows + optional JSON artifact.

### Phase 4: Judge Lab admin page
- [ ] `/admin/evolution/judge-lab` under the existing "Tools" sidebar group (added by #1168). Server actions in a new `evolution/src/services/judgeEvalActions.ts` (wrapped in `adminAction`): `listPairBanksAction`, `listTestSetsAction`, `createTestSetAction` (materialize + freeze), `createEvalRunAction` (launch a sweep against a `test_set_id`; guard cost), `getEvalLeaderboardAction({testSetId, kind})` (reads the VIEW, scoped to a test set + sliceable by kind), `getEvalRunDetailAction`. UI: **select a Test Set** (or create one: per-kind size + strategy + seed) + **Kind toggle (Article / Paragraph / Both)** + settings grid → launch (shows the call/cost estimate + cap). Leaderboard is **scoped to the chosen Test Set** so all rows are comparable, with an **Article | Paragraph | Both** segmented filter (each settings row shows article + paragraph decisiveness side by side); drill into a run's per-pair/per-repeat results; deep-link each stored comparison to the existing Match Viewer. A **Test Set manager** lists sets with their frozen size + strategy + seed. Dashboard "Tools" discoverability link.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/metrics.test.ts` — decisive_rate/agreement/position_bias/accuracy/implied_beta formulas against fixed `CallResult` arrays (parity with `finalization.ts:83-86` + recovered `beta-analysis.ts`); metrics split correctly by `pair_kind`.
- [ ] `evolution/src/lib/judgeEval/testSet.test.ts` — `materializeTestSet` is **deterministic for a fixed seed** (same members), honors per-kind sizes + strategy (stratified spread), and membership is **frozen** (re-seeding/extending the bank does not change an existing set's members). `loadTestSet(kind)` filters correctly.
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — settings threading via `createV2MockLlm` (seeded fwd/reverse responses); asserts temperature/reasoning/customPrompt reach the sandbox `callLLM`, cache is bypassed, and NO write to ratings/`evolution_arena_comparisons`/`evolution_metrics`.
- [ ] `evolution/src/services/judgeEvalActions.test.ts` — query shapes via `createSupabaseChainMock`; leaderboard ordering; cost-guard rejects oversized sweeps.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-judge-eval.integration.test.ts` (filename `evolution-` prefix for the evolution CI row) — real Supabase: seed a pair-bank, materialize a test set (assert frozen members persisted), run TWO eval_runs (different settings) against the SAME `test_set_id`, insert calls via persist layer, query `judge_eval_settings_leaderboard` scoped to that test set and assert both runs appear and are comparable (same pairs); verify retrieve-by-settings_key idempotency; `afterAll` cleanup (extend `cleanupEvolutionData` / direct deletes, FK CASCADE through test_set_members + calls).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts` (`{ tag: '@evolution' }`, `adminTest`). Seed a pair-bank + a completed eval_run; navigate to `/admin/evolution/judge-lab`, `resetFilters()`, assert leaderboard rows render and drill-down works. Re-judge/sweep LLM calls use `E2E_TEST_MODE` server-side stub (not browser-mockable); `safeGoto` for chained nav; stable `data-testid`s; no fixed sleeps.

### Manual Verification
- [ ] On local server: `judge-eval.ts --seed-from-topic a546b7e9` (Federal Reserve 2), confirm the bank lands ~6,972 article + ~1,889 paragraph pairs and the default `fr2-smoke`/`fr2-standard` test sets materialize with frozen members. Then `--dry-run` then a real sweep `--test-set fr2-smoke --models qwen-2.5-7b,gpt-4.1-nano --temperatures 0,1.0 --repeats 5`. Re-run a DIFFERENT settings sweep against the **same** `fr2-smoke` and confirm the leaderboard compares them on identical pairs. Confirm: article + paragraph decisive_rate reported separately; qwen ≫ nano; baseline-confidence reference present; rows persisted + kind-filterable; nothing written to `evolution_arena_comparisons`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts` against the local tmux server (via `npm run test:e2e`).

### B) Automated Tests
- [ ] `npm test -- judgeEval`, `npm run test:integration:evolution`, then `npm run lint && npm run typecheck && npm run build`, then the E2E spec. Migration: `npm run lint:migrations` + `npm run migration:verify`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/rating_and_comparison.md` — note the judge-eval tool reuses the comparison primitive; link historical methodology.
- [ ] `evolution/docs/data_model.md` — add the `judge_eval_*` tables (pair_banks, test_sets, test_set_members, runs, calls) + leaderboard VIEW; note test-set freezing + comparability contract.
- [ ] `evolution/docs/visualization.md` + `docs/feature_deep_dives/admin_panel.md` — document the Judge Lab page.
- [ ] `evolution/docs/reference.md` — new files (`runJudgeEval.ts`, `judge-eval.ts`, `judgeEvalActions.ts`), CLI flags, env/cost notes.
- [ ] `evolution/docs/metrics.md` — judge-eval metric definitions (decisive_rate parity, implied beta).
- [ ] `evolution/docs/arena.md` — note judge_eval_* are separate from `evolution_arena_comparisons` (which stays the in-run match log).
- [ ] `docs/research/judge_agreement_summary_tables.md` / `judging_accuracy_20260412.md` — cross-link the new repeatable tool.
- [ ] New deep dive (optional): `docs/feature_deep_dives/judge_evaluation.md`.

## Pair Selection (starting bank)

**Source = ALL recorded comparisons from the "Federal Reserve 2" arena topic** (`a546b7e9-f066-403d-9589-f5e0d2c9fa4f`), pulled directly from `evolution_arena_comparisons` and split by kind (live counts confirmed on staging 2026-06-06 — see `_research.md`):
- **Article: 6,972 distinct pairs** (texts present). Baseline judge avg conf 0.789; 4,156 decisive, 2,768 forced-tie (~40% — many genuinely close pairs).
- **Paragraph: 1,889 distinct pairs** (all texts present), from 273 slot-topics across 19 runs.

This replaces the original "2 hand-picked pairs from 140f7bce" plan with a realistic bank drawn from real arena history. Each pair stores `pair_kind`, both `variant_content` snapshots, mu/sigma (→ Elo-gap ground truth), `gap_kind` (large/close, derived from the mu gap), and the **recorded baseline confidence** (free reference: the production judge's own verdict on that pair).

**Ground truth (mu/Elo gap, per decision #3):** large-gap pairs get accuracy + implied-β; close pairs (`gap_kind='close'`) are tie-acceptable (decisiveness + position-bias only). Elo ground truth is judge-derived (mildly circular) so it's trusted only at the large gap.

**Storing all is cheap; sweeping all is not** (~8,861 pairs × grid × reps × 2 ≈ 1.4M calls). So the bank holds everything, and **sweeps select via `--kind` + `--sample`**: default `stratified:40` (40 pairs balanced across baseline-confidence buckets, separately per kind) keeps a default sweep affordable while covering both decisive and forced-tie regions. Run `--sample all` deliberately for a full bank pass.

**Article vs paragraph stay separable end-to-end** (decision #5): a pair's `pair_kind` auto-selects `comparison_mode` ('article' 5-criteria rubric vs 'paragraph' TIE-discouraging rubric), and every metric + leaderboard row is sliceable Article / Paragraph / Both.

## Test Sets (the reusable sample — how many pairs enter a round)

A **Test Set** is a named, **frozen** subset of a pair-bank that eval runs reference, so different settings are always compared on the *identical* pairs. This is the mechanism for "how many pairs enter a judging round" and for cross-run comparability without re-running the whole bank.

**Definition settings** (decide membership once, then freeze):
- `size_article`, `size_paragraph` — per-kind counts (independent; either can be 0).
- `strategy` — `random` | `stratified_confidence` (even spread across the recorded baseline-confidence buckets — mixes decisive + forced-tie) | `stratified_gap` (even across large/close `gap_kind`) | `manual` (hand-picked labels).
- `seed` — reproducible selection.
- **Membership is materialized** into a child table at create time and never changes (re-seeding the bank or adding pairs does NOT mutate existing test sets). A pair-bank "refresh" only adds new candidate pairs; test sets stay stable.

**Comparability contract:** `judge_eval_runs.test_set_id` is part of `settings_key`. Re-running the same settings on the same test set is idempotent (upsert); the same settings on a *different* test set is a distinct run. The leaderboard groups by `test_set_id`, so "run A vs run B" is always an apples-to-apples diff over the same pairs.

**Cost gate at launch (not at definition):** a sweep's calls = `cells × |test_set members ∩ kind_filter| × repeats × 2`. Launch shows the estimate, enforces a configurable max-calls / max-$ cap, and supports `--dry-run`. Defining a large test set is free; *running* one is what's gated.

**Default starter test sets** (created in Phase 0 seed): `fr2-smoke` (article 10 + paragraph 10, stratified_confidence, seed 1) for fast iteration, and `fr2-standard` (article 50 + paragraph 50, stratified_confidence, seed 1) for headline comparisons. Users create more via CLI/UI.

## Wireframes (ASCII)

> Four screens under the existing #1168 "Tools" sidebar group. Judge Lab is the batch/sweep + persisted-results + leaderboard surface; interactive single-match re-judge stays in the merged Match Viewer, which every stored comparison deep-links back to.

### Screen 1 — Judge Lab (`/admin/evolution/judge-lab`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Evolution                                                              abel ▾       │
├───────────────┬────────────────────────────────────────────────────────────────────┤
│ OVERVIEW      │  Judge Lab                                                          │
│  Dashboard    │  Systematically evaluate judge settings on a fixed pair-bank        │
│  Start Exp.   │ ┌── New sweep ────────────────────────────────────────────────────┐ │
│ ENTITIES      │ │ Test set [ fr2-standard · 50 art / 50 para · seed 1 ▾] [+ New…] │ │
│  Experiments  │ │          frozen subset of "Federal Reserve 2" — reused across runs│ │
│  Prompts      │ │ Kind   ( ○Article  ○Paragraph  •Both )                          │ │
│  Strategies   │ │ Models ☑ qwen-2.5-7b  ☑ gpt-4.1-nano  ☐ gpt-4.1-mini ☐ deepseek │ │
│  Tactics      │ │ Temps  ☑0  ☑0.3  ☑0.7  ☑1.0          Reasoning ☑none ☐low ☐med │ │
│  Criteria     │ │ Prompt ( •Baseline rubric  ○Custom override… )    Repeats [ 10 ] │ │
│  Runs         │ │ ───────────────────────────────────────────────────────────────│ │
│  Variants     │ │ Grid 2 models×4 temps = 8 cells · 50 art + 50 para frozen pairs  │ │
│  Invocations  │ │ Est. 8 × 100 pairs × 10 reps × 2 calls = 16 000 calls ≈ $2.40   │ │
│ RESULTS       │ │ ⓘ Article→Article rubric, paragraph→Paragraph rubric (auto).     │ │
│  Arena        │ │                                   [ Dry-run ]   [ ▶ Launch sweep ]│ │
│ TOOLS         │ └─────────────────────────────────────────────────────────────────┘ │
│  Match Viewer │  Leaderboard — test set fr2-standard   View ( •Both ○Art ○Para )     │
│ ▶ Judge Lab   │ ┌──────────────┬────┬─────┬───────────────┬───────────────┬───────┐ │
│               │ │ Model        │Temp│Reas.│ Article decis.│ Paragr. decis.│ $/dec │ │
│               │ ├──────────────┼────┼─────┼───────────────┼───────────────┼───────┤ │
│               │ │ qwen-2.5-7b  │ 0  │none │ 100%  conf1.00│  98%  conf0.97│.00027 │ │
│               │ │ deepseek-chat│ 0  │none │ 100%  conf1.00│  99%  conf0.99│.00189 │ │
│               │ │ gpt-4.1-nano │ 0  │none │  45%  conf0.72│  20%  conf0.58│.00060 │ │
│               │ │ gpt-4.1-nano │1.0 │none │   0%  conf0.50│  35%  conf0.66│  ∞/.. │ │
│               │ └──────────────┴────┴─────┴───────────────┴───────────────┴───────┘ │
│               │  Row click → eval-run detail.   42 settings · ‹Prev  1/3  Next›      │
└───────────────┴────────────────────────────────────────────────────────────────────┘
  • Decis. = decisive_rate (confidence > 0.6).  Article & Paragraph columns are independent.
  • View toggle collapses to a single decis./agree/conf/posbias/$ block for the chosen kind.
  • $/dec = cost per decisive comparison; "∞" = 0 decisive.  • Best decisive first; ties → cost.
```

### Screen 2 — Eval-run detail (`/admin/evolution/judge-lab/runs/[evalRunId]`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Judge Lab  ›  Eval run 5e9c…                                                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Settings  gpt-4.1-nano · temp 1.0 · reasoning none · baseline rubric (hash 3af1)   │
│ Test set  fr2-standard (50 art / 50 para · seed 1)   100 pairs · 10 reps           │
│ 2 000 calls · $0.31 · 2026-06-06 15:12                 View ( •Both ○Article ○Para )│
├───────────────────────────────────────────┬────────────────────────────────────────┤
│ ARTICLE  (50 pairs)                         │ PARAGRAPH  (50 pairs)                  │
│  decisive   34%      accuracy*  92%         │  decisive   41%     accuracy*  88%     │
│  agreement  71%      pos-bias   38%         │  agreement  77%     pos-bias   30%     │
│  avg conf   0.62     med wall   460 ms      │  avg conf   0.67    med wall  300 ms   │
│  base 79% dec   Δ vs base −45 pts ⚠         │  base 54% dec   Δ vs base −13 pts      │
├───────────────────────────────────────────┴────────────────────────────────────────┤
│ Pairs ( •Article  ○Paragraph )            sort: decisive ▾     ☐ show raw passes     │
│ ┌──────────┬──────┬─────┬────────┬──────┬──────┬──────────────────────────────────┐ │
│ │ Pair     │ gap  │ΔElo │ decis. │ conf │ base │                                  │ │
│ ├──────────┼──────┼─────┼────────┼──────┼──────┼──────────────────────────────────┤ │
│ │ art#0007 │large │ 404 │ 100%   │ 1.00 │ 1.00 │ ▸ per-repeat   ▸ Match Viewer    │ │
│ │ art#0021 │close │  22 │  20%   │ 0.58 │ 0.50 │ ▾ per-repeat   ▸ Match Viewer    │ │
│ │  # fwd reverse winner conf dec wall                                              │ │
│ │  1 A   A       A      1.00 ✓  470ms                                              │ │
│ │  2 B   B       TIE    0.50 ✗  510ms   ← both picked 2nd slot = position bias     │ │
│ │  3 A   B(=A)   A      1.00 ✓  480ms                                              │ │
│ │  …                                    winner hist  A▆ TIE▆▆ B▁   modal TIE       │ │
│ │ art#0034 │close │  15 │   0%   │ 0.50 │ 0.50 │ ▸ per-repeat   ▸ Match Viewer    │ │
│ └──────────┴──────┴─────┴────────┴──────┴──────┴──────────────────────────────────┘ │
│  ‹Prev  1/5  Next›                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
  • Aggregates are over the test set's pairs of that kind; View / Pairs toggles Article|Paragraph.
  • base = production judge's recorded confidence on the pair; Δ vs base flags regressions.
  • * accuracy/implied-β use large-gap pairs only (mu-gap ground truth); close = tie-acceptable.
  • "B(=A)" = the reverse pass un-reversed to the original frame (same text won).
  • Expand a pair for its per-repeat 2-pass detail; deep-link any comparison to Match Viewer.
```

### Screen 3 — Pair-bank manager (`/admin/evolution/judge-lab/pair-banks`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Judge Lab  ›  Pair-banks                              [ Seed from arena topic… ]    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Bank: Federal Reserve 2   source topic a546b7e9   8 861 pairs   seeded 06-06 15:40 │
│   Kind ( •Both  ○Article 6 972  ○Paragraph 1 889 )   Gap ( •All ○large ○close )     │
│ ┌──────────────┬──────┬───────────────────┬───────────────────┬──────┬─────┬──────┐│
│ │ Label        │ kind │ Variant A         │ Variant B         │ gap  │ ΔElo│ base ││
│ ├──────────────┼──────┼───────────────────┼───────────────────┼──────┼─────┼──────┤│
│ │ art#0001     │ art  │ 4d3ced31 (mu43.9) │ 2f25e2b0 (mu18.7) │large │ 404 │ 1.00 ││
│ │ art#0002     │ art  │ 9a1c… (mu31.2)    │ 71be… (mu29.8)    │close │  22 │ 0.50 ││
│ │ [para]V8a..P3│ para │ R2 slot (mu26.1)  │ R5 slot (mu24.9)  │close │  19 │ 0.50 ││
│ │ [para]V8a..P7│ para │ R1 slot (mu33.0)  │ orig    (mu18.4)  │large │ 233 │ 1.00 ││
│ │ …            │      │                   │                   │      │     │      ││
│ └──────────────┴──────┴───────────────────┴───────────────────┴──────┴─────┴──────┘│
│  ‹Prev  1/178  Next›   • base = production judge's recorded confidence on this pair. │
│  ┌─ Seed from arena topic ──────────────────────────────────────────────────────┐  │
│  │ Topic [ Federal Reserve 2 (a546b7e9) ▾ ]   ☑ articles   ☑ paragraphs          │  │
│  │ Pulls ALL distinct comparison pairs, snapshots texts + mu/sigma + baseline conf │  │
│  │ Skips pairs whose variants were deleted (~33).            [ Preview ] [ Seed ]  │  │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
  • One bank, mixed kinds, filterable.  expected_winner/accuracy only on large-gap; close=tie-ok.
  • Texts snapshotted on seed (reproducible if the source run is purged).
```

### Screen 4 — Test Sets (`/admin/evolution/judge-lab/test-sets`) + create dialog

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Judge Lab  ›  Test sets                                            [ + New test set]│
├──────────────────────────────────────────────────────────────────────────────────┤
│  Frozen subsets of a bank — runs against the same set are directly comparable.      │
│ ┌───────────────┬───────────────────┬──────┬──────┬──────────────────┬──────┬─────┐│
│ │ Name          │ Bank              │ Art. │ Para.│ Strategy         │ Seed │ Runs││
│ ├───────────────┼───────────────────┼──────┼──────┼──────────────────┼──────┼─────┤│
│ │ fr2-smoke     │ Federal Reserve 2 │  10  │  10  │ strat-confidence │  1   │  12 ││
│ │ fr2-standard  │ Federal Reserve 2 │  50  │  50  │ strat-confidence │  1   │  42 ││
│ │ fr2-close-art │ Federal Reserve 2 │  60  │   0  │ strat-gap (close)│  7   │   3 ││
│ └───────────────┴───────────────────┴──────┴──────┴──────────────────┴──────┴─────┘│
│   Row → leaderboard scoped to that test set (all settings tried on it, comparable). │
│  ┌─ New test set ───────────────────────────────────────────────────────────────┐ │
│  │ Name [ fr2-standard___ ]   Bank [ Federal Reserve 2 ▾ ]                        │ │
│  │ Size   Article [ 50 ]   Paragraph [ 50 ]      (how many pairs enter each round)│ │
│  │ Strategy ( •stratified by baseline confidence  ○stratified by gap  ○random )  │ │
│  │ Seed [ 1 ]   →  selects + FREEZES 100 pairs from 8 861; membership never changes│ │
│  │                                                       [ Preview ] [ Create ]   │ │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
  • "Size" is the answer to "how many enter a round."  Cost is gated at sweep-launch, not here.
  • Membership frozen at create → re-seeding/extending the bank never mutates an existing set.
```

## Review & Discussion
_(populated by /plan-review)_
