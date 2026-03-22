# Finish Multidb Support For Plan

## Background
PR #750 added multi-DB support to evolution-runner.ts, but PR #757 consolidated scripts into processRunQueue.ts and lost the multi-DB changes. The runner currently only connects to one Supabase DB via createSupabaseServiceClient(). This project restores multi-DB support in processRunQueue.ts, reading staging creds from .env.local and prod creds from .env.evolution-prod (the existing env files on the minicomputer), so the runner round-robin claims runs from both databases.

## Requirements (from GH Issue #NNN)
1. Modify processRunQueue.ts to use dotenv to parse .env.local (staging) and .env.evolution-prod (prod) and build two Supabase clients
2. Add DbTarget/TaggedRun types and round-robin claimBatch logic
3. Update systemd service to point to processRunQueue.ts (currently pointing to nonexistent evolution-runner.ts)
4. Update minicomputer_deployment.md to reflect the actual env file setup
5. Update tests for multi-DB support
6. Verify run 591666e6 gets claimed from staging

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
- `evolution/docs/evolution/minicomputer_deployment.md` - Update env file setup, script name, and verification steps
