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
6. **Seed full bank, sample on sweep.** Storing ~8,861 pairs is cheap; a full-grid sweep (~1.4M calls) is not. Sweeps take a `--kind` filter + a `--sample` (count or stratified-by-baseline-confidence) so cost is bounded; the full bank stays queryable.

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

### Phase 1: Schema + storage (idempotent migration + Zod + types)
- [ ] Migration `supabase/migrations/<next-ts>_judge_eval_tables.sql` (idempotent, deny_all + service_role_all RLS, mirrors `20260524000003`):
  - `judge_eval_pair_banks` — pairs JSONB array of `{label, pair_kind:'article'|'paragraph', variant_a_id, variant_b_id, text_a, text_b, mu_a, mu_b, sigma_a, sigma_b, expected_winner?, gap_kind, baseline_confidence}`; `source_topic_id`; name UNIQUE.
  - `judge_eval_runs` — settings tuple + `kind_filter TEXT CHECK ∈ ('article','paragraph','both')`, `sample_spec JSONB` (how pairs were sampled); UNIQUE(settings_key, pair_bank_id) where settings_key includes kind_filter + sample_spec hash.
  - `judge_eval_calls` — one per (run × pair × repeat); **denormalized `pair_kind`** + `comparison_mode` (so the leaderboard slices by kind without joining the bank JSONB); `decisive GENERATED ALWAYS AS (confidence > 0.6) STORED`; UNIQUE(eval_run_id, pair_label, repeat_index).
  - VIEW `judge_eval_settings_leaderboard` — GROUP BY (run settings, **pair_kind**) so every settings row has an article line AND a paragraph line; the UI can show both or filter to one. Indexes: calls(eval_run_id), calls(eval_run_id, pair_kind, decisive).
- [ ] `npm run lint:migrations` (idempotency lint) + `npm run db:types` to regen `src/lib/database.types.ts`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (or a `judgeEval` schema module): `judgeEvalPairBankSchema` (incl. `pair_kind` enum), `judgeEvalRunSchema` (incl. `kind_filter`), `judgeEvalCallSchema` (incl. `pair_kind` + `comparison_mode`) — reuse the reasoning-effort enum (`schemas.ts:828-840`), `z.enum(['A','B','TIE'])` winners, `z.enum(['article','paragraph'])` kinds, confidence literal-union {0,0.3,0.5,0.7,1.0}.

### Phase 2: Eval engine (settings sweep over the pair-bank)
- [ ] `evolution/src/lib/judgeEval/selectPairs.ts` — given a bank + `kind_filter ('article'|'paragraph'|'both')` + `sample_spec`, return the working pair set. Sampling modes: `all`, `count:N` (random, seeded), `stratified:N` (balanced across baseline-confidence buckets so each sweep mixes decisive + forced-tie pairs). Deterministic via a seed so re-runs are reproducible.
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.ts` — for each selected (pair × repeat) drive `run2PassReversal` DIRECTLY (bypass cache, like `rejudgeComparisonAction`) via a sandbox `callLLM` (plain `callLLM`, NOT `createEvolutionLLMClient`, so temperature is honored and nothing writes to ratings/metrics). **`comparisonMode` is derived from the pair's `pair_kind`** (article→'article', paragraph→'paragraph'); thread `{judgeModel, temperature, reasoningEffort, customPromptOverride}`. Capture per-pass `{prompt, rawResponse, parsedWinner}`; parse via `parseVerdictFromReasoning` when reasoning on, else `parseWinner`; aggregate via `aggregateWinners`. Per-call budget/kill catch; concurrency cap + retry; `call_source='judge_eval'`.
- [ ] `evolution/src/lib/judgeEval/metrics.ts` — pure reducer over a repeat array → {decisive_rate (conf>0.6), self_consistency, avg_confidence, position_bias_rate, accuracy_vs_truth (large-gap only), med_wall_ms, med_fwd_ms, avg_output_tokens, avg_reasoning_tokens, avg_cost_usd, cost_per_decisive, implied_beta (large-gap only)} — **computed per `pair_kind` as well as overall**, so article and paragraph decisiveness are reported separately. Formulas per `_research.md`.
- [ ] `evolution/src/lib/judgeEval/persist.ts` — upsert run by settings_key (incl. kind_filter + sample_spec hash) for idempotent re-run; bulk-insert calls with denormalized `pair_kind` + `comparison_mode`; compute `prompt_variant_hash = sha256(mode + (customPrompt ?? builtin-template))`.

### Phase 3: CLI driver (+ seed command)
- [ ] `evolution/scripts/judge-eval.ts` (`npx tsx`, dotenv + service-role client, mirrors `test-judge-models-v2.ts` + `debugProposerApproverFailures.ts` patterns).
  - `--seed-from-topic <prompt_id>` (default `a546b7e9` = Federal Reserve 2) — builds/refreshes the pair-bank by pulling ALL article + paragraph pairs (per the Phase 0 recipe), tagging `pair_kind`, snapshotting texts + mu/sigma + baseline confidence.
  - Sweep flags: `--pair-bank <name>`, `--kind article|paragraph|both` (default both), `--sample all|count:N|stratified:N` (default `stratified:40` to bound cost), `--models <list>`, `--temperatures 0,0.3,0.7,1.0`, `--reasoning none,low`, `--prompt-variant <name|file>`, `--repeats 10`, `--dry-run` (pre-flight cost estimate, no spend), `--output <json>`.
  - Concurrency cap + retry/backoff. Prints the historical summary table **with separate Article and Paragraph blocks** + writes rows + optional JSON artifact.

### Phase 4: Judge Lab admin page
- [ ] `/admin/evolution/judge-lab` under the existing "Tools" sidebar group (added by #1168). Server actions in a new `evolution/src/services/judgeEvalActions.ts` (wrapped in `adminAction`): `listPairBanksAction`, `createEvalRunAction` (launch a sweep — reuse the engine; guard cost), `getEvalLeaderboardAction({kind})` (reads the VIEW, sliceable by kind), `getEvalRunDetailAction`. UI: pick pair-bank + **Kind toggle (Article / Paragraph / Both)** + **Sample selector** + settings grid → launch; decisive-rate leaderboard with an **Article | Paragraph | Both** segmented filter (each settings row shows its article + paragraph decisiveness side by side); drill into a run's per-pair/per-repeat results (also kind-filterable); deep-link each stored comparison to the existing Match Viewer. Dashboard "Tools" discoverability link.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/metrics.test.ts` — decisive_rate/agreement/position_bias/accuracy/implied_beta formulas against fixed `CallResult` arrays (parity with `finalization.ts:83-86` + recovered `beta-analysis.ts`).
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — settings threading via `createV2MockLlm` (seeded fwd/reverse responses); asserts temperature/reasoning/customPrompt reach the sandbox `callLLM`, cache is bypassed, and NO write to ratings/`evolution_arena_comparisons`/`evolution_metrics`.
- [ ] `evolution/src/services/judgeEvalActions.test.ts` — query shapes via `createSupabaseChainMock`; leaderboard ordering; cost-guard rejects oversized sweeps.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-judge-eval.integration.test.ts` (filename `evolution-` prefix for the evolution CI row) — real Supabase: seed a pair-bank + eval_run, insert calls via persist layer, query `judge_eval_settings_leaderboard` and retrieve-by-settings_key; `afterAll` cleanup (extend `cleanupEvolutionData` / direct deletes, FK CASCADE).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts` (`{ tag: '@evolution' }`, `adminTest`). Seed a pair-bank + a completed eval_run; navigate to `/admin/evolution/judge-lab`, `resetFilters()`, assert leaderboard rows render and drill-down works. Re-judge/sweep LLM calls use `E2E_TEST_MODE` server-side stub (not browser-mockable); `safeGoto` for chained nav; stable `data-testid`s; no fixed sleeps.

### Manual Verification
- [ ] On local server: `judge-eval.ts --seed-from-topic a546b7e9` (Federal Reserve 2), confirm the bank lands ~6,972 article + ~1,889 paragraph pairs. Then `--dry-run` a sweep, then a small real sweep (`--kind both --sample stratified:10 --models qwen-2.5-7b,gpt-4.1-nano --temperatures 0,1.0 --repeats 5`). Confirm: article and paragraph decisive_rate reported separately; qwen ≫ nano on close pairs; recorded baseline-confidence reference column present; rows persisted + leaderboard kind-filterable; nothing written to `evolution_arena_comparisons`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts` against the local tmux server (via `npm run test:e2e`).

### B) Automated Tests
- [ ] `npm test -- judgeEval`, `npm run test:integration:evolution`, then `npm run lint && npm run typecheck && npm run build`, then the E2E spec. Migration: `npm run lint:migrations` + `npm run migration:verify`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/rating_and_comparison.md` — note the judge-eval tool reuses the comparison primitive; link historical methodology.
- [ ] `evolution/docs/data_model.md` — add the three `judge_eval_*` tables + leaderboard VIEW.
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

## Wireframes (ASCII)

> Three screens under the existing #1168 "Tools" sidebar group. Judge Lab is the batch/sweep + persisted-results + leaderboard surface; interactive single-match re-judge stays in the merged Match Viewer, which every stored comparison deep-links back to.

### Screen 1 — Judge Lab (`/admin/evolution/judge-lab`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Evolution                                                              abel ▾       │
├───────────────┬────────────────────────────────────────────────────────────────────┤
│ OVERVIEW      │  Judge Lab                                                          │
│  Dashboard    │  Systematically evaluate judge settings on a fixed pair-bank        │
│  Start Exp.   │ ┌── New sweep ────────────────────────────────────────────────────┐ │
│ ENTITIES      │ │ Pair-bank [ Federal Reserve 2 · 6 972 art / 1 889 para ▾][Manage]│ │
│  Experiments  │ │ Kind   ( ○Article  ○Paragraph  •Both )   Sample [ stratified 40▾]│ │
│  Prompts      │ │ Models ☑ qwen-2.5-7b  ☑ gpt-4.1-nano  ☐ gpt-4.1-mini ☐ deepseek │ │
│  Strategies   │ │ Temps  ☑0  ☑0.3  ☑0.7  ☑1.0          Reasoning ☑none ☐low ☐med │ │
│  Tactics      │ │ Prompt ( •Baseline rubric  ○Custom override… )    Repeats [ 10 ] │ │
│  Criteria     │ │ ───────────────────────────────────────────────────────────────│ │
│  Runs         │ │ Grid 2 models×4 temps = 8 cells · 40 art + 40 para pairs sampled │ │
│  Variants     │ │ Est. 8 × 80 pairs × 10 reps × 2 calls = 12 800 calls ≈ $1.90    │ │
│  Invocations  │ │ ⓘ Article pairs judged with the Article rubric, paragraph with   │ │
│ RESULTS       │ │   the Paragraph (TIE-discouraging) rubric — auto by pair kind.   │ │
│  Arena        │ │                                   [ Dry-run ]   [ ▶ Launch sweep ]│ │
│ TOOLS         │ └─────────────────────────────────────────────────────────────────┘ │
│  Match Viewer │  Settings leaderboard      View ( •Both  ○Article  ○Paragraph )      │
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
│ Judge Lab  ›  run 5e9c…  ·  gpt-4.1-nano · temp 1.0 · none · article               │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Settings  model gpt-4.1-nano   temp 1.0   reasoning none   prompt article (hash 3af1)│
│ Pair-bank 140f7bce (3 pairs)   repeats 10   480 calls   $0.058   2026-06-06 15:12   │
├───────────────────────────────────────────┬────────────────────────────────────────┤
│ PAIR  A-vs-B  (large gap, Δ404 Elo)        │ PAIR  C-vs-D  (close, Δ1.4 Elo)        │
│  decisive   60%      accuracy   100%       │  decisive    0%     accuracy   n/a (tie)│
│  agreement  80%      implied β  43.7 (10×) │  agreement 100%     implied β  n/a      │
│  avg conf   0.80     pos-bias    40%       │  avg conf  0.50     pos-bias  100%      │
│  med wall   510 ms   ⚠ over-confident      │  med wall  420 ms   ⚠ pure position bias│
├───────────────────────────────────────────┴────────────────────────────────────────┤
│ Per-repeat (A-vs-B)                                            ☐ show raw passes     │
│ ┌────┬─────────┬─────────┬────────┬─────┬─────┬──────┬───────┬──────────────────────┐│
│ │ #  │ fwd     │ reverse │ winner │ conf│ dec │ wall │ oTok  │                      ││
│ ├────┼─────────┼─────────┼────────┼─────┼─────┼──────┼───────┼──────────────────────┤│
│ │ 1  │ A       │ A       │  A     │1.00 │ ✓   │ 480ms│  3    │ ▸ open in Match Viewer││
│ │ 2  │ A       │ B (=A)  │  A     │1.00 │ ✓   │ 502ms│  3    │ ▸ open in Match Viewer││
│ │ 3  │ B       │ B       │  TIE   │0.50 │ ✗   │ 530ms│  4    │ ▸ open in Match Viewer││
│ │ 4  │ A       │ TIE     │  A     │0.70 │ ✓   │ 470ms│  5    │ ▸ open in Match Viewer││
│ │ …  │         │         │        │     │     │      │       │                      ││
│ └────┴─────────┴─────────┴────────┴─────┴─────┴──────┴───────┴──────────────────────┘│
│  Winner histogram  A ███████░░ 7   TIE ██░ 2   B █ 1        (modal: A, 70%)          │
│  Expanding a row reveals forward/reverse prompt + raw response (read-only, escaped). │
└──────────────────────────────────────────────────────────────────────────────────┘
  • "B (=A)" annotates the reverse pass un-reversed to the original frame (same text won).
  • accuracy/implied-β shown only for ground-truth (large-gap) pairs; close pair = tie-acceptable.
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

## Review & Discussion
_(populated by /plan-review)_
