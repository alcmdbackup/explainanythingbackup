# Analyze Performance Self Critique Agent Research

## Problem Statement
Run an experiment to analyze and understand performance of self critique driven agent.

## Requirements (from GH Issue #NNN)
Same as summary.

## High Level Summary

`SelfCritiqueReviseAgent` was evaluated end-to-end via 10 runs appended to sister experiment `bc10c2e0` on arena `6f5c85e5`, using the same seed (`538bfbc9`, re-rated to Elo 1175.9 in-arena), same models (`google/gemini-2.5-flash-lite`), same $0.10/run budget as the 9-agent sister comparison. **PRAP verdict: FAIL** — the agent's median max-Elo-lift per run of +102.3 fell below `generate`'s +131.3 (Δ = -29.0, 95% CI [-42, +16], Holm-p = 1.000). But the arm was **the only one to improve the seed by ≥+40 Elo in 100% of runs** (reflect_and_generate and generate both at 90%; middle-tier arms 70-80%). The reliability floor is a real feature; the ceiling shortfall is throughput-driven — self_critique produced 47% fewer article variants than `generate` at 86% of the spend, because the reflection LLM call adds ~15% overhead per variant attempt. Free-form reflection did NOT beat constrained-tactic reflection (`reflect_and_generate` still champions at +165 medLift, descriptive-only comparison).

See full EAR at `docs/planning/analyze_performance_self_critique_agent_20260630/EAR.md`.

**Perfect precedent exists.** The sister project `design_elo_improvement_experiment_20260626` ran a **9-agent comparison on the same Federal Reserve seed** at $0.10/run (staging experiment `bc10c2e0-a51c-41a8-a2c3-34577a1fa489`, arena prompt `6f5c85e5-0d6f-42f3-ba91-cbf2377f2317`), with an EAR promoted at `docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/`. Winner: **`reflect_and_generate` at +165 median max-Elo-lift per run, P(best)=96%**. Baseline `generate` at +131, P(best)=4%. `self_critique_revise` did NOT exist at the time so it was NOT tested. Adding it as a 10th arm to the same arena is a natural, cheap ($1 for 10 runs), and maximally-comparable extension.

**Recommended design:** append 1 arm × 10 runs to the existing experiment `bc10c2e0` on arena `6f5c85e5` using the sister project's pattern (`seedEloAgentComparisonExperiment_20260626.ts` extended, or a dedicated seed script targeting `--append`). Reuse the existing analysis script `analyzeEloAgentComparison_20260626.ts` to compute P(best), Δ vs `generate` + Holm-corrected p-value, %impr/%impr≥40, %var>seed, decisiveness. Total marginal cost: ~$1.00.

## Key Findings

(Populated by EAR Step 7 — mirrors `EAR.md ## Key Findings` verbatim.)

1. **`self_critique_revise` FAILS the primary contrast vs `generate` under the pre-registered PRAP.** Median max-lift/run = +102.3 (below `generate`'s +131.3 by -29.0 Elo). Holm-corrected one-sided p = 1.000. Δ 95% CI = [-42, +16] — includes zero, so the difference is not statistically distinguishable. FAIL condition triggers cleanly. The hypothesis "self-critique's reflection premium buys real Elo gains vs a plain-GFPA baseline" is rejected at n=10 with 80% power.

2. **`self_critique_revise` is the ONLY arm with 100% of runs meaningfully improving the seed (≥+40 Elo).** Reflect_and_generate and generate tie at 90%; the criteria/editing middle sits at 70-80%; paragraph arms at 20%. Every self_critique run's best variant scored between 1285.3 and 1329.3 Elo — a tight [+109, +153] Elo lift range vs seed 1175.9. Reliability is a real feature.

3. **Ceiling is lower than baseline because throughput is lower.** Self_critique produced only 250 article variants at $0.83 spend (avg 25/run); `generate` produced 474 variants at $0.97 spend (avg 47/run — ~90% more variants per dollar).

4. **Cost-per-improver ($0.28) is 2.5× higher than `reflect_and_generate` ($0.11).** The reflection LLM call adds ~15% overhead to every variant attempt; combined with lower throughput per dollar and lower ceiling, self_critique's economic efficiency is worst among the top three arms.

5. **Vs `reflect_and_generate` (secondary, descriptive-only): self_critique lags by -63 Elo on median max-lift.** Free-form reflection did NOT beat constrained-tactic reflection on this article.

6. **`changeKind` labels cluster heavily around "Mode shift" (~80% of invocations) but underlying `plan` bodies are diverse.** 5/5 sampled plans targeted distinct concrete tactics (analogies, narrative scene-setting, jargon reduction, title replacement, tone rework). The clustering is prompt-anchor artifact, not tactic collapse.

7. **11% invocation failure rate (SelfCritiqueParseError)** — root-caused to reflector OUTPUT TRUNCATION at the 600-token cap, NOT low-value filtering. 2/2 sampled parseError invocations showed well-formed ChangeKind + Summary blocks followed by mid-sentence termination before `Plan:`. Actionable follow-up: raise the reflection output cap to 800-1000 tokens.

8. **Median-vs-mean per-invocation Elo delta skew reveals distinct distribution shapes** (using live-DB anchor ~1191):
    - `reflect_and_generate`: median +61.0 ≈ mean +62.9 — tight/consistent.
    - `generate`: median +31.1 > mean +9.7 (LEFT skew: high variance, high ceiling via outliers).
    - **`self_critique_revise`: median +8.1 < mean +29.8 (RIGHT skew) — the reliability floor is at the RUN level, NOT the INVOCATION level.** ~50% of variants land only marginally above seed, but every run contains at least one high-Elo variant. Novel structural finding not visible in the sister EAR.

**Legacy pre-experiment findings (kept for historical context):**

L1. **The agent was landed, integrated, and unused on staging pre-experiment.** `runIterationLoop.ts:571` dispatches `self_critique_revise` alongside the other variant-producing agents, gated by `EVOLUTION_SELF_CRITIQUE_ENABLED='false'` kill switch. Zero invocations were logged before this experiment.

2. **Cost model per the agent code:** reflection LLM call at ~$0.0008 (600-token output cap) + inner GFPA generation ~$0.002 + GFPA ranking ~$0.002 = **~$0.005/variant**, ~1× GFPA cost + ~15% reflection premium. `costBeforeReflection` snapshot in `execute()` (line 465) makes the reflection cost separately queryable in `execution_detail.reflection.cost`.

3. **The `changeKind` attribution dimension is queryable.** `getAttributionDimension()` truncates `detail.reflection.changeKind` to 60 code points and registers it via `registerAttributionExtractor` for the metrics-layer registry. This gives per-changeKind Elo-attribution rollups in the metrics table, comparable to per-tactic breakdowns for `generate`.

4. **The sister experiment's design is directly reusable.**
   - Arena: fresh isolated (`ELOEXP Federal Reserve seed 20260626`, prompt_id `6f5c85e5`), 2 seed rows — `generation_method='seed'` source + `generation_method='pipeline'` anchor at pinned mu/sigma from source variant `538bfbc9-5c17-458e-bfde-c4ce6c76dab3` (~1325 nominal Elo, ~1176 in-arena).
   - Common config: `google/gemini-2.5-flash-lite` gen + judge, `generationTemperature: 1`, `budgetUsd: 0.10`, `maxComparisonsPerVariant: 3`, single iteration `{ agentType: <arm>, sourceMode: 'seed', budgetPercent: 100 }`.
   - Sample size: 10 runs/arm at min-N floor (per Decision E adaptive stopping, but for 1-arm extension a fixed 10 to match tranche 1 is sufficient).
   - Primary DV: per-run median max-Elo-lift over seed (ceiling). Statistical test: Bootstrap P(best) + Bootstrap one-sided diff-of-medians vs `generate`, Holm-corrected across arms, α=0.05, minimum meaningful effect size = 40 Elo.
   - Secondary DVs: %impr (share of runs with maxLift > 0), %impr≥40, %var>seed (variant-level density), median Δ/inv (per-invocation Elo), decisiveness %, spend.

5. **Existing analysis script does most of the work.** `evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts` accepts `--experiment-id bc10c2e0-… --prompt-id 6f5c85e5-… --baseline generate --threshold 40` and emits the per-arm table verbatim. Extending it (or the seed script's `Arm` type union) to include `self_critique_revise` is a one-line change.

6. **The reflect_and_generate result is the tough benchmark to beat.** `reflect_and_generate` won +165 Elo median max-lift (P(best)=96%) and rated only +34 Elo above `generate` with 95% CI [-6, +78], Holm p=0.23 → *not significantly* better than `generate` at n=10. So self-critique needs to clear a similar bar to make headlines. For the hypothesis "self-critique meaningfully outperforms baseline" a reasonable PASS threshold: median max-lift ≥ +131 (matches generate) AND Δ vs generate one-sided Holm p < 0.10 AND effect size ≥ +40.

7. **Hard gates to respect (per the sister project):**
   - Arena-only wipeout HARD GATE: `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id <id> --json` must show 0 (recurring 402/OpenRouter credit-exhaustion failure mode — see [[project_evolution_402_arena_only_wipeout]]).
   - Minicomputer pull required after any main merge (systemd runner does NOT auto-pull, per [[project_minicomputer_no_auto_pull]]).
   - Provider credit headroom: OpenRouter/OpenAI/DeepSeek balance ≥ $5 buffer.
   - `EVOLUTION_MAX_OUTPUT_TOKENS` set on the minicomputer (D5 fix; guards low-balance 402).
   - `EVOLUTION_SELF_CRITIQUE_ENABLED` must NOT be `'false'` on the runner env.

8. **Cost-tracking invariant.** Reflection cost lands on the wrapper's `AgentCostScope`; inner GFPA `generation` + `ranking` costs also flow through the wrapper via `.execute()` (not `.run()`) so `evolution_metrics` `self_critique_cost` umbrella rolls the whole thing up. Per [[feedback_cost_tracking_fail_closed]] the experiment MUST use production cost tracking (queued runs through `upsertStrategy` + `createExperiment` + `addRunToExperiment` — no bypasses).

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

### Relevant Docs (evolution + supplemental)
- evolution/docs/strategies_and_experiments.md — strategy/experiment lifecycle, iteration configs, metric bootstrap CIs
- evolution/docs/architecture.md — pipeline flow, agent dispatch, budget architecture (three-layer)
- evolution/docs/data_model.md — `evolution_agent_invocations`, `evolution_variants`, `evolution_arena_comparisons`, `evolution_metrics` schemas
- evolution/docs/arena.md — arena entry lifecycle, `loadArenaEntries` / `syncToArena`, `synced_to_arena` flag
- evolution/docs/rating_and_comparison.md — [NOT READ during /research — reference only, sister EAR fully covers rating computation for this experiment]
- docs/feature_deep_dives/judge_evaluation.md — [NOT READ during /research — reference only]
- docs/feature_deep_dives/llm_spending_gate.md — [NOT READ during /research — reference only; ops gate covered by pre-flight checklist]
- docs/docs_overall/llm_provider_limits.md — [NOT READ during /research — reference only; provider selection matches sister experiment]

### Sister Project Docs (found during research)
- docs/planning/design_elo_improvement_experiment_20260626/design_elo_improvement_experiment_20260626_planning.md — the 9-agent comparison plan (Decisions A/B/C/D/E/H)
- docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/elo-agent-comparison-federal-reserve-2-20260628.md — promoted EAR with per-arm numbers (this is the direct-comparison target for our 10th arm)
- evolution/scripts/experiments/README.md — seed script conventions
- evolution/scripts/experiments/seedEloAgentComparisonExperiment_20260626.ts — the pattern to extend for our 10th arm

## Code Files Read
- evolution/docs/agents/overview.md § SelfCritiqueReviseAgent — full agent spec (initialize context)
- evolution/src/lib/core/agents/selfCritiqueRevise.ts (all 682 lines) — implementation: prompt builder, parser, sanitizer, fence check, execute() lifecycle
- evolution/src/lib/pipeline/loop/runIterationLoop.ts (grep for `self_critique_revise`) — confirms integration at line 358-419 (variant-producing branch), line 571-582 (dispatch + kill switch)
- evolution/scripts/experiments/seedEloAgentComparisonExperiment_20260626.ts (all 294 lines) — the ARM enum, buildConfig, setupArena, seedStrategy, main() — direct template for our seed script
- evolution/scripts/experiments/README.md — seed script conventions + index

## Open Questions

**All resolved during planning (user, 2026-07-01):**

1. ✅ **Append to `bc10c2e0` vs fresh experiment** — RESOLVED: append. Same arena `6f5c85e5`, same anchor, same competitors → maximum comparability to the promoted EAR. Contingency: if `bc10c2e0.status='completed'` blocks re-open, the seed script's `--experiment-id` flag lets us fall back to a fresh 2-arm experiment on the same source variant.
2. ✅ **Baseline arms in the PRAP** — RESOLVED: two comparisons. Primary = self_critique vs `generate` (formal Bootstrap Δ, Holm-corrected, PASS/FAIL/INCONCLUSIVE). Secondary = self_critique vs `reflect_and_generate` (descriptive-only single planned contrast, effect + CI, no verdict — n≈44/arm required for 80% power on the +20 Elo effect between two wrapper agents, out of budget scope).
3. ✅ **Sample size for the new arm** — RESOLVED: **n = 10 runs**. Derived from sister EAR's Bootstrap Δ CIs → within-arm σ of per-run max-Elo-lift ≈ 38 Elo → Cohen's d = 1.05 for the pre-registered +40 Elo target → n=10 vs existing n=10 generate control gives ~80% power at α=0.05 one-sided. Marginal cost $1.00. Balanced with the other 9 arms (10 runs each).

### Pilot-note escalation (not blocking design)
If the primary contrast lands in the INCONCLUSIVE band (Holm-p ∈ [0.10, 0.30], point Δ &gt; 0), the EAR recommends a **tranche 2** of +10 more `self_critique_revise` runs at the same $1.00 marginal cost to bring the primary comparison to n=20 vs n=10 (harmonic n ≈ 13.3, power ≈ 85% for +40 Elo). Decision to run tranche 2 is deferred until after the tranche 1 result is in.

## Promoted Analyses

- [docs/analysis/self-critique-agent-perf-federal-reserve-2-20260701/](../../analysis/self-critique-agent-perf-federal-reserve-2-20260701/) — promoted 2026-07-01 via `/write_doc_for_completed_analysis`. Verdict FAIL. Primary DV: median max-lift/run = +102.3 (Δ vs generate = -29.0, Holm-p = 1.000). Headline: reliability floor at RUN level (100% %impr≥40) but median Δ/inv = +8.1 shows floor does NOT translate to INVOCATION level.
