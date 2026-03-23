# Metrics Refactor Evolution Plan

## Background
Refactor metrics so there is a standardized metrics table and approach for logging metrics. Different entities (e.g. runs, agent invocations) can log metrics. Metrics can be inherited from children to parents (e.g. via sum). Metrics can have confidence intervals calculated. There are standardized components to A) display metrics on list views and B) display metrics on tab within detail view for an entity - e.g. "metrics" tab attached to a run detail view in evolution.

## Requirements (from GH Issue #NNN)
- Standardized metrics table and approach for logging metrics
- Different entities (e.g. runs, agent invocations) can log metrics
- Metrics can be inherited from children to parents (e.g. via sum)
- Metrics can have confidence intervals calculated
- Standardized component to display metrics on list views
- Standardized component to display metrics on tab within detail view for an entity (e.g. "metrics" tab on run detail view in evolution)

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
No docs in docs/docs_overall/ or docs/feature_deep_dives/ were identified as needing updates.
Evolution docs that may need updates:
- `evolution/docs/evolution/experimental_framework.md` - metrics computation and run summary schema
- `evolution/docs/evolution/strategy_experiments.md` - strategy aggregates and experiment metrics
- `evolution/docs/evolution/visualization.md` - how metrics are rendered in UI
