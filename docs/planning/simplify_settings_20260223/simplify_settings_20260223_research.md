# Simplify Settings Research

## Problem Statement
Simplify the Claude Code project settings by removing redundant granular Bash permission entries that are unnecessary when sandbox mode with `autoAllowBashIfSandboxed: true` is enabled. The current settings have 146+ allow-list entries, many of which are individual Bash command patterns that the sandbox auto-approval already covers. This will make the settings cleaner, easier to maintain, and consistently rely on the sandbox as the safety mechanism.

## Requirements (from GH Issue #TBD)
- Remove redundant `Bash(...)` entries from the permissions allow-list that are auto-approved by sandbox
- Keep non-Bash permissions (MCP tools, WebFetch, Edit/Write/Read patterns, Skills, Playwright)
- Keep the deny-list as-is (it overrides sandbox auto-approval for dangerous commands)
- Enable sandbox + autoAllowBashIfSandboxed in settings.local.json
- Verify the simplified settings work correctly

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (none selected)

## Code Files Read
- .claude/settings.json
- .claude/settings.local.json
