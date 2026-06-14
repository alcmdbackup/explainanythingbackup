# Analyze Performance of Custom-Prompt Judge (Explain Reasoning) in Judge Lab — Plan

## Background
Help investigate if it is conclusive and not a bug that a custom prompt asking the judge to
explain reasoning conclusively hurts performance across models in Judge Lab for evolution.
Judge Lab measures judge **decisive rate** (`confidence > 0.6`) and related metrics across judge
settings (model × temperature × reasoning × prompt variant). Enabling the "Explain reasoning"
toggle or a custom rubric prompt appears to depress measured performance across models, and we
need a conclusive answer on whether that is a genuine model effect or an artifact/bug.

## Requirements (from GH Issue #1198)
- Investigate whether "custom prompt asking judge to explain reasoning conclusively hurts
  performance across models in judge lab for evolution" is a **real, conclusive effect** vs a **bug**.
- Deliverable: **Report + fix if a bug is found.** Investigate first; if it's a parsing/format bug
  (e.g. `parseVerdictFromReasoning` misparse, dropped reasoning trace, error masking), fix and
  re-measure. Produce a conclusive findings report either way.
- Evidence sources: **Both** — mine existing persisted `judge_eval_runs`/`judge_eval_calls` data
  first, then run targeted new controlled sweeps (explainReasoning on/off × custom-prompt on/off
  across several models, fixed temperature) to confirm.

## Problem
A drop in Judge Lab decisive rate under "explain reasoning" / custom prompt is **mechanistically
ambiguous**: `runJudgeEval.ts` switches the verdict parser to `parseVerdictFromReasoning` whenever
`explainReasoning || customPrompt`, so the drop could reflect either (a) a genuine increase in
cross-pass disagreement/TIEs when the model reasons, or (b) a parse-failure artifact where correct
verdicts are returned but not extracted (confidence collapses to 0.3, like the documented Qwen3
`"Your answer: B"` → `parseWinner` null precedent). The audit columns added in migration
`20260610000001` (`forward_raw`/`reverse_raw`, `*_reasoning`, `reasoning_trace_format`, ground-truth
snapshot) let us re-parse stored outputs offline and disentangle correctness from parse success
without new LLM spend. We must hold model/temperature/reasoning-effort fixed across arms to make any
"across models" claim valid.

## Options Considered
- [ ] **Option A: Offline re-parse of existing audit data (forensic)**: Query `judge_eval_calls`,
  re-run multiple parsers over stored `forward_raw`/`reverse_raw`, recompute decisive rate per arm.
  Pros: zero LLM spend, fast, directly separates bug-vs-real. Cons: limited to settings already swept;
  may lack clean on/off pairs at fixed model+temp.
- [ ] **Option B: New controlled sweeps only (experimental)**: Build a frozen test set and run
  explainReasoning on/off × custom-prompt on/off across several models at fixed temp. Pros: clean A/B,
  current code. Cons: LLM spend (capped by `JUDGE_EVAL_MAX_USD=5`), slower, doesn't explain history.
- [ ] **Option C: Both (forensic-then-confirm) — CHOSEN**: Mine + re-parse existing data to localize
  the effect and form a hypothesis, then run small targeted sweeps to confirm and to fill gaps in the
  on/off matrix. Matches the user's "Both" data choice and "report + fix if bug" scope.

## Phased Execution Plan

### Phase 1: Reproduce & Localize (existing data) — record as durable artifacts
> Research established the parser-selection lever (`runJudgeEval.ts:101-103`) and the confidence
> ladder (`computeRatings.ts:534-555`). Agents reported (UNVERIFIED) a decisive drop ~51.5%→38.7%
> driven by a `confidence=0.5`/position-bias shift with flat parse-fail — **re-run and record** these.
- [ ] Recover parser identity per call (NOT persisted): infer reasoning mode via
  `forward_prompt ILIKE '%First, briefly explain your reasoning%'` (`computeRatings.ts:427`) and/or
  `prompt_variant IS NOT NULL`. Save the exact recovery predicate used.
- [ ] Run + **save outputs** for these read-only queries (`npm run query:staging -- "<SQL>"`):
  - (1a) decisive_rate grouped by `has_custom` × `reasoning_sig`;
  - (1b) confidence histogram by mode (look for `0.3/0.0` collapse = artifact vs `0.5` shift = real);
  - (1c) same-slot position-bias rate by mode (`forward_winner = reverse_winner`, both ∈ {A,B});
  - (1d) per-`judge_model` × `gap_kind` decisive delta; (1e) large-gap accuracy
    (`gap_kind='large' AND confidence>0.6 → winner=expected_winner`). All with `error IS NULL`.
- [ ] **Re-verify the actual `judge_eval_runs.judge_model` IDs** (agent-reported names like
  "DeepSeek-V4-Pro/Flash" are suspect) and confirm baseline vs custom arms share `test_set_id`,
  temperature, and near-simultaneous `created_at`.
- [ ] Write the per-arm / per-model tables into `_progress.md` Phase 1. **Decision rule:** rising
  `0.3/0.0` bucket → artifact; rising `0.5` + same-slot with flat `0.3` → real; accuracy_large drop
  >5–10 ppts → quality regression, else benign decisiveness/caution trade-off.

### Phase 2: Bug-vs-Real Discrimination (offline re-parse) — the definitive, zero-LLM-cost test
- [ ] Write throwaway read-only script `evolution/scripts/analyze-reasoning-parse.ts` (`--dry-run`
  default). Per call: (1) recover parser (Phase-1 predicate); (2) `f' = parser(forward_raw)`,
  `r' = parser(reverse_raw)` importing the real `parseWinner`/`parseVerdictFromReasoning` from
  `computeRatings.ts`; (3) compare `f'`/`r'` to stored `forward_winner`/`reverse_winner` and recompute
  `confidence' = aggregateWinners(f', r').confidence`; `delta = confidence' - stored_confidence`.
- [ ] Add a **hardened-parser candidate** arm (widen `VERDICT_MARKER_RE` to also match
  `response|decision|answer`) and recompute; report how many calls it rescues.
- [ ] Roll up per run/arm: `parse_match_rate`, null-rate by mode, `decisive_rate_delta`, plus 5–10
  verbatim `forward_raw` samples of any mismatch. **Decision rule:** match ≥99% & hardened rescues
  <2% → **REAL** (parsers sound); match <95% or hardened lifts decisive materially → **ARTIFACT**;
  95–99% → borderline, ship hardened parser anyway.
- [ ] **Pin code-version drift:** `git log` `computeRatings.ts` since the analyzed runs' dates; if
  either parser changed, re-parse against the run-time commit.
- [ ] Check confounders: `reasoning_trace_format` distribution (provider dropped trace?), per-arm
  `error` rate, temperature/reasoning-effort parity.

### Phase 3: Confirm with Controlled Sweeps (new data) — causal A/B under the $5 cap
- [ ] Create a frozen, stratified test set (large+close gaps), reproducible seed:
  `npx tsx evolution/scripts/judge-eval.ts create-test-set --bank "Federal Reserve 2"
  --name fr2-phase3-controlled --size-article 15 --size-paragraph 15 --strategy stratified_gap --seed 42`.
- [ ] **Budget: ≤ $1 total (user-capped).** Export `JUDGE_EVAL_MAX_USD=1` as a hard guard; `--dry-run`
  EVERY sweep first and scale `--repeats`/test-set size down until BOTH arms together estimate ≤ $1
  (each arm ≤ ~$0.50). Verify model availability first (`getDeployableEvolutionModelIds()`); then run
  two arms differing ONLY by `--explain-reasoning`, fixed `--temperatures 0.0`, `--kind both`:
  `JUDGE_EVAL_MAX_USD=1 npx tsx evolution/scripts/judge-eval.ts sweep --test-set <set> --models <3–4 cheap models incl. gpt-4.1-mini,qwen-2.5-7b-instruct> --temperatures 0.0 --repeats <tuned> --kind both [--explain-reasoning] --dry-run`.
  Starting point to tune from: ~4 models × ~10 pairs × ~3 repeats × 2 passes ≈ 240 calls/arm,
  ~480 total (~$1). **Record the exact baseline/reasoning `eval_run_id`s** (since `explainReasoning`
  is not persisted).
- [ ] Re-apply the Phase 2 re-parse to the fresh `forward_raw`/`reverse_raw` to confirm the
  bug-vs-real verdict on current code.

### Phase 4: Fix + Re-measure
- [ ] **Audit-persistence fix (do REGARDLESS — this is a real defect research confirmed):** add
  `explain_reasoning_requested BOOLEAN` to `judge_eval_runs` via an idempotent migration; write it in
  `persist.ts` (run upsert); surface it in `judge_eval_settings_leaderboard` VIEW + the Judge Lab
  leaderboard "Prompt"/"Custom" column so a low decisive rate is no longer ambiguous about which
  parser ran. (Migration must follow the idempotency lint — `ADD COLUMN IF NOT EXISTS`.)
- [ ] **Parser hardening (ONLY if Phase 2 shows <99% match):** widen `VERDICT_MARKER_RE` prefixes to
  `response|decision|answer` and/or add a `parseWinner`-style no-marker fallback; gate on the re-parse
  evidence to avoid false positives. Add unit-test fixtures from the real failing `forward_raw` strings.
- [ ] **Close the test gap:** add `runJudgeEval`/parser coverage for `customPromptOverride`-without-
  `explainReasoning` (currently only explainReasoning=true is tested, `runJudgeEval.test.ts:143-159`)
  and for non-standard verdict formats (`Response: A`, bare `A` after prose).
- [ ] If error-masking / trace-handling / retry is implicated: apply the minimal fix; verify
  errored-cell accounting (`error IS NULL` VIEW filter) is correct.
- [ ] **Do NOT "fix" the 0.5/position-bias mechanism if Phase 1/2 confirm a real effect** — that is
  correct metric behavior. Instead surface `positionBiasRate` + large-gap accuracy next to decisive
  rate so the trade-off is visible. Re-run Phase 3 (or re-parse) to quantify any recovered performance.

### Phase 5: Report
- [ ] Write the conclusive findings into `_progress.md` + a summary section: is the "hurts
  performance" claim real, a bug, or partly both; per-model breakdown; the mechanism; and (if fixed)
  before/after numbers. Update `docs/feature_deep_dives/judge_evaluation.md` if behavior/guidance changes.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/comparison.test.ts` (or colocated parser test) — if `parseVerdictFromReasoning`
  is changed: add cases for each real failing raw-output format captured in Phase 2/3 (assert correct
  A/B/TIE extraction; assert no regression on existing `parseWinner` fixtures).
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — if the parser-selection branch or confidence
  computation changes: assert explainReasoning/customPrompt routes to the hardened parser and produces
  the expected confidence on representative outputs.

### Integration Tests
- [ ] `src/__tests__/integration/judge-eval-test-sets.integration.test.ts` (existing) — extend to
  cover the new `explain_reasoning_requested` column round-trip (write via `persist.ts`, read back),
  since the Phase-4 audit fix touches persistence.

### E2E Tests
- [ ] If the Judge Lab leaderboard surfaces the new explain-reasoning column / label, update
  `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts`. Otherwise no new E2E
  (analysis + parser hardening are non-UI).

### Migration verification
- [ ] If the audit migration is added: `npm run lint:migrations` (idempotency) + `npm run migration:verify`
  (ephemeral Docker postgres) per the repo migration gates.

### Manual Verification
- [ ] Run the analysis script (`--dry-run`) against staging; confirm per-arm decisive-rate tables match
  the SQL aggregates.
- [ ] If fixed: launch a Judge Lab sweep from `/admin/evolution/judge-lab` with explain-reasoning ON +
  custom prompt and confirm the leaderboard decisive rate reflects the corrected parsing.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Only if UI changes: `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts`
  against the local server (via ensure-server.sh). Otherwise N/A (analysis/parser-only change).

### B) Automated Tests
- [ ] `npm run test -- evolution/src/lib/comparison.test.ts` (and `runJudgeEval.test.ts`) if parser changed.
- [ ] `npm run lint && npm run typecheck && npm run build` for any code/script changes.
- [ ] `npm run test:integration -- judge-eval` if persistence/error accounting touched.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — update parser/metrics behavior + add a
  findings note if the reasoning/custom-prompt decisive-rate effect is real or was a fixed bug.
- [ ] `evolution/docs/rating_and_comparison.md` — update the `parseWinner`/`parseVerdictFromReasoning`
  + 2-pass confidence sections if parsing behavior changes.
- [ ] `evolution/docs/arena.md`, `evolution/docs/metrics.md`, `evolution/docs/data_model.md`,
  `evolution/docs/strategies_and_experiments.md`, `evolution/docs/criteria_agents.md` — likely
  reference-only; touch only if findings change documented guidance.
- [ ] Add the investigation's conclusive tables to `docs/research/` (alongside
  `judging_accuracy_20260412.md` / `judge_agreement_summary_tables.md`) for durability.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
