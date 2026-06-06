# Create Tool Systematic Judge Evaluation (Evolution) Research

## Problem Statement
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

## High Level Summary
_(being populated during /research — multi-agent workflow `judge-eval-research` in flight)_

### Historical methodology recovered (docs/research/judge_agreement_summary_tables.md + judging_accuracy_20260412.md)

Source branch `feat/estimate_match_noise_evolution_20260411` (April 2026). The exact experimental harness to replicate:

- **Scripts**: `judge-agreement-test.ts` (4 models × 4 temps × 10 comparisons × 2 LLM calls = 80 calls/model/pair), `test-judge-models-v2.ts` (adds qwen3-8b on/off, gpt-oss-20b default/low, qwen-2.5-7b; tracks reasoning tokens), `beta-analysis.ts` (back-solves implied OpenSkill beta from observed agreement via `P = 1/(1+exp(-gap/c))`, `c²=σ_i²+σ_q²+2β²`), `beta-sigma-impact.ts` (simulates comparisons-to-converge at different beta using real `osRate()`). **Only `test-judge-models-v2.ts` + a `judge-v2-results-*.json` survive on `main`** — the rest must be recovered from git history (workflow R1.C is doing this).
- **Fixed pair bank**: variants from run `140f7bce` (Federal Reserve articles). Two ground-truth-ish cells: **large Elo gap** (A vs B, 25 mu / 404 Elo) and **close pair** (C vs D, 0.09 mu / 1.4 Elo). Close pair is the discriminating test — weak judges collapse to 100% position-biased TIEs.
- **Metrics computed**: decisive rate, agreement %, avg confidence, median latency (wall + fwd), output tokens, reasoning tokens, input/output cost split, cost-per-decisive-comparison, implied beta.
- **Key conclusions that shaped the current system**: (1) **beta=0** is correct for static text (only judge noise matters) — `beta-sigma-impact.ts` showed convergence in 11 comparisons at beta≈0 vs 35 at default 4.17 vs never at nano-temp-1's implied 44. (2) **qwen-2.5-7b-instruct** became `DEFAULT_JUDGE_MODEL` — 100% decisive on both pairs, ~1.7s, ~0 output tokens, cheapest cost-per-decisive ($0.000270). (3) gpt-4.1-nano (old default) = 0% decisive on close pairs (pure position bias). (4) **parseWinner "Your answer: B" bug**: qwen3-thinking-off returns `"Your answer: B"` → `parseWinner` returns null → confidence floored at 0.30 despite correct judgment. A one-line regex fix recovers full confidence — *verify current status in code*. (5) Reasoning (qwen3-on, oss20b-default) is 100% decisive but 9-30× slower and 2× cost; not worth it when qwen-2.5-7b already hits 100%.

This is exactly the methodology the new tool must turn into a repeatable, structured-storage tool.

### ⭐ CRITICAL discovery — Match Viewer (#1168) merged 2026-06-06, branch now rebased onto it

A 20-agent research workflow (`judge-eval-research`, 5 rounds) surfaced that **PR #1168 "match_viewer_with_experimentation_procedures" merged into `main` today** (commit `23230ece`). Our `/initialize` branch was based on the stale `970bd6d9`; **the branch has been rebased onto `origin/main` (`838d2956`, 0 behind).** This changes the project's shape: the "match viewer" and "prompt modifier" the user referenced now EXIST.

**What Match Viewer already delivers (display-only):**
- `/admin/evolution/matches` (list, filter by run id/winner/confidence) + `/admin/evolution/matches/[comparisonId]` (detail + **re-judge sandbox**). New "Tools" sidebar group.
- `rejudgeComparisonAction({comparisonId, judgeModel, mode, customPrompt, temperature, explainReasoning}) → {winner, confidence, turns, costUsd, passes[]}` in `evolution/src/services/arenaActions.ts` — drives `run2PassReversal` directly (bypasses cache to capture per-pass `{prompt, rawResponse, parsedWinner}`), uses **plain `callLLM`** (NOT `createEvolutionLLMClient`, so it can pass temperature and writes NO `evolution_metrics`/ratings — persists nothing).
- `buildComparisonPrompt(textA, textB, mode, customPromptOverride?)` — the custom judge-prompt seam (overrides the rubric block only; keeps `## Text A/B` + `Your answer:` contract so 2-pass + `aggregateWinners` stay valid). `computeRatings.ts`.
- `parseVerdictFromReasoning` — reasoning-tolerant parser scanning the LAST `Your answer: A|B|TIE` marker (used when `explainReasoning` on; avoids `parseWinner`'s start-anchored false-trigger on prose "tie/draw/equal").
- Re-judge sandbox UI: model picker, article/paragraph toggle, **temperature slider**, **custom-prompt textarea**, **"explain reasoning" toggle**, per-pass raw prompt/output cards, "not persisted" marker.

**Therefore the precise GAP this project (#1167) fills** = the **persistence + systematic-measurement layer on top of Match Viewer's interactive re-judge primitive**:
1. **Keep logs of match history / record settings used / structured retrievable storage keyed by settings** — Match Viewer persists NOTHING; we add `judge_eval_*` tables.
2. **Batch sweep** over a fixed pair-bank × settings grid — Match Viewer is one-match-at-a-time, manual.
3. **Measure whether settings improve DECISIVENESS** — aggregate metrics (decisive_rate, agreement, position-bias, cost-per-decisive, implied beta) across the bank, with "best settings" retrieval.

Read `docs/planning/match_viewer_with_experimentation_procedures_20260605/` (now on main) before building — align, don't duplicate. Its `rejudgeComparisonAction` input contract + the `customPromptOverride`/`parseVerdictFromReasoning` seams are the judging primitive our batch tool reuses.

### Code facts verified on rebased main (`838d2956`)
- **Judge entry point** = `compareWithBiasMitigation(textA, textB, callLLM, cache?, mode?, customPromptOverride?)` in `evolution/src/lib/shared/computeRatings.ts:478` (NOT the legacy `comparison.ts`/`reversalComparison.ts`). `parseWinner` `:380`, `aggregateWinners` `:450-471` (confidence ∈ {0,0.3,0.5,0.7,1.0}), `DECISIVE_CONFIDENCE_THRESHOLD=0.6` `:170`.
- **Decisiveness metric** = `decisive_rate = count(confidence > 0.6)/total` — `evolution/src/lib/metrics/computations/finalization.ts:83-86`.
- **Judge temperature IS hard-forced to 0** in `createEvolutionLLMClient.ts:146-148` (ternary on `agentName ∈ {ranking, paragraph_rank}`) — VERIFIED in code, not just docs. Sweeping temperature requires NOT going through the ranking agent path → use plain `callLLM` (exactly what `rejudgeComparisonAction` does).
- **reasoningEffort** is forwarded by the LLM client but `rankSingleVariant.makeCallLLM` doesn't pass it; only the debate judge wires it (`debateJudgeReasoningEffort`). Reasoning-capable evolution models: `o3-mini` (maxTemp null), `gpt-oss-20b` (reasoning mandatory), `qwen/qwen3-8b` (reasoning optional). Default judge `qwen-2.5-7b-instruct` has `supportsReasoning=false`.
- **Match persistence** = `evolution_arena_comparisons` (sole writer `MergeRatingsAgent`), columns: id, prompt_id, entry_a/b, winner (a/b/draw), confidence, run_id, iteration, invocation_id, mu/sigma before/after. **Drops judgeModel + both raw passes + latency/tokens/cost + ground truth + experiment grouping** → unsuitable as the eval store; need dedicated tables.

### Historical methodology recovered from git (workflow R1.C/R5.D)
- Lost scripts confirmed at unmerged branch `feat/estimate_match_noise_evolution_20260411` (SHA `65730bc6`; issue #959 still OPEN): `judge-agreement-test.ts` (`58fc7bff`), `beta-analysis.ts` + `beta-sigma-impact.ts` + `beta-convergence-sim.ts` (`56023ed1`) + 6 result JSONs. **Recover per-file via `git show <sha>:<path>` / targeted `git checkout` — never whole-dir (CLAUDE.md).** Only `test-judge-models-v2.ts` + `judge-v2-results-1776120224511.json` are on main.
- **Pair bank** = run `140f7bce` (Federal Reserve), 3 distinct texts: A `4d3ced31` (mu 43.9, grounding_enhance, winner), B `2f25e2b0` (mu 18.7), C `39d3275f` (mu 18.75, baseline). **Data quirk: D's UUID == B's UUID** (`2f25e2b0`) — close pair is C-vs-B-ish; pair-bank seeding must fix the labeling. Ground truth = OpenSkill mu/Elo gap (noisy proxy), large-gap only; close pair is effectively tie-acceptable.
- **Sweep** = model × temp {0,0.3,0.7,1.0} × 10 reps × 2-pass. `test-judge-models-v2.ts` `CallResult` (`:120-139`) is the per-repeat record to mirror: forwardRaw, reverseRaw, fwd/revParsed, winner, confidence, wallMs, fwdMs, output+reasoning tokens.
- **Implied beta back-solve** (`beta-analysis.ts`): `c = gap/(-ln(1/p-1))`, `beta = sqrt(max(0,(c²-σ_A²-σ_B²)/2))`; constants gap=25.27, σ_A=4.434, σ_B=6.183, DEFAULT_BETA=4.167. beta=0 shipped (PR #964) after this. (Requires ground truth.)

### Metrics the tool computes per (settings-tuple × pair) cell
Settings-only (no labels): **decisive_rate** (confidence>0.6, for live-metric parity — expose v2 non-TIE rate as secondary), self-consistency/agreement % (fraction in modal winner over N), avg_confidence, **position_bias_rate** (≈ fraction at confidence 0.5 / fwd==reverse same-label divergence), median latency (wall + fwd), avg output+reasoning tokens, avg cost (reuse rejudge's `estimatedCostUsd` via onUsage; fallback to modelRegistry pricing), **cost-per-decisive** (= avg_cost / decisive_rate). Require ground truth: accuracy-vs-truth, implied_beta. Report latency as median, rest as mean; keep A/B/TIE histogram + modal winner per cell.

### Proposed structured storage (3 tables; do NOT reuse evolution_arena_comparisons)
- `judge_eval_pair_banks` — fixed pairs: id, name UNIQUE, source_run_id, pairs JSONB ([{label, variant_a_id, variant_b_id, text_a, text_b, expected_winner?, gap_kind}]), created_at.
- `judge_eval_runs` — one row per settings tuple: id, pair_bank_id FK, judge_model, temperature NUMERIC, reasoning_effort (none/low/medium/high), comparison_mode (article/paragraph), prompt_variant TEXT?, prompt_variant_hash (sha256 of effective template incl. mode), repeats, settings_key, notes, created_at. UNIQUE(settings_key, pair_bank_id) for idempotent re-run + retrieval-by-settings.
- `judge_eval_calls` — one row per (run × pair × repeat) 2-pass: id, eval_run_id FK CASCADE, pair_label, repeat_index, forward_winner, reverse_winner, winner, confidence, `decisive GENERATED ALWAYS AS (confidence > 0.6) STORED`, wall_ms, fwd_ms, rev_ms, prompt/output/reasoning_tokens, cost_usd, forward_raw, reverse_raw, error, created_at. UNIQUE(eval_run_id, pair_label, repeat_index).
- "Best settings by decisive rate" = GROUP BY over runs⋈calls (`AVG(decisive::int)` DESC) — expose as a VIEW `judge_eval_settings_leaderboard`. Follow evolution conventions: deny_all + service_role_all RLS, idempotent migration (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS), Zod schemas mirroring (reuse reasoning enum from schemas.ts:828-840), regen `database.types.ts`.

### Key risks (workflow R5.B) → must be in plan
- **Cost/budget**: sweeps multiply LLM calls; `callLLM`'s `LLMSpendingGate` fails closed (`GlobalBudgetExceededError`/`LLMKillSwitchError`) — catch per call, pre-flight cost estimate + cap, `--dry-run`, tag `call_source='judge_eval'`. Watch per-user cap on guest/admin.
- **Rate limits**: add concurrency cap + retry/backoff (v2 script had none).
- **parseWinner false-trigger** on reasoning prose → use `parseVerdictFromReasoning` when reasoning on; always store raw responses.
- **Comparison cache** keys on text only (settings-agnostic) → do NOT share cache across settings/repeats (drive `run2PassReversal` directly like rejudge does).
- **Ground-truth noise / D==B UUID** → accuracy & implied-beta only on large-gap pairs; mark close pair tie-acceptable.
- **Temperature-0 lock** → "best settings" with temp>0 are NOT directly applicable to production ranking without a code change to the ranking path (out of scope; document).

### Open scope question (needs user input)
There is a **second, non-arena LLM judge**: `src/lib/services/contentQualityCompare.ts` + `contentQualityEval.ts` (score-based, ported from a `compare.py`). All historical work + Match Viewer concern the **arena pairwise judge**. Need to confirm whether "judge performance" = arena pairwise judge only (assumed) or also the content-quality judge.

### Initial orientation from doc reads

- **What "the judge" is.** Pairwise comparison primitive `compareWithBiasMitigation()` (`evolution/src/lib/comparison.ts`) wraps a 2-pass A/B-reversal protocol (`run2PassReversal` in `evolution/src/lib/shared/reversalComparison.ts`) to cancel position bias. Each pass calls the judge LLM, `parseWinner()` extracts A/B/TIE, and `aggregateWinners()` maps the two passes to a `{winner, confidence}` verdict (confidence ∈ {0.0, 0.3, 0.5, 0.7, 1.0}). The prompt is built by `buildComparisonPrompt(textA, textB, mode)` in `evolution/src/lib/shared/computeRatings.ts` (`'article'` default rubric vs `'paragraph'` TIE-discouraging rubric).
- **Decisiveness.** A match is a draw when `confidence < 0.3` or forced TIE on A/B disagreement (confidence 0.5). Arena-level decisive threshold is `DECISIVE_CONFIDENCE_THRESHOLD = 0.6` (`rating.ts`). Run summaries already carry `matchStats.decisiveRate` + `avgConfidence` (`EvolutionRunSummary` V3, `evolution_runs.run_summary`). "Improving decisiveness rate" = increasing the share of high-confidence (non-TIE, non-partial-failure) verdicts WITHOUT inflating judge error/disagreement.
- **Judge settings live in `StrategyConfig.judgeModel`** (`evolution_strategies.config` JSONB). Temperature/reasoning are NOT first-class judge knobs today — comparison calls go through the shared LLM client; adding per-judge prompt override / temperature / reasoning-effort is part of the new tool's scope.
- **Where match history persists.** `evolution_arena_comparisons` (entry_a, entry_b, winner ∈ a/b/draw, confidence, run_id, prompt_id, status). In-memory `V2Match` buffer flows through `syncToArena`. Per-comparison detail can also land in `evolution_agent_invocations.execution_detail` (JSONB, capped 100KB) and `evolution_logs`.
- **Historical methodology (to replicate).** Two research docs already exist:
  - `docs/research/judge_agreement_summary_tables.md` — empirical judge-model agreement (80 calls/model, 4 temperatures, 2 variant pairs) across nano, mini, deepseek, gpt-oss-20b, qwen3-8b, qwen-2.5-7b. Source of the beta=0 choice, Qwen 2.5 7B default judge, and parseWinner "Your answer:" fallback.
  - `docs/research/judging_accuracy_20260412.md` — empirical calibration data behind beta=0.
  - **TODO (/research):** search GitHub (PRs/issues/branches) for the original judge-analysis scripts + records that produced these docs, and replicate that experimental harness (fix a set of known A/B pairs, sweep judge model × temperature × reasoning, measure agreement vs ground truth + decisiveness).
- **Match viewer & prompt modifier (ad-hoc integration OK).** Arena admin pages render comparisons: `/admin/evolution/arena/[topicId]` (leaderboard) and entry detail; prompt registry edited via `evolution/src/services/arenaActions.ts` (`listPromptsAction`/`updatePromptAction` on `evolution_prompts`). Need to confirm exact "match viewer" and "prompt modifier" surfaces during /research (likely an invocation/comparison detail view + the prompt registry editor).

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

### Relevant Docs — READ IN FULL during /research
- evolution/docs/README.md ✓
- evolution/docs/rating_and_comparison.md ✓ (judge primitive, 2-pass reversal, confidence table, parseWinner, beta)
- evolution/docs/arena.md ✓ (evolution_arena_comparisons, match persistence, arena pages)
- evolution/docs/data_model.md ✓ (full schema incl. arena_comparisons, metrics, invocations)
- evolution/docs/agents/overview.md ✓ (agent invocation, execution_detail, comparison prompt usage)
- evolution/docs/strategies_and_experiments.md ✓ (judgeModel config, generationTemperature, decisive_rate in run summary)
- evolution/docs/visualization.md ✓ (match viewer surfaces: arena pages, variant Matches tab, invocation detail)
- evolution/docs/logging.md ✓ (per-comparison detail in execution_detail.ranking.comparisons[])
- evolution/docs/metrics.md ✓ (decisive_rate = fraction confidence > 0.6; EAV metrics; dynamic prefixes)
- evolution/docs/architecture.md ✓ (pipeline flow, where judge sits, entry points, scripts)
- evolution/docs/reference.md ✓ (file inventory, CLI scripts, env/kill-switches, error classes, test patterns)
- docs/feature_deep_dives/admin_panel.md ✓ (partial — admin UI structure, hostname split)
- docs/research/judge_agreement_summary_tables.md ✓ (THE historical methodology + result tables)
- docs/research/judging_accuracy_20260412.md ✓ (beta calibration, implied-beta back-solve, scripts list)

### Evolution docs NOT yet read (peripheral to judge-eval; workflow R3.D summarizes cost_optimization/entities/criteria/editing)
- cost_optimization.md, entities.md, criteria_agents.md, editing_agents.md, evolution_metrics.md, curriculum.md, minicomputer_deployment.md, multi_iteration_strategies.md, paragraph_recombine.md, variant_lineage.md

### Past judge-related planning docs (workflow R1.A reading in full)
- docs/planning/estimate_match_noise_evolution_20260411/ (EMPTY on main — recover via git history)
- docs/planning/improve_setup_judging_20260412/
- docs/planning/judge_article_flow_20260209/
- docs/planning/agent_comparison_analysis_evolution_20260225/
- docs/planning/comparison_infrastructure_20260201/
- docs/planning/create_prompt_bank_for_fair_evolution_comparisons_20260202/

## Code Files Read
- _(none yet — populate during /research)_

### Key code files to read in /research
- `evolution/src/lib/comparison.ts` — `compareWithBiasMitigation`, `parseWinner`, `aggregateWinners`
- `evolution/src/lib/shared/reversalComparison.ts` — `run2PassReversal`
- `evolution/src/lib/shared/computeRatings.ts` — `buildComparisonPrompt`
- `evolution/src/lib/shared/rating.ts` — confidence/decisiveness constants
- `evolution/src/lib/shared/comparisonCache.ts` — comparison caching
- `evolution/src/services/arenaActions.ts` — arena + prompt registry server actions
- `evolution/scripts/` — any existing judge-analysis / agreement scripts (search)
