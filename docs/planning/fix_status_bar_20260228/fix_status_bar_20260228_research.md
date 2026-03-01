# Fix Status Bar Research

## Problem Statement
The status bar sometimes disappears on session disconnect and reconnect or on compaction. Can't tell exact cause but please investigate why it might do this.

## Requirements (from GH Issue #NNN)
The status bar sometimes disappears on session disconnect and reconnect or on compaction. Can't tell exact cause but please investigate why it might do this. Use Github PR history to see how status bar changes were implemented. Changes were in past few days.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (none selected)

### Key References
- PR #561 — feat: add statusline showing worktree, branch, project, context %, cost (merged 2026-02-25)
- `~/.claude/statusline.sh` — the statusline script
- `.claude/settings.json:71-74` — statusLine configuration
- `docs/docs_overall/managing_claude_settings.md:170-217` — Status Line Configuration docs

## Code Files Read
- [list of code files reviewed]
