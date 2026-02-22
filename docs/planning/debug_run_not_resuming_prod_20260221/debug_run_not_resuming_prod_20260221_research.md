# Debug Run Not Resuming Prod Research

## Problem Statement
An evolution run in production is failing to resume from checkpoint/continuation_pending state. The run was executing the evolution pipeline, hit the Vercel timeout limit, and correctly checkpointed state and transitioned to continuation_pending. However, the cron runner is not picking up the run for resume on subsequent cycles, leaving it stuck.

## Requirements (from GH Issue #NNN)
- Investigate why the cron runner is not claiming and resuming evolution runs stuck in continuation_pending status
- Check the claim_evolution_run RPC to verify it correctly prioritizes continuation_pending runs (priority 0 vs pending priority 1)
- Verify the cron endpoint is firing and authenticating correctly
- Check for any watchdog recovery that might be interfering (e.g., marking the run failed instead of recovering it)
- Identify and fix the root cause preventing run resumption
- Verify the fix works in production

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/data_model.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/debugging_skill.md

## Code Files Read
- [list of code files reviewed]
