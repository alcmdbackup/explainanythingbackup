# Clean Up Pipeline Modes Research

## Problem Statement
Eliminate the 'minimal' and 'batch' pipeline types from the PipelineType union. 'batch' is only a metadata label never set at execution time, and 'minimal' is only used for local CLI default and integration tests — not in production. Remove these types and any dependent code that isn't useful elsewhere.

## Requirements (from GH Issue #NNN)
Eliminate these types and any code dependent on it that isn't useful elsewhere.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/agents/overview.md

## Code Files Read
- [list of code files reviewed]
