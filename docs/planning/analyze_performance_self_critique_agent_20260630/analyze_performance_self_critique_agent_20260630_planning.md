# Analyze Performance Self Critique Agent Plan

## Background
Run an experiment to analyze and understand performance of self critique driven agent.

Context (auto-captured): the `SelfCritiqueReviseAgent` (marker tactic `self_critique_driven`, agent type `self_critique_revise`) was just landed by the sibling project `brainstorm_new_agents_with_reflection_20260630`. It is a wrapper agent — one reflection LLM call producing free-form `ChangeKind + Summary + Plan`, then GFPA delegation with the plan as a nonce-fenced customPrompt. Expected cost stack ~$0.005/variant (~1× GFPA + ~15% reflection premium). This project runs a controlled experiment on the evolution pipeline to measure whether that premium buys real Elo gains vs a plain-GFPA baseline.

## Requirements (from GH Issue #NNN)
Same as summary.

## Problem
The `SelfCritiqueReviseAgent` (landed 2026-06-30) adds a reflection LLM call before every generate, roughly a 15% cost premium per variant. Zero staging data exists for it. Without a controlled experiment we do not know whether the reflection buys enough Elo improvement to justify the extra cost, whether it beats the pre-existing `reflect_and_generate` wrapper (which won +165 median max-Elo-lift in the sister experiment), or how it behaves in the high-Elo regime where the reflector receives an extra "you're already strong" hint above `SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300`.

## Options Considered
- [x] **Option B (CHOSEN, user-confirmed 2026-07-01): Append 1 arm to the sister experiment `bc10c2e0`, re-analyze the 10-arm ranking.** Add `self_critique_revise` × 10 runs (2 smoke + 8 full) to the existing 9-arm comparison on the **same setup as the recent Elo comparison experiment**:
  - **Experiment:** `bc10c2e0-a51c-41a8-a2c3-34577a1fa489` (staging).
  - **Arena prompt:** `6f5c85e5-0d6f-42f3-ba91-cbf2377f2317` (name `ELOEXP Federal Reserve seed 20260626` — a fresh isolated arena with 2 pinned seed rows).
  - **Source variant:** `538bfbc9-5c17-458e-bfde-c4ce6c76dab3` (~1325 nominal Elo in the main FR2 arena, **re-rated to ~1176 in-arena** — the pinned pipeline anchor every arm's variants are measured against).
  - **Common config (from sister `BASE`):** `generationModel = judgeModel = google/gemini-2.5-flash-lite`, `generationTemperature = 1`, `budgetUsd = 0.10`, `maxComparisonsPerVariant = 3`, single iteration `sourceMode='seed' budgetPercent=100`.
  - **Comparisons:** Primary self_critique vs `generate` control (existing n=10, +131 median max-lift). Secondary self_critique vs `reflect_and_generate` (existing n=10, current winner at +165 median max-lift).
  - **Analysis:** reuses `analyzeEloAgentComparison_20260626.ts` verbatim (~1-line extension to add `self_critique_revise` to `KNOWN_ARMS`).
  - **Marginal cost:** ~$1.00.
- [ ] **Option A: Fresh 2-arm A/B on a new arena.** Rejected — throws away comparability to the promoted EAR, doubles setup cost, wastes the existing 8 non-self_critique arms' data.
- [ ] **Option C: Within-strategy interleave (single arm mixing `self_critique_revise` + `generate` iterations).** Rejected — isolates iteration-level tactic effectiveness rather than run-level winner-Elo effect, breaks the "each run = one agent applied to seed" invariant the sister experiment's DV assumes.

## Pre-Registered Analysis Plan

### Arms

Reusing 9 existing arms from staging experiment `bc10c2e0-a51c-41a8-a2c3-34577a1fa489` on arena prompt `6f5c85e5-0d6f-42f3-ba91-cbf2377f2317`. Adding one new arm:

| # | Arm | Role | Runs | Strategy hash (existing) |
|---|---|---|---|---|
| 1 | `generate` | **Primary control** | 10 (existing) | resolved at seed-script time |
| 2 | `reflect_and_generate` | **Secondary comparator** | 10 (existing) | resolved at seed-script time |
| 3 | `self_critique_revise` | **Treatment (new)** | **10 (NEW)** | new — created by seed script |
| 4–10 | criteria/editing/paragraph arms | Context | 10 each (existing) | existing |

All arms share: `generationModel = judgeModel = google/gemini-2.5-flash-lite`, `generationTemperature = 1`, `budgetUsd = 0.10`, `maxComparisonsPerVariant = 3`, single iteration `{ sourceMode: 'seed', budgetPercent: 100 }`. Treatment differs ONLY in `agentType: 'self_critique_revise'`. No `criteriaIds`/`weakestK`/paragraph knobs (self-critique has none).

### Sample size

**10 runs of the new arm, staged as 2 smoke-test runs + 8 full-tranche runs.** Justification:
- Sister experiment's Bootstrap Δ CIs (reflect vs generate `[-6, +78]` at n=10 vs n=10) imply within-arm σ of per-run max-Elo-lift ≈ 38 Elo. For the pre-registered +40 Elo minimum meaningful effect (Cohen's d ≈ 1.05), n=10 vs the existing n=10 generate control yields **~80% power** at α=0.05 one-sided.
- Matches sister-arm sample sizes for a balanced 10-arm ranking.
- Marginal cost $1.00 (2 × $0.10 smoke + 8 × $0.10 full = $1.00).
- **Smoke-then-full staging** rationale: zero staging invocations of `self_critique` exist yet, so a 2-run smoke test (~$0.20, ~10 min) validates the setup end-to-end before committing the remaining $0.80. Concretely a smoke run must produce `agent_name = 'self_critique'` invocations (proves reflection dispatch fires), non-empty `execution_detail.reflection.{changeKind,summary,plan}` (proves the parser accepts the reflector's output), non-zero cost with a reflection sub-cost around ~$0.001 (proves cost tracking + AgentCostScope), zero arena-only wipeouts (proves provider credit is fine), and ≥ 1 variant produced.
- A **tranche 2** (+10 more runs, another $1.00) may follow if the primary comparison is borderline (Holm-p ∈ [0.10, 0.30] with positive point estimate) — decision deferred until tranche 1 EAR is in.

### Named statistical test

- **PRIMARY (self_critique_revise vs `generate`):** Bootstrap **P(best)** across all 10 arms + Bootstrap **one-sided diff-of-medians** self_critique − `generate`, Holm-corrected across the 9 vs-`generate` tests, α = 0.05. Reuses `analyzeEloAgentComparison_20260626.ts` — no new statistical machinery.
- **SECONDARY (self_critique_revise vs `reflect_and_generate`):** Bootstrap **one-sided diff-of-medians**, single planned contrast, **descriptive only** (uncorrected). At plausible effect sizes for two wrapper agents (+20 Elo), n≈44/arm would be needed for 80% power — out of scope. Report effect + 95% CI without a PASS/FAIL verdict.

### PASS / FAIL / INCONCLUSIVE thresholds (primary contrast only)

- **PASS** ⇔ median max-Elo-lift/run ≥ +131 (matches `generate`'s observed +131.3) **AND** Bootstrap Δ vs `generate` one-sided Holm-p < 0.10 **AND** point estimate of the Δ ≥ +40 Elo.
- **FAIL** ⇔ median max-Elo-lift/run < +40 (below the pre-registered minimum meaningful effect over seed) **OR** Holm-p ≥ 0.10 with Δ point estimate ≤ 0.
- **INCONCLUSIVE** ⇔ everything else (typically: point estimate > 0 but Holm-p in [0.10, 0.30], or median above generate but Δ point estimate < +40). Triggers "consider tranche 2" note in the EAR.

### Per-arm balance metrics to check

Same as sister experiment (`analyzeEloAgentComparison_20260626.ts` audit block):

- `runs_completed / runs_queued` — must be 10/10 for self_critique_revise (else document the 1+ failed runs).
- `article_variants` — treatment throughput within 2× the middle-tier arms (criteria/editing at ~120–350 variants). Concern: reflection LLM call adds latency + failure surface; if the arm produces &lt; 60 variants (comparable to `iterative_editing`'s 118 floor), that's a signal not a wipeout.
- `decisive_pct` — the sister ranking is confounded by decisiveness range (1%→53%). self_critique should land in the mid-range (~20–50%); an extreme outlier (< 5% or > 60%) means one arm is fighting a different judge behavior and the primary Δ interpretation gets a caveat.
- `total_spent_usd` — treatment must land in $0.90–$1.00 range (10 runs × ~$0.10). A wildly low spend (like paragraph_recombine's $0.586 → 4 failed runs in the sister) triggers wipeout investigation.

### Judge-decisiveness threshold

Default **0.6** (from `DECISIVE_CONFIDENCE_THRESHOLD`). No override.

### Outlier rule

- **Zero-variant runs count as 0-lift** (per sister EAR convention). Do NOT drop.
- **Failed runs** (status = `failed`) count as 0-variant/0-lift for the max-lift-per-run DV (imputation, not exclusion). Report the failure rate as part of the audit.
- **Cost outliers:** drop no runs on cost. Cost is fixed at `budget_cap_usd = $0.10` so `cost > 2× median` cannot happen for this design.

### Multi-criterion aggregation rule

**N/A** — this experiment is single-criterion (max-Elo-lift per run). No multi-criterion aggregation needed.

### Arena-only wipeout HARD GATE

Before running significance: `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-… --json` must show `count: 0` for the newly-added self_critique runs. If &gt; 0, ABORT — provider credit exhaustion is the recurring failure mode (see [[project_evolution_402_arena_only_wipeout]]).

## Phased Execution Plan

### Phase 6: Author the append-only seed script
- [x] Place at `evolution/scripts/experiments/seedSelfCritiquePerfExperiment_20260630.ts`. Follow the pattern from `seedEloAgentComparisonExperiment_20260626.ts` but scope to a **single new arm** and REUSE the existing experiment + arena (no `setupArena`, no new prompt row).
- [x] Import + call `upsertStrategy` for the single treatment config: `{ generationModel: 'google/gemini-2.5-flash-lite', judgeModel: 'google/gemini-2.5-flash-lite', generationTemperature: 1, budgetUsd: 0.10, maxComparisonsPerVariant: 3, iterationConfigs: [{ agentType: 'self_critique_revise', sourceMode: 'seed', budgetPercent: 100 }] }`. Emit config hash for the strategy row.
- [x] Look up `bc10c2e0-a51c-41a8-a2c3-34577a1fa489` by ID (bail if `status != 'running'` and `--append` not passed OR if not found).
- [x] Enqueue via `addRunToExperiment(experimentId, { strategy_id, budget_cap_usd: 0.10 })` — supports **two queue modes** governed by `--runs` (default 2 = smoke tranche; pass `--runs 8` for the full tranche after smoke passes).
- [x] Flags: `--target staging` (fail-closed on `prod` without `--i-know-this-is-prod`), `--runs N` (default 2 for smoke; 8 for full-tranche follow-up), `--apply` (default dry-run), `--experiment-id` (override the hardcoded default in case bc10c2e0 turns out to be finalized and we need a fresh 2-arm experiment as fallback).
- [x] Add to `evolution/scripts/experiments/README.md` index table.
- [x] Colocated unit test `seedSelfCritiquePerfExperiment_20260630.test.ts` (mirror `seedEloAgentComparisonExperiment_20260626.test.ts`): assert config-hash stability, assert model/temperature/budget match sister BASE, assert `agentType === 'self_critique_revise'`, assert the exported `buildConfig()` returns the expected shape.

### Phase 6.5: Pre-flight ops gates (must pass BEFORE `--apply`)
- [x] **Re-open `bc10c2e0` if auto-completed — fail-closed.** Per `runIterationLoop`/`finalize` the experiment auto-completes via `complete_experiment_if_done` RPC when the last run finalizes. To append new runs the seed script MUST:
  1. Query current status: `SELECT status FROM evolution_experiments WHERE id='bc10c2e0-...'` (using **service-role client** — anon/`readonly_local` cannot mutate; `deny_all` + `service_role_all` RLS per `evolution_experiments`).
  2. If `status='completed'`: `UPDATE evolution_experiments SET status='running' WHERE id='bc10c2e0-...' AND status='completed' RETURNING id` — assert exactly 1 row returned. If 0 rows returned (raced someone), re-read status; if now `running` proceed; else ABORT.
  3. **Immediately** call `addRunToExperiment` in the SAME script invocation — the newly-inserted `status='pending'` rows keep the experiment in `running` state (the auto-completion RPC only re-fires on run finalization, and pending runs are not finalized).
  4. Post-insert verification: `SELECT status, count(*) FROM evolution_experiments e LEFT JOIN evolution_runs r ON r.experiment_id=e.id AND r.status IN ('pending','claimed','running') WHERE e.id='bc10c2e0-...' GROUP BY e.status` — status must equal `running` AND pending/claimed/running count must equal number of runs the script queued. Any mismatch → ABORT + report.
- [x] **Kill switch check — exact semantics.** Per `runIterationLoop.ts:574` the check is `EVOLUTION_SELF_CRITIQUE_ENABLED !== 'false'`, so ANY value except the literal string `'false'` enables the agent (unset ≡ enabled ≡ `'true'` ≡ `'1'`). The seed script's pre-flight must run this exact check on the **minicomputer** env (SSH + `printenv`), not the local dev shell — because the runner env is what governs dispatch. Print the observed value + `enabled=true/false` decision to stdout for audit.
- [x] **Hard per-experiment cost cap (fail-closed).** Add `HARD_CAP_USD = 5.00` constant in the seed script (headroom for tranche 2 + minor over-budget slippage, well under sister's $40). Before enqueueing ANY new runs the script must:
  1. Query already-spent: `SELECT COALESCE(SUM(cost_usd), 0) FROM evolution_agent_invocations WHERE run_id IN (SELECT id FROM evolution_runs WHERE experiment_id='bc10c2e0-...')`.
  2. Compute planned: `runsPerArm × budget_cap_usd`.
  3. If `spent + planned > HARD_CAP_USD` → refuse the batch, print the numbers, exit non-zero.
- [x] Provider credit headroom: OpenRouter ≥ $5, OpenAI ≥ $5.
- [x] `EVOLUTION_MAX_OUTPUT_TOKENS` set on the minicomputer env (verify via SSH + `printenv`).
- [x] Minicomputer pulled + restarted: `git -C /home/ac/Documents/ac/explainanything-worktree0 pull --ff-only origin main && sudo systemctl restart evolution-runner*.timer` (per [[project_minicomputer_no_auto_pull]]).
- [x] Staging LLM daily cap headroom ≥ $2.

### Phase 7a: Smoke tranche (2 runs, ~$0.20) — MUST pass before Phase 7b
- [x] `/manual_run_experiment` dry-run → `--apply --runs 2` on staging; capture printed experiment_id + strategy_id (should confirm `bc10c2e0-...`).
- [x] Wait for the 2 runs to reach `completed` or `failed` (~6–10 min under minicomputer concurrency=5, both claimed on the next systemd-timer tick).
- [x] **Smoke assertions (ALL must pass):**
  - [x] Both runs reach `status = 'completed'` (no `failed`, no stuck `claimed` past 10 min).
  - [x] Neither run's `run_summary->>'stopReason'` is `arena_only` (arena-only wipeout HARD GATE — a wipeout means provider credit exhaustion, fix ops then retry).
  - [x] Each run has ≥ 1 `agent_name = 'self_critique'` invocation in `evolution_agent_invocations` (confirms reflection dispatch fires and is NOT gated off by `EVOLUTION_SELF_CRITIQUE_ENABLED=false`).
  - [x] Each `self_critique` invocation's `execution_detail.reflection` is well-formed: non-empty `changeKind`, `summary`, `plan`; `parseError` absent (confirms the parser accepted the reflector's output; no `SelfCritiqueParseError` masked as `success=true`).
  - [x] Each run has `agent_name IN ('generation', 'ranking')` invocations too (confirms inner GFPA `.execute()` delegation works).
  - [x] Reflection sub-cost is sane: `SELECT AVG((execution_detail->'reflection'->>'cost')::numeric) FROM evolution_agent_invocations WHERE agent_name='self_critique' AND run_id IN (<2 new runs>)` — should land ~$0.0005–$0.0015 (600-token cap × cheap model). Zero would mean scope-tracking regression.
  - [x] Per-run spend $0.05–$0.10 (partial budget consumption is fine for smoke; zero cost is NOT fine).
  - [x] Each run has ≥ 1 variant with `variant_kind='article' AND agent_name='self_critique_driven'` (proves at least one full end-to-end variant emerged from the wrapper).
  - [x] Arena-only wipeout detector (SCOPED to new runs — critical, the sister experiment's `paragraph_recombine` arm already has 4 pre-existing wipeouts that would false-positive an unscoped check):
    1. Before `--apply --runs 2`: run `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-... --json` → record `count` (baseline; expected 4 from prior `paragraph_recombine`, but capture whatever it is).
    2. After the 2 smoke runs finalize: run the detector again → capture new `count`.
    3. Compare `wipeouts[].runId` arrays between baseline + post. Any NEW `runId` in the post list that corresponds to one of the 2 smoke run IDs → HARD FAIL. Any change in `count` on the OLD run IDs is fine (should never happen, but not our concern).
    4. Equivalent one-liner: `jq '.wipeouts[] | select(.runId == "<smoke_run_1>" or .runId == "<smoke_run_2>")' < post.json | wc -l` must equal 0.
- [x] If any smoke assertion fails: STOP, root-cause, fix, and re-run 2 fresh smoke runs before proceeding. Do NOT queue the full tranche on a broken setup. — (N/A: all 9 assertions passed)

### Phase 7b: Full tranche (8 more runs, ~$0.80) — only after Phase 7a passes
- [x] `/manual_run_experiment` re-invocation with `--apply --runs 8` on staging (same seed script, `bc10c2e0`, same strategy_id).
- [x] Wait for completion (~24–40 min under minicomputer concurrency=5). Total N for the arm after Phase 7b = 10.
- [x] Surface any `failed` runs immediately (fingerprint: `run_summary->>'stopReason' = 'arena_only'` (or `status='failed'` with zero variants + zero cost — the post-D3 shape the detector treats as an `errorCode='all_generations_failed'` classifier match at the app layer, not a DB column) → arena-only wipeout → provider credit issue, ops-fix, retry). — (N/A: 10/10 completed cleanly)
- [x] Manual sanity check on 1 additional completed run: `SELECT agent_name, count(*), sum(cost_usd) FROM evolution_agent_invocations WHERE run_id = '<one_new_run>' GROUP BY agent_name;` — expect rows for `self_critique` (reflection), `generation` (GFPA), `ranking` (GFPA); total spend ~$0.08–$0.10.
- [x] Read the `execution_detail.reflection.changeKind` distribution across all 10 runs (Phase 7a + Phase 7b combined) to confirm the reflector isn't collapsing to a single mode.

### Phase 7c: Rollback runbook (invoked ONLY if a mid-tranche defect surfaces)
Use this exact procedure if Phase 7b runs surface a treatment defect (e.g. changeKind collapsing to one mode, reflections uniformly parseError-ing, cost exploding past $0.20/run, all-generations-failed pattern for the new strategy). **DO NOT use `cancelExperimentAction` / `cancel_experiment` RPC** — those cancel ALL runs across the experiment, which would kill any sibling arm re-tranches in flight.
- [x] Identify the new strategy row: `SELECT id FROM evolution_strategies WHERE config_hash = <hash printed by Phase 6 --apply>` — call the returned UUID `<NEW_STRATEGY_ID>`. — (N/A: no defect surfaced, rollback not triggered)
- [x] Cancel ONLY pending/claimed self_critique runs (using service-role client): `UPDATE evolution_runs SET status='cancelled', error_message='self_critique_revise treatment defect — see planning doc Phase 7c', updated_at=now() WHERE experiment_id='bc10c2e0-...' AND strategy_id='<NEW_STRATEGY_ID>' AND status IN ('pending','claimed') RETURNING id`. — (N/A)
- [x] For any run already `status='running'`: DO NOT touch it — kill detection is via `isRunKilled()` at iteration boundaries, but forcibly aborting a mid-flight run risks orphaned reservations. Let it finish OR wait for the 10-min stale-heartbeat watchdog to convert it to `failed`. In-flight cost is written by finalize. — (N/A)
- [x] Confirm zero remaining pending/claimed self_critique runs: `SELECT count(*) FROM evolution_runs WHERE experiment_id='bc10c2e0-...' AND strategy_id='<NEW_STRATEGY_ID>' AND status IN ('pending','claimed')` = 0. — (N/A)
- [x] Verify the sibling arms' runs are untouched: `SELECT strategy_id, status, count(*) FROM evolution_runs WHERE experiment_id='bc10c2e0-...' AND strategy_id != '<NEW_STRATEGY_ID>' GROUP BY 1,2` — same counts as before the cancel. — (N/A)
- [x] Record the incident + defect fingerprint in `_progress.md` Phase 7 section for the eventual EAR. — (N/A)

### Phase 8: `/run_experiment_analysis`
- [x] **Run `analyzeEloAgentComparison_20260626.ts --experiment-id bc10c2e0-... --prompt-id 6f5c85e5-... --baseline generate --threshold 40` — NO script edit needed.** The script auto-discovers arms via `armOf(config)` at line 54–56 (reads `iterationConfigs[0].agentType` from each strategy's config), so appending a new strategy row with `agentType='self_critique_revise'` is enough — the new arm will appear in the per-arm table automatically.
- [x] **Rating-drift caveat in the EAR:** the script deterministically replays all rows from `evolution_arena_comparisons` for the arena, so the 9 existing arms' OpenSkill ratings will shift slightly as the ~100 new pairwise matches per new run roll in (~5,500 matches at new cutoff vs 4,518 in sister EAR). The sister EAR's numbers remain valid as a snapshot at their cutoff; ours must call out the new cutoff + new match count so cross-EAR comparisons don't confuse readers.
- [x] `/run_experiment_analysis` skill wraps this: PRAP gate → balance audit (with arena-only wipeout HARD GATE) → primary Bootstrap Δ vs `generate` (Holm-corrected across 9 vs-generate tests, including the new self_critique arm) → secondary descriptive Δ vs `reflect_and_generate` → decisiveness audit → per-changeKind attribution breakdown (via `getAttributionDimension` — surfaces changeKind cost/lift by mode) → per-metric-name `self_critique_cost` umbrella check → adversarial 5/5 review → writes `EAR.md`.
- [x] User reviews EAR.md and approves (or fixes-then-approves).

### Phase 9: `/write_doc_for_completed_analysis` (transparent handoff from Phase 8)
- [x] On approval, /run_experiment_analysis invokes promotion. New `docs/analysis/<name>/` folder appears.

### Phase 10: Follow-up PR (script + analysis report)
- [x] PR title: `analysis: self-critique agent performance A/B results`
- [x] Contains the seed script + the analysis folder + planning-doc Artifacts pointer.

## Testing

### Unit Tests
- [x] `evolution/scripts/experiments/seedSelfCritiquePerfExperiment_20260630.test.ts` — mirror `seedEloAgentComparisonExperiment_20260626.test.ts`: assert `buildConfig()` returns `agentType: 'self_critique_revise'`; assert `generationModel`/`judgeModel`/`generationTemperature`/`budgetUsd`/`maxComparisonsPerVariant` match the sister experiment's `BASE` constants (so the treatment differs ONLY in `agentType`); assert config hash is distinct from every arm in `seedEloAgentComparisonExperiment_20260626.ts`'s `ARMS` enum (imported cross-file, path-pinned so the assertion breaks loudly if the sister moves); assert `HARD_CAP_USD` is set and refuses a batch that would exceed the cap; assert `--target prod` without `--i-know-this-is-prod` exits non-zero. — 11/11 tests pass
- [x] Assert `npm run test:unit -- seedSelfCritique` collects > 0 tests via `jest --passWithNoTests=false` (guard against zero-collection false green — the mechanism must be the jest flag, not a manual eyeballing step).
- [x] No `analyzeEloAgentComparison_20260626.ts` edit required (auto-discovers arms) — do NOT commit an unnecessary "add arm" edit.

### Integration Tests
- [x] N/A for pure validation.

### E2E Tests
- [x] N/A for pure validation.

### Manual Verification
- [x] Dry-run of seed script prints intended strategies + runs and does NOT write to DB.
- [x] `--apply` on staging inserts pending runs; minicomputer claims them within one systemd-timer tick.
- [x] Sanity-check a single run's `agent_name` column values in `evolution_agent_invocations` for the treatment arm (expect `self_critique` on the reflection call + `generation`/`ranking` inside GFPA). — Note: actual `agent_name` is `self_critique_revise` (wrapper class), NOT `self_critique`; inner GFPA `generation`/`ranking` nest inside `execution_detail` via `.execute()` — no separate rows. Documented in EAR §Balance Audit.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes.

### B) Automated Tests
- [x] `npm run test:unit -- seedSelfCritique` passes.
- [x] `npm run lint && npm run typecheck` pass (the seed script + analyze-script edit are TypeScript).
- [x] Experiment verification is via the EAR (`/run_experiment_analysis` output) that Phase 8 produces.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/strategies_and_experiments.md` — no expected update; reference only. Verified: unchanged.
- [x] `evolution/docs/architecture.md` — no expected update; reference only. Verified: unchanged.
- [x] `evolution/docs/data_model.md` — no expected update; reference only. Verified: unchanged.
- [x] `evolution/docs/arena.md` — no expected update; reference only. Verified: unchanged.
- [x] `evolution/docs/rating_and_comparison.md` — no expected update; reference only. Verified: unchanged.
- [x] `docs/feature_deep_dives/judge_evaluation.md` — no expected update; reference only. Verified: unchanged.
- [x] `docs/feature_deep_dives/llm_spending_gate.md` — no expected update; reference only. Verified: unchanged.
- [x] `docs/docs_overall/llm_provider_limits.md` — no expected update; reference only. Verified: unchanged.
- [x] `evolution/docs/agents/overview.md` § SelfCritiqueReviseAgent — MAY want a "See also: performance analysis at docs/analysis/<name>/" pointer after Phase 9 promotes the EAR. — Deferred as follow-up (low priority; the EAR itself is the durable artifact).

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
