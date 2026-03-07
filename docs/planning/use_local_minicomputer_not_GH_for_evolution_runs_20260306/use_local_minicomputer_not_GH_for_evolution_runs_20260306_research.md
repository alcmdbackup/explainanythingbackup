# Use Local Minicomputer Not GH For Evolution Runs Research

## Problem Statement
Migrate evolution batch runner from GitHub Actions to local minicomputer. Currently, evolution pipeline runs are dispatched via GitHub Actions workflows, which has limitations around cost, timeout constraints, and operational flexibility. Running the batch runner locally on a minicomputer would provide unlimited execution time, lower cost, and easier debugging.

## Requirements (from GH Issue #NNN)
1. Set up evolution batch runner on local minicomputer
2. Configure env vars (Supabase, OpenAI, DeepSeek, Pinecone) on minicomputer
3. Replace GitHub Actions workflow dispatch with local cron/systemd service
4. Update dashboard Batch Dispatch card to trigger local runner instead of GH Actions
5. Ensure heartbeat/watchdog still works for local runs
6. Update docs to reflect new local runner setup

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/environments.md

### Evolution Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/strategy_experiments.md

## Code Files Read
- [list of code files reviewed]
