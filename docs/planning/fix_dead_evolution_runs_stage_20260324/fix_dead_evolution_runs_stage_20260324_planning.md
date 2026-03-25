# Fix Dead Evolution Runs Stage Plan

## Background
Evolution runs on stage are dying during finalization due to a runner_id mismatch between processRunQueue.ts (which claims runs) and executeV2Run (which finalizes them). The claim RPC sets runner_id to 'v2-hostname-pid-timestamp' but executeV2Run hardcodes 'legacy-runId', causing the finalization UPDATE to match 0 rows. Additionally, executeV2Run should be fully deprecated since claimAndExecuteRun handles the full lifecycle correctly.

## Requirements (from GH Issue #TBD)
1. Fix runner_id mismatch: processRunQueue.ts passes RUNNER_ID to claim but executeV2Run hardcodes 'legacy-runId' for finalization
2. Deprecate executeV2Run: migrate processRunQueue.ts to use claimAndExecuteRun directly
3. Remove executeV2Run if no other callers exist
4. Update evolution/docs/architecture.md and minicomputer_deployment.md to reflect changes
5. Add/update unit tests for the affected code paths
6. Verify fix on stage by re-running a failed evolution run

## Problem
[3-5 sentences describing the problem -- refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/architecture.md` - File paths and entry point descriptions need updating to match actual code structure
- `evolution/docs/minicomputer_deployment.md` - processRunQueue.ts usage docs may need updating if switching to claimAndExecuteRun
- `docs/docs_overall/debugging.md` - No changes expected
- `docs/docs_overall/testing_overview.md` - No changes expected
- `docs/docs_overall/environments.md` - No changes expected
