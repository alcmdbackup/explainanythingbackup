# Create Tool Systematic Judge Evaluation (Evolution) Research

## Problem Statement
Create a new tool that helps systematically evaluate judge performance. The "judge" is the LLM that performs pairwise (A/B/TIE) comparisons of text variants in the evolution arena, producing winner verdicts and confidence/decisiveness scores that drive the Elo ratings. Today judge quality is studied ad-hoc; there's no repeatable tool to log match history, record the exact judge settings used, and measure whether custom prompt / temperature / added reasoning improves the decisiveness rate. This project builds that tool, storing results in a structured, retrievable way (keyed by judge settings) and replicating the methodology of the historical judge analyses already done in this repo and on GitHub.

## Requirements (from GH Issue #NNN)
- Keep logs of match history
- Record settings used
- Test out if custom prompt/temperature/adding reasoning improves decisiveness rate
- Figure out how to store results in a structured way for later retrieval, including judging settings used
- Look at historical judge analysis, and see what we can learn from the methodology there
- How should this interact with match viewer and prompt modifier?
    - OK if this is adhoc
- Base this on the past judge analyses that have been done. Look at Github to find the historical records of the judge analyses that were done and try to replicate the methodology.

## High Level Summary
_(populate during /research)_

Initial orientation from doc reads during /initialize:

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

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- docs/feature_deep_dives/admin_panel.md (partial)
- docs/research/judge_agreement_summary_tables.md _(to read in /research — historical methodology)_
- docs/research/judging_accuracy_20260412.md _(to read in /research — calibration data)_
- evolution/docs/visualization.md _(to read in /research — match viewer surfaces)_
- evolution/docs/strategies_and_experiments.md _(to read in /research — judgeModel config)_
- evolution/docs/agents/overview.md _(to read in /research — execution_detail)_
- evolution/docs/metrics.md _(to read in /research — decisiveness metric storage)_
- evolution/docs/logging.md _(to read in /research — per-comparison logging)_

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
