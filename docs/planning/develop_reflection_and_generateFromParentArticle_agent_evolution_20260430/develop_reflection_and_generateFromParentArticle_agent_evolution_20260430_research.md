# Develop Reflection and GenerateFromParentArticle Agent Evolution Research

## Problem Statement
I want to create a new agent type called "reflection and generate from Parent"

## Requirements (from GH Issue #NNN)
- Overview
    - This will be a new agent type
    - This will add a new reflection step in from of generateFromPreviousArticle
    - Please extend our existing agent code to make this code as much as possible
    - Re-use existing generateFromPreviousArticle in a modular way as much as possible
- Prompt
    - Read the existing parent
    - Pass in existing list of tactics, a brief summary of each, and the relative elo boosts of each based on performance data
        - Randomize the order with which tactics are passed in to prevent positional bias
    - Pick the best tactic to apply
- Pick the best tactic to use
    - Configurable input for # of tactics to try to apply
- Then call generateFromPreviousArticle

How should this work?

- All of this will be one agent, called reflectAndGenerateFromPreviousArticle
- Lightly modify same re-usable components for invocation details - see below for details

Existing details overview

- Reflection Overview - separate tab for reflection portion
- GenerateFromPreviousArticle Overview - re-use the existing tab for generateFromPreviousArticle
- Metrics - no change, only generateFromPreviousArticle produces metrics anyway
- Timeline - show additional calls used by reflection
- Logs - show logs from both

## High Level Summary
[Summary of findings]

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/agents/overview.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/sample_content/api_design_sections.md
- evolution/docs/sample_content/filler_words.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md
- docs/feature_deep_dives/multi_iteration_strategies.md
- docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/variant_lineage.md

## Code Files Read
- [list of code files reviewed]
