# Debug Run Not Resuming Prod Plan

## Background
An evolution run in production is failing to resume from checkpoint/continuation_pending state. The run was executing the evolution pipeline, hit the Vercel timeout limit, and correctly checkpointed state and transitioned to continuation_pending. However, the cron runner is not picking up the run for resume on subsequent cycles, leaving it stuck.

## Requirements (from GH Issue #NNN)
- Investigate why the cron runner is not claiming and resuming evolution runs stuck in continuation_pending status
- Check the claim_evolution_run RPC to verify it correctly prioritizes continuation_pending runs (priority 0 vs pending priority 1)
- Verify the cron endpoint is firing and authenticating correctly
- Check for any watchdog recovery that might be interfering (e.g., marking the run failed instead of recovering it)
- Identify and fix the root cause preventing run resumption
- Verify the fix works in production

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
- `evolution/docs/evolution/architecture.md` - May need updates to checkpoint/resume documentation
- `evolution/docs/evolution/reference.md` - May need config or RPC documentation updates
- `evolution/docs/evolution/data_model.md` - May need status transition documentation updates
- `docs/feature_deep_dives/error_handling.md` - May need new error recovery patterns
- `docs/feature_deep_dives/debugging_skill.md` - May add debugging tips for this scenario
