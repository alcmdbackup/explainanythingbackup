# Fix Sandbox Settings Plan

## Background
Getting `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` errors when Claude Code runs bash commands in sandbox mode. Commands fail with exit code 1 even for simple operations like `git status` and `mkdir`. Need to understand what causes this error and how to fix the sandbox configuration.

## Requirements (from GH Issue #TBD)
- Understand the `bwrap` (bubblewrap) loopback error and what triggers it
- Fix the sandbox settings so commands run reliably without needing `dangerouslyDisableSandbox`

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
- `docs/docs_overall/managing_claude_settings.md` - May need sandbox troubleshooting section
- `docs/docs_overall/environments.md` - May need sandbox config notes
- `docs/docs_overall/testing_overview.md` - May need sandbox-related test notes
- `docs/feature_deep_dives/testing_setup.md` - May need sandbox config for test environments
