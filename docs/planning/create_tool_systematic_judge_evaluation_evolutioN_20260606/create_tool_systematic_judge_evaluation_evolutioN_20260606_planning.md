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

## Review & Discussion
_(populated by /plan-review)_
