# Debugging Skill

## Overview

The debugging skill provides a systematic methodology for debugging issues in the ExplainAnything codebase. It extends the `superpowers:systematic-debugging` methodology with project-specific tooling for both local development and deployed environments.

**Core Principle**: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

## Key Files

| File | Purpose |
|------|---------|
| `.claude/skills/debug/SKILL.md` | Full debugging skill with methodology + project tools |
| `.claude/commands/debug.md` | User-invocable command that invokes the skill |
| `docs/plans/2026-01-16-debugging-skill-design.md` | Original design document |

## Usage

### Command Invocation

```
/debug              # Full guided debugging workflow
/debug logs         # Quick access to server logs
/debug errors       # Search recent errors
/debug trace <id>   # Trace by request ID
/debug sentry <id>  # Analyze specific Sentry issue
```

### Auto-Invocation

The skill automatically triggers on keywords like:
- "debug", "debugging", "investigate"
- "error", "bug", "broken", "not working"
- "why is this failing", "what went wrong"

## The Four Phases

The skill enforces a systematic 4-phase approach:

| Phase | Purpose | Project Tools |
|-------|---------|---------------|
| **1. Root Cause Investigation** | Understand WHAT and WHY | tmux logs, Sentry search, grep |
| **2. Pattern Analysis** | Find working examples, compare | Request ID correlation |
| **3. Hypothesis & Testing** | Form theory, test minimally | Seer AI analysis |
| **4. Implementation** | Create test, fix, verify | Playwright verification |

## Environment Detection

The skill auto-detects the environment:

```bash
# Local development detected when this file exists for current project:
/tmp/claude-instance-{id}.json
```

| Environment | Primary Tools |
|-------------|---------------|
| **Local Dev** | tmux capture-pane, server.log, grep |
| **Deployed** | Sentry MCP, Supabase MCP, Honeycomb MCP |

## Request ID Correlation

The `requestId` is the universal correlation key across all systems:

- **Format**: `client-{timestamp}-{6-char-random}` (e.g., `client-1704067200000-abc123`)
- **Sources**: Browser console, Sentry tags, server.log, user reports
- **Usage**: Search logs, Sentry events, Honeycomb traces by this ID

## MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp__plugin_sentry_sentry__search_issues` | Find grouped errors |
| `mcp__plugin_sentry_sentry__get_issue_details` | Get stacktrace and context |
| `mcp__plugin_sentry_sentry__analyze_issue_with_seer` | AI root cause analysis |
| `mcp__supabase__get_logs` | Service logs (api, postgres, auth) |
| `mcp__plugin_playwright_playwright__browser_*` | UI reproduction and verification |

## Local Development Commands

```bash
# Find instance
ID=$(cat /tmp/claude-instance-*.json | jq -r 'select(.project_root == "'$(pwd)'") | .instance_id')

# View logs
tmux capture-pane -t claude-${ID}-backend -p -S -200

# Search errors
grep -i "error\|exception" server-${ID}.log | tail -50

# Search by request ID
grep "client-XXXXX" server-${ID}.log | jq .
```

## Related Documentation

- [Request Tracing & Observability](./request_tracing_observability.md)
- [Testing Overview](../docs_overall/testing_overview.md)
- [Environments](../docs_overall/environments.md)
- [tmux Usage](../planning/tmux_usage/using_tmux_recommendations.md)
