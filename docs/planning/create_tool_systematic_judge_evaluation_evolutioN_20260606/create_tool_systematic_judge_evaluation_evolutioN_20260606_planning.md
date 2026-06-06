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
- [ ] Define the seed pair-bank from run `140f7bce` — A `4d3ced31` / B `2f25e2b0` / C `39d3275f`; **fix the D==B UUID labeling**; gap_kind ∈ {large, close}; expected_winner only for large-gap. Confirm the 3 texts are still fetchable (`npm run query:staging`/`query:prod`); snapshot text into the bank so it's reproducible if the run is purged.

### Phase 1: Schema + storage (idempotent migration + Zod + types)
- [ ] Migration `supabase/migrations/<next-ts>_judge_eval_tables.sql` (idempotent, deny_all + service_role_all RLS, mirrors `20260524000003`): `judge_eval_pair_banks`, `judge_eval_runs` (UNIQUE(settings_key, pair_bank_id)), `judge_eval_calls` (UNIQUE(eval_run_id,pair_label,repeat_index), `decisive GENERATED ALWAYS AS (confidence > 0.6) STORED`), + VIEW `judge_eval_settings_leaderboard`. Indexes: calls(eval_run_id), calls(eval_run_id, decisive).
- [ ] `npm run lint:migrations` (idempotency lint) + `npm run db:types` to regen `src/lib/database.types.ts`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (or a `judgeEval` schema module): `judgeEvalPairBankSchema`, `judgeEvalRunSchema`, `judgeEvalCallSchema` — reuse the reasoning-effort enum (`schemas.ts:828-840`), `z.enum(['A','B','TIE'])` winners, confidence literal-union {0,0.3,0.5,0.7,1.0}.

### Phase 2: Eval engine (settings sweep over the pair-bank)
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.ts` — for each (pair × repeat) drive `run2PassReversal` DIRECTLY (bypass cache, like `rejudgeComparisonAction`) via a sandbox `callLLM` (plain `callLLM`, NOT `createEvolutionLLMClient`, so temperature is honored and nothing writes to ratings/metrics). Thread `{judgeModel, temperature, reasoningEffort, comparisonMode, customPromptOverride}`. Capture per-pass `{prompt, rawResponse, parsedWinner}`; parse via `parseVerdictFromReasoning` when reasoning on, else `parseWinner`; aggregate via `aggregateWinners`. Per-call budget/kill catch; `call_source='judge_eval'`.
- [ ] `evolution/src/lib/judgeEval/metrics.ts` — pure reducer over a repeat array → {decisive_rate (conf>0.6), self_consistency, avg_confidence, position_bias_rate, accuracy_vs_truth (large-gap only), med_wall_ms, med_fwd_ms, avg_output_tokens, avg_reasoning_tokens, avg_cost_usd, cost_per_decisive, implied_beta (large-gap only)}. Formulas per `_research.md`.
- [ ] `evolution/src/lib/judgeEval/persist.ts` — upsert run by settings_key (idempotent re-run), bulk-insert calls; compute `prompt_variant_hash = sha256(mode + (customPrompt ?? builtin-template))`.

### Phase 3: CLI driver
- [ ] `evolution/scripts/judge-eval.ts` (`npx tsx`, dotenv + service-role client, mirrors `test-judge-models-v2.ts` + `debugProposerApproverFailures.ts` patterns). Flags: `--pair-bank <name>`, `--models <list>`, `--temperatures 0,0.3,0.7,1.0`, `--reasoning none,low`, `--prompt-variant <name|file>`, `--repeats 10`, `--dry-run` (pre-flight cost estimate, no spend), `--output <json>`. Concurrency cap + retry/backoff. Prints the historical summary table layout + writes rows + optional JSON artifact.

### Phase 4: Judge Lab admin page
- [ ] `/admin/evolution/judge-lab` under the existing "Tools" sidebar group (added by #1168). Server actions in a new `evolution/src/services/judgeEvalActions.ts` (wrapped in `adminAction`): `listPairBanksAction`, `createEvalRunAction` (launch a sweep — reuse the engine; guard cost), `getEvalLeaderboardAction` (reads the VIEW), `getEvalRunDetailAction`. UI: pick pair-bank + settings grid → launch; decisive-rate leaderboard table (best settings first) with CI-free point estimates; drill into a run's per-pair/per-repeat results; deep-link each stored comparison to the existing Match Viewer. Dashboard "Tools" discoverability link.

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
- [ ] On local server: seed the 140f7bce pair-bank, run `judge-eval.ts --dry-run` then a small real sweep ({qwen-2.5-7b, gpt-4.1-nano} × {0,1.0} × 5 reps), confirm decisive_rate reproduces the historical pattern (qwen 100% / nano ~0% on close pair), confirm rows persisted + leaderboard ranks qwen first, confirm nothing written to `evolution_arena_comparisons`.

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

Pairs are chosen along one axis — **Elo-gap size** — to bracket judge difficulty, not sampled randomly:
- **Large-gap pair (~400 Elo / 25 mu):** clear winner; sanity floor; the only tier with usable ground truth (accuracy + implied-β computed here).
- **Close pair (~1–2 Elo):** the discriminating test — weak judges collapse to position-bias TIEs here (nano 0% decisive vs qwen/mini/deepseek 100%). No real ground truth → `gap_kind='close'`, **tie-acceptable** (measure decisiveness + position-bias, not accuracy).

**Sourcing:** pull from a *completed* run (pipeline has already assigned Elo/mu — the noisy ground-truth proxy) via `npm run query:staging -- "...ORDER BY mu DESC"`; pick top-vs-mid for the large gap and two adjacent near-equal variants for the close pair. **Snapshot texts into the bank** for reproducibility if the run is purged.

**Start with run `140f7bce`** for parity with the historical tables — first numbers are directly comparable to `judge_agreement_summary_tables.md`; the harness is validated when it reproduces qwen 100% / nano 0% on the close pair. Fix the historical **D==B UUID labeling bug** while seeding. Keep the starting bank small (2 anchor pairs, 3 distinct texts) to control cost, then optionally add a **medium-gap (~80 Elo)** tier + a **known-tie** pair the historical bank lacked.

**Caveat:** Elo ground truth is itself judge-derived (mildly circular) — robust for the large gap, which is why accuracy/implied-β are restricted to large/medium tiers.

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
│ ENTITIES      │ │ Pair-bank [ 140f7bce · Federal Reserve (3 pairs) ▾ ]   [ Manage ]│ │
│  Experiments  │ │ Models    ☑ qwen-2.5-7b  ☑ gpt-4.1-nano  ☐ gpt-4.1-mini         │ │
│  Prompts      │ │           ☐ deepseek-chat  ☐ gpt-oss-20b  ☐ qwen3-8b            │ │
│  Strategies   │ │ Temps     ☑0  ☑0.3  ☑0.7  ☑1.0     Reasoning ☑none ☐low ☐med   │ │
│  Tactics      │ │ Prompt    ( •Article  ○Paragraph  ○Custom… )      Repeats [ 10 ] │ │
│  Criteria     │ │ ───────────────────────────────────────────────────────────────│ │
│  Runs         │ │ Grid: 2 models × 4 temps × 1 reasoning × 1 prompt = 8 cells      │ │
│  Variants     │ │ Est. 8 cells × 3 pairs × 10 reps × 2 calls = 480 calls ≈ $0.18  │ │
│  Invocations  │ │                                   [ Dry-run ]   [ ▶ Launch sweep ]│ │
│ RESULTS       │ └─────────────────────────────────────────────────────────────────┘ │
│  Arena        │  Settings leaderboard          sort: Decisive ▾   ☑ Hide test banks │
│ TOOLS         │ ┌──────────────┬────┬─────┬───────┬──────┬─────┬──────┬──────┬──────┐│
│  Match Viewer │ │ Model        │Temp│Reas.│Prompt │Decis.│Agree│AvgCnf│PosBi.│$/dec ││
│ ▶ Judge Lab   │ ├──────────────┼────┼─────┼───────┼──────┼─────┼──────┼──────┼──────┤│
│               │ │ qwen-2.5-7b  │ 0  │none │article│100%  │100% │ 1.00 │  0%  │.00027││
│               │ │ deepseek-chat│ 0  │none │article│100%  │100% │ 1.00 │  0%  │.00189││
│               │ │ gpt-4.1-mini │ 0  │none │article│100%  │100% │ 1.00 │  0%  │.00272││
│               │ │ gpt-4.1-nano │ 0  │none │article│ 45%  │ 60% │ 0.72 │ 50%  │.00060││
│               │ │ gpt-4.1-nano │1.0 │none │article│  0%  │100% │ 0.50 │100%  │  ∞   ││
│               │ └──────────────┴────┴─────┴───────┴──────┴─────┴──────┴──────┴──────┘│
│               │  Row click → eval-run detail.   42 settings · ‹Prev  1/3  Next›      │
└───────────────┴────────────────────────────────────────────────────────────────────┘
  • Decis. = decisive_rate (confidence > 0.6, live-metric parity).  PosBi. = position-bias rate.
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
│ Judge Lab  ›  Pair-banks                                            [ + New bank ]  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Bank: 140f7bce · Federal Reserve            source run 140f7bce   3 pairs          │
│ ┌──────────┬───────────────────┬───────────────────┬──────────┬─────────┬─────────┐│
│ │ Label    │ Variant A         │ Variant B         │ gap_kind │ Δ Elo   │ truth   ││
│ ├──────────┼───────────────────┼───────────────────┼──────────┼─────────┼─────────┤│
│ │ large    │ 4d3ced31 (mu43.9) │ 2f25e2b0 (mu18.7) │ large    │  404    │ A wins  ││
│ │ close    │ 39d3275f (mu18.75)│ 2f25e2b0 (mu18.66)│ close    │  1.4    │ tie-ok  ││
│ │ medium † │ —  (add via query)│ —                 │ medium   │  ~80    │ A wins  ││
│ └──────────┴───────────────────┴───────────────────┴──────────┴─────────┴─────────┘│
│  † optional medium-gap tier the historical bank lacked.                              │
│  ┌─ Add pair ──────────────────────────────────────────────────────────────────┐   │
│  │ Source [ query staging ORDER BY mu DESC ▾ ]   Variant A [____]  B [____]      │   │
│  │ Texts are snapshotted into the bank on save (reproducible if the run is purged)│   │
│  │                                                          [ Preview ] [ Save ]  │   │
│  └────────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
  • expected_winner stored only for large/medium (mu-gap ground truth); close = tie-acceptable.
```

## Review & Discussion
_(populated by /plan-review)_
