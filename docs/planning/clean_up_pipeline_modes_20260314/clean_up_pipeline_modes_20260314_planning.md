# Clean Up Pipeline Modes Plan

## Background
Eliminate the 'minimal' and 'batch' pipeline types from the PipelineType union. 'batch' is only a metadata label never set at execution time, and 'minimal' is only used for local CLI default and integration tests — not in production. Remove these types and any dependent code that isn't useful elsewhere.

## Requirements (from GH Issue #NNN)
Eliminate these types and any code dependent on it that isn't useful elsewhere.

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - PipelineType definition
- `evolution/docs/evolution/architecture.md` - Three pipeline modes section
- `evolution/docs/evolution/reference.md` - Pipeline type references throughout
- `evolution/docs/evolution/cost_optimization.md` - Strategy presets with pipeline_type
- `evolution/docs/evolution/visualization.md` - Pipeline type UI display
- `evolution/docs/evolution/agents/overview.md` - Agent interaction references
