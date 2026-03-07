# Investigate Evolution Run 27fea0a3 Plan

## Background
Run 27fea0a3 exceeded budget in production and its results may not have synced to the Arena. The pipeline reported `sync_to_arena RPC failed (non-fatal)` with a foreign key constraint violation on `evolution_arena_entries`. Need to investigate the budget exhaustion cause, diagnose the Arena sync failure, and determine if results need manual recovery.

## Requirements (from GH Issue #NNN)
1. Investigate budget exhaustion cause via budget_events audit log
2. Diagnose sync_to_arena RPC failure and FK constraint violation
3. Determine if results were partially synced or fully lost
4. Fix any bugs found
5. Re-sync results to arena if needed

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
- `evolution/docs/evolution/visualization.md` - May need updates if visualization changes are made
- `evolution/docs/evolution/reference.md` - May need updates if config/budget behavior changes
- `evolution/docs/evolution/architecture.md` - May need updates if pipeline flow changes
- `evolution/docs/evolution/data_model.md` - May need updates if schema changes
- `evolution/docs/evolution/rating_and_comparison.md` - May need updates if rating sync changes
- `evolution/docs/evolution/agents/overview.md` - May need updates if agent behavior changes
- `evolution/docs/evolution/arena.md` - Likely needs updates if arena sync is fixed
- `evolution/docs/evolution/cost_optimization.md` - May need updates if budget handling changes
- `docs/docs_overall/debugging.md` - May need updates with new debugging queries
- `evolution/docs/evolution/agents/generation.md` - May need updates if generation behavior changes
