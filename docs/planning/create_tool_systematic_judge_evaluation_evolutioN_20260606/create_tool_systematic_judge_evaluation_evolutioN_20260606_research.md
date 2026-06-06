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
