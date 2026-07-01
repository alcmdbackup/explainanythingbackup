# Analyze Performance Self Critique Agent Research

## Problem Statement
Run an experiment to analyze and understand performance of self critique driven agent.

## Requirements (from GH Issue #NNN)
Same as summary.

## High Level Summary
[To be populated by /research]

Context (auto-captured at /initialize): `SelfCritiqueReviseAgent` was just landed by the sibling project `brainstorm_new_agents_with_reflection_20260630` (see `evolution/docs/agents/overview.md` § SelfCritiqueReviseAgent). It is a wrapper agent that (a) runs ONE reflection LLM call outputting a free-form `ChangeKind + Summary + Plan` block and (b) feeds the sanitized + nonce-fenced `summary + plan` as a `customPrompt` into `GenerateFromPreviousArticleAgent.execute()`. Marker tactic `self_critique_driven`. Selected per-iteration via `IterationConfig.agentType: 'self_critique_revise'` (first-iteration allowed). Per the design deep dive, ~$0.005/variant total (~1× GFPA + ~15% reflection premium).

This project is a **Pattern 2 pure validation** experiment: no new feature, no code changes to the agent under test. Goal is to compare the self-critique agent to a baseline (default GFPA / `generate` iteration) on Elo, cost, eloPerDollar, and any secondary signals of interest (e.g. `changeKind` distribution, high-Elo behavior above the `SELF_CRITIQUE_HIGH_ELO_THRESHOLD=1300` gate).

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

### Relevant Docs (auto-included evolution docs + supplemental)
- evolution/docs/strategies_and_experiments.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- docs/feature_deep_dives/judge_evaluation.md
- docs/feature_deep_dives/llm_spending_gate.md
- docs/docs_overall/llm_provider_limits.md

## Code Files Read
- evolution/docs/agents/overview.md § SelfCritiqueReviseAgent (context capture)
