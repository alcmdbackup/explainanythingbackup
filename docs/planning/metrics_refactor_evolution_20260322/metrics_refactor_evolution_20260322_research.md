# Metrics Refactor Evolution Research

## Problem Statement
Refactor metrics so there is a standardized metrics table and approach for logging metrics. Different entities (e.g. runs, agent invocations) can log metrics. Metrics can be inherited from children to parents (e.g. via sum). Metrics can have confidence intervals calculated. There are standardized components to A) display metrics on list views and B) display metrics on tab within detail view for an entity - e.g. "metrics" tab attached to a run detail view in evolution.

## Requirements (from GH Issue #NNN)
- Standardized metrics table and approach for logging metrics
- Different entities (e.g. runs, agent invocations) can log metrics
- Metrics can be inherited from children to parents (e.g. via sum)
- Metrics can have confidence intervals calculated
- Standardized component to display metrics on list views
- Standardized component to display metrics on tab within detail view for an entity (e.g. "metrics" tab on run detail view in evolution)

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs (primary relevance)
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/rating_and_comparison.md

### Code Files Read
- evolution/src/experiments/evolution/experimentMetrics.ts
- evolution/src/components/evolution/tabs/MetricsTab.tsx
