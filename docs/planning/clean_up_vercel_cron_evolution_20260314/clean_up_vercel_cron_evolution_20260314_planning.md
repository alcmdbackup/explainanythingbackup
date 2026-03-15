# Clean Up Vercel Cron Evolution Plan

## Background
Remove Vercel-specific cron infrastructure for evolution pipeline (cron entries in vercel.json, EVOLUTION_CRON_ENABLED gate, legacy cron re-export route) since evolution now runs exclusively on the local minicomputer. Keep the timeout/continuation system and admin UI POST endpoint intact.

## Requirements (from GH Issue #NNN)
1. Remove evolution cron entries from vercel.json
2. Remove EVOLUTION_CRON_ENABLED gate and cron-specific auth from /api/evolution/run route
3. Remove legacy /api/cron/evolution-runner re-export route
4. Remove evolution-watchdog cron entry from vercel.json (if minicomputer handles this)
5. Keep admin UI POST endpoint functional
6. Keep timeout/continuation system intact
7. Update all affected docs (minicomputer_deployment.md, reference.md, architecture.md, environments.md, etc.)

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
- `evolution/docs/evolution/minicomputer_deployment.md` - Remove "Fallback: Re-enable Vercel Cron" section
- `evolution/docs/evolution/reference.md` - Update continuation-passing and deployment sections
- `docs/docs_overall/environments.md` - Update Vercel cron references
- `evolution/docs/evolution/architecture.md` - Update Runner Comparison table and continuation flow
- `evolution/docs/evolution/cost_optimization.md` - Update "Runs execute via Vercel serverless" reference
- `evolution/docs/evolution/experimental_framework.md` - Update experiment-driver cron reference
- `evolution/docs/evolution/data_model.md` - Update continuation_pending status description
- `evolution/docs/evolution/visualization.md` - Minor Vercel references if any
- `evolution/docs/evolution/rating_and_comparison.md` - Likely no changes needed
- `evolution/docs/evolution/arena.md` - Likely no changes needed
