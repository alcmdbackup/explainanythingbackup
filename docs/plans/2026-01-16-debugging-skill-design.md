# Debugging Skill Design

**Date**: 2026-01-16
**Status**: Approved
**Branch**: feat/debugging_skill_command_proposal_20260116

## Overview

Create a project-specific debugging skill that extends `superpowers:systematic-debugging` with ExplainAnything's observability tools. The skill auto-detects environment (local vs deployed) and guides users through systematic debugging with project-specific tooling.

## Design Principles

1. **Append-only extension** - Include entire systematic-debugging verbatim, add project-specific appendix
2. **Environment-aware** - Auto-detect local (tmux) vs deployed (Sentry/Honeycomb)
3. **Request ID as correlation key** - Universal identifier across all systems
4. **MCP tool orchestration** - Guide users to appropriate tools per debugging phase

## File Structure

```
.claude/
├── commands/
│   └── debug.md           # User-invocable command (brief, links to skill)
└── skills/
    └── debug/
        └── SKILL.md       # Full skill with methodology + project tools
```

## Skill Structure

### Part 1: Systematic Debugging (Verbatim Copy)

Include the entire `superpowers:systematic-debugging` content unchanged:

- Overview ("Random fixes waste time...")
- The Iron Law ("NO FIXES WITHOUT ROOT CAUSE...")
- When to Use (list of scenarios)
- The Four Phases:
  - Phase 1: Root Cause Investigation
  - Phase 2: Pattern Analysis
  - Phase 3: Hypothesis and Testing
  - Phase 4: Implementation
- Red Flags - STOP and Follow Process
- User Signals You're Doing It Wrong
- Common Rationalizations (table)
- Quick Reference (table)
- When Process Reveals "No Root Cause"
- Supporting Techniques

### Part 2: Project-Specific Appendix

Add these sections after the systematic-debugging content:

---

## Environment Detection

Before debugging, determine your environment:

```bash
# Check for local tmux instance
if ls /tmp/claude-instance-*.json 2>/dev/null | grep -q "$(pwd)"; then
    echo "LOCAL DEVELOPMENT - use tmux logs"
else
    echo "DEPLOYED - use Sentry/Honeycomb MCP"
fi
```

| Environment | Detection | Primary Tools |
|-------------|-----------|---------------|
| Local Dev | `/tmp/claude-instance-*.json` exists for this project | tmux, server.log, grep |
| Deployed | No instance file | Sentry MCP, Supabase MCP, Honeycomb MCP |

---

## Local Development Debugging

### Find Your Instance
```bash
ID=$(cat /tmp/claude-instance-*.json 2>/dev/null | jq -r 'select(.project_root == "'$(pwd)'") | .instance_id')
echo "Instance: $ID"
```

### View Server Logs
```bash
# Last 200 lines from tmux
tmux capture-pane -t claude-${ID}-backend -p -S -200

# Or from log file
tail -200 server-${ID}.log
```

### Search for Errors
```bash
grep -i "error\|exception\|failed" server-${ID}.log | tail -50
```

### Search by Request ID
```bash
grep "client-XXXXX" server-${ID}.log | jq .
```

### Real-time Monitoring
```bash
tail -f server-${ID}.log
```

---

## Deployed Environment Debugging

### Find Recent Errors (Sentry)
```
mcp__plugin_sentry_sentry__search_issues(
  organizationSlug='minddojo',
  naturalLanguageQuery='unresolved errors in last 24 hours'
)
```

### Get Issue Details
```
mcp__plugin_sentry_sentry__get_issue_details(
  organizationSlug='minddojo',
  issueId='EXPLAINANYTHING-XXX'
)
```

### AI Root Cause Analysis
```
mcp__plugin_sentry_sentry__analyze_issue_with_seer(
  organizationSlug='minddojo',
  issueId='EXPLAINANYTHING-XXX'
)
```

### Check Service Logs (Supabase)
```
mcp__supabase__get_logs(service='api')      # API gateway
mcp__supabase__get_logs(service='postgres') # Database
mcp__supabase__get_logs(service='auth')     # Authentication
```

---

## Request ID Correlation

The `requestId` is your universal correlation key across all systems.

### Finding Request ID

| Source | How to Find |
|--------|-------------|
| Browser Console | Look for `client-{timestamp}-{random}` format |
| Sentry Issue | Check `requestId` tag in issue details |
| Server Logs | `grep "client-" server.log \| head -20` |
| User Report | Ask for timestamp, reconstruct from logs |

### Tracing Across Systems

Once you have the requestId:

**Local:**
```bash
grep "client-1704067200000-abc123" server-${ID}.log | jq .
```

**Sentry:**
```
mcp__plugin_sentry_sentry__search_events(
  organizationSlug='minddojo',
  naturalLanguageQuery='events with requestId client-1704067200000-abc123'
)
```

---

## MCP Tools Quick Reference

| Tool | Purpose | Example |
|------|---------|---------|
| `search_issues` | Find grouped errors | Recent unresolved issues |
| `get_issue_details` | Stacktrace, context | Deep dive on specific issue |
| `analyze_issue_with_seer` | AI root cause | Automated hypothesis |
| `search_events` | Individual events, counts | "How many errors today" |
| `get_logs` (Supabase) | Service logs | API, postgres, auth logs |
| `browser_snapshot` | Page state | Reproduce UI issues |
| `browser_console_messages` | JS errors | Client-side debugging |

---

## Sub-Commands

| Command | Purpose | Implementation |
|---------|---------|----------------|
| `/debug` | Full guided workflow | Detect env → Phase 1-4 |
| `/debug logs` | Quick log access | Local: tmux, Deployed: Supabase |
| `/debug errors` | Search recent errors | Local: grep, Deployed: Sentry |
| `/debug trace <requestId>` | Trace specific request | Search all systems by ID |
| `/debug sentry <issueId>` | Analyze Sentry issue | get_issue_details + seer |

---

## Skill Auto-Invocation Triggers

The skill description should trigger on keywords:
- "debug", "debugging", "investigate"
- "error", "bug", "broken", "not working"
- "why is this failing", "what went wrong"
- "trace", "logs", "stacktrace"

---

## Files to Create

1. **`.claude/skills/debug/SKILL.md`** - Full skill (systematic-debugging + appendix)
2. **`.claude/commands/debug.md`** - Brief command that invokes the skill
3. **`docs/feature_deep_dives/debugging_skill.md`** - Documentation update

## Testing Plan

1. Test local detection: Run with tmux instance present
2. Test deployed detection: Run without instance file
3. Test sub-commands: `/debug logs`, `/debug errors`
4. Verify Sentry MCP integration works
5. Verify Supabase MCP log access works
