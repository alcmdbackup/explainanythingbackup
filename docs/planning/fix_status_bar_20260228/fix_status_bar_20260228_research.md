# Fix Status Bar Research

## Problem Statement
The Claude Code status bar remains visible but certain items within it disappear on session disconnect/reconnect or on context compaction. Individual fields (project name, branch, context %, cost) lose their values or show fallback/empty content, while the bar itself stays rendered.

## Requirements (from GH Issue #592)
The status bar stays visible but certain items within it disappear on session disconnect/reconnect or on context compaction. Investigate why specific fields lose their values. Use Github PR history to see how status bar changes were implemented (PR #561, merged 2026-02-25).

## High Level Summary

The statusline script (`~/.claude/statusline.sh`) receives JSON session data via stdin on each assistant message (debounced 300ms). When certain JSON fields arrive as `null` or empty — which happens during disconnect/reconnect and context compaction — the script's fallback logic produces empty or placeholder values for those fields.

### Root Causes Identified

1. **Null JSON fields on compaction**: After context compaction, `context_window.used_percentage` and `cost.total_cost_usd` may reset to 0 or arrive as `null`. The script handles null with `// 0` fallback in jq, but this shows `0%` and `$0.00` instead of the previous valid values — appearing as "disappeared" data.

2. **Null JSON fields on disconnect/reconnect**: When a session reconnects, the JSON may temporarily contain `null` for `workspace.current_dir`. The script checks `[ -z "$DIR" ] || [ ! -d "$DIR" ]` and outputs `[no workspace]`, replacing the normal two-line output with a single error line — losing project, branch, context, and cost fields.

3. **Git branch cache per-worktree**: Cache file is keyed by `basename "$DIR"`. If `DIR` changes or is null on reconnect, the cache key changes and a fresh (possibly empty) branch lookup occurs.

4. **No persistence of last-known-good values**: The script is stateless — each invocation reads fresh JSON and outputs fresh results. There's no mechanism to fall back to previously displayed values when current data is incomplete.

### Known Upstream Issues
- [anthropics/claude-code#29383](https://github.com/anthropics/claude-code/issues/29383) — Status line disappears after briefly appearing
- [anthropics/claude-code#20002](https://github.com/anthropics/claude-code/issues/20002) — Status line disappears during "accept edits?" prompt
- [ruvnet/claude-flow#1079](https://github.com/ruvnet/claude-flow/issues/1079) — Statusline metrics disappear after context compacting

### Claude Code Statusline Behavior (from official docs)
- Script runs after each assistant message, permission mode change, or vim mode toggle
- Updates debounced at 300ms; in-flight script cancelled if new update triggers
- `context_window.used_percentage` may be `null` early in session or after compaction
- `context_window.current_usage` is `null` before first API call
- Scripts that exit non-zero or produce no output cause status line to go blank
- Status line temporarily hides during autocomplete, help menu, and permission prompts

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
- https://code.claude.com/docs/en/statusline.md — Official statusline API reference

## Code Files Read
- `~/.claude/statusline.sh` — 55-line bash script, reads JSON stdin, outputs 2 lines with ANSI colors
- `.claude/settings.json` — statusLine config at lines 71-74 (`type: command`, `command: ~/.claude/statusline.sh`)
- `docs/docs_overall/managing_claude_settings.md` — Status Line Configuration section (lines 170-217)

## Key Findings

1. **The script has no state persistence** — each invocation is fully independent. When JSON arrives with null/reset fields, the script outputs degraded content with no way to show previous values.

2. **jq `// 0` fallback masks the issue** — null percentage shows as `0%`, null cost shows as `$0.00`, making it look like data "disappeared" rather than errored.

3. **The `[no workspace]` early-exit path** replaces the entire two-line output with one line, causing all fields to vanish simultaneously when `workspace.current_dir` is null.

4. **Git branch caching is per-worktree** (keyed by directory basename) with 5s TTL and atomic writes — this part is robust.

5. **Official docs confirm** that `used_percentage` and `current_usage` can be `null` early in session and potentially after compaction. The script should handle these cases gracefully.

## Open Questions

1. Which specific fields does the user observe disappearing? (project name? context %? cost? branch? all?)
2. Does the bar show `[no workspace]` when items disappear, or does it show the normal layout with some fields blank/zero?
3. Is this reproducible consistently on every compaction, or intermittent?
