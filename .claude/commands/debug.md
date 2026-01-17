# Debug Command

Invoke the project debugging skill to systematically debug issues in this codebase.

## Usage

```
/debug              # Full guided debugging workflow
/debug logs         # Quick access to server logs
/debug errors       # Search recent errors
/debug trace <id>   # Trace by request ID
/debug sentry <id>  # Analyze specific Sentry issue
```

## Instructions

**YOU MUST** invoke the `debug` skill using the Skill tool to load the full debugging methodology:

```
Skill(skill="debug")
```

The skill contains:
1. Complete systematic debugging methodology (4 phases)
2. Project-specific tools for local and deployed environments
3. MCP tool guidance for Sentry, Supabase, Playwright
4. Request ID correlation techniques

## Sub-Command Handling

If the user provided arguments, parse them:

- **No args (`/debug`)**: Run full guided workflow from skill
- **`logs`**: Jump to "Local Development Debugging" or "Deployed Environment Debugging" section
- **`errors`**: Search for recent errors using environment-appropriate tools
- **`trace <requestId>`**: Use "Request ID Correlation" section to trace the ID
- **`sentry <issueId>`**: Use `get_issue_details` + `analyze_issue_with_seer` for the issue

## Key Principle

From the skill:

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

Always complete Phase 1 (Root Cause Investigation) before proposing any fixes.
