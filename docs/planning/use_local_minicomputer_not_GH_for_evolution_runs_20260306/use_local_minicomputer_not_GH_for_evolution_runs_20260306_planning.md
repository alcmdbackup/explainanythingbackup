# Use Local Minicomputer Not GH For Evolution Runs Plan

## Background
Migrate evolution batch runner from GitHub Actions to local minicomputer. Currently, evolution pipeline runs are dispatched via GitHub Actions workflows, which has limitations around cost, timeout constraints, and operational flexibility. Running the batch runner locally on a minicomputer would provide unlimited execution time, lower cost, and easier debugging.

## Requirements (from GH Issue #NNN)
1. Set up evolution batch runner on local minicomputer
2. Configure env vars (Supabase, OpenAI, DeepSeek, Pinecone) on minicomputer
3. Replace GitHub Actions workflow dispatch with local cron/systemd service
4. Update dashboard Batch Dispatch card to trigger local runner instead of GH Actions
5. Ensure heartbeat/watchdog still works for local runs
6. Update docs to reflect new local runner setup

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
- `docs/docs_overall/environments.md` - Add local minicomputer environment details
