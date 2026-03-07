# Docs Update Evolution Plan

## Background
Update all 16 evolution pipeline documentation files to ensure they accurately reflect the current codebase. Additionally, deprecate all references to the L8 orthogonal array / Taguchi fractional factorial experimentation system, as the project has switched to a manual experimentation approach.

## Requirements (from GH Issue #NNN)
- Update all 16 evolution docs (under `evolution/docs/evolution/`) to match current codebase state
- Deprecate L8/Taguchi fractional factorial experimentation references in `strategy_experiments.md`
- Update `strategy_experiments.md` to reflect the manual experimentation system
- Update any cross-references to L8 experimentation in other evolution docs (architecture.md, reference.md, cost_optimization.md, etc.)
- Ensure all file paths, test counts, migration lists, and configuration values are current
- Verify all cross-doc links are valid

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
- `evolution/docs/evolution/README.md` - Index and reading order
- `evolution/docs/evolution/architecture.md` - Pipeline orchestration
- `evolution/docs/evolution/data_model.md` - Core primitives
- `evolution/docs/evolution/rating_and_comparison.md` - Rating system
- `evolution/docs/evolution/arena.md` - Cross-method comparison
- `evolution/docs/evolution/cost_optimization.md` - Cost tracking
- `evolution/docs/evolution/visualization.md` - Dashboard components
- `evolution/docs/evolution/entity_diagram.md` - ER diagram
- `evolution/docs/evolution/strategy_experiments.md` - L8 deprecation, manual experimentation
- `evolution/docs/evolution/reference.md` - Config, flags, schema, files
- `evolution/docs/evolution/agents/overview.md` - Agent framework
- `evolution/docs/evolution/agents/generation.md` - Generation agents
- `evolution/docs/evolution/agents/editing.md` - Editing agents
- `evolution/docs/evolution/agents/tree_search.md` - Tree search
- `evolution/docs/evolution/agents/support.md` - Support agents
- `evolution/docs/evolution/agents/flow_critique.md` - Flow critique
- `docs/docs_overall/instructions_for_updating.md` - Doc maintenance guidelines
