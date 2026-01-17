---
name: debug
description: Use when encountering any bug, test failure, or unexpected behavior in this project, before proposing fixes
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Manager wants it fixed NOW (systematic is faster than thrashing)

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - Does it happen every time?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather Evidence in Multi-Component Systems**

   **WHEN system has multiple components (CI → build → signing, API → service → database):**

   **BEFORE proposing fixes, add diagnostic instrumentation:**
   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify failing component
   THEN investigate that specific component
   ```

   **Example (multi-layer system):**
   ```bash
   # Layer 1: Workflow
   echo "=== Secrets available in workflow: ==="
   echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

   # Layer 2: Build script
   echo "=== Env vars in build script: ==="
   env | grep IDENTITY || echo "IDENTITY not in environment"

   # Layer 3: Signing script
   echo "=== Keychain state: ==="
   security list-keychains
   security find-identity -v

   # Layer 4: Actual signing
   codesign --sign "$IDENTITY" --verbose=4 "$APP"
   ```

   **This reveals:** Which layer fails (secrets → workflow ✓, workflow → build ✗)

5. **Trace Data Flow**

   **WHEN error is deep in call stack:**

   See `root-cause-tracing.md` in this directory for the complete backward tracing technique.

   **Quick version:**
   - Where does bad value originate?
   - What called this with bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find Working Examples**
   - Locate similar working code in same codebase
   - What works that's similar to what's broken?

2. **Compare Against References**
   - If implementing pattern, read reference implementation COMPLETELY
   - Don't skim - read every line
   - Understand the pattern fully before applying

3. **Identify Differences**
   - What's different between working and broken?
   - List every difference, however small
   - Don't assume "that can't matter"

4. **Understand Dependencies**
   - What other components does this need?
   - What settings, config, environment?
   - What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form Single Hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Write it down
   - Be specific, not vague

2. **Test Minimally**
   - Make the SMALLEST possible change to test hypothesis
   - One variable at a time
   - Don't fix multiple things at once

3. **Verify Before Continuing**
   - Did it work? Yes → Phase 4
   - Didn't work? Form NEW hypothesis
   - DON'T add more fixes on top

4. **When You Don't Know**
   - Say "I don't understand X"
   - Don't pretend to know
   - Ask for help
   - Research more

### Phase 4: Implementation

**Fix the root cause, not the symptom:**

1. **Create Failing Test Case**
   - Simplest possible reproduction
   - Automated test if possible
   - One-off test script if no framework
   - MUST have before fixing
   - Use the `superpowers:test-driven-development` skill for writing proper failing tests

2. **Implement Single Fix**
   - Address the root cause identified
   - ONE change at a time
   - No "while I'm here" improvements
   - No bundled refactoring

3. **Verify Fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?

4. **If Fix Doesn't Work**
   - STOP
   - Count: How many fixes have you tried?
   - If < 3: Return to Phase 1, re-analyze with new information
   - **If ≥ 3: STOP and question the architecture (step 5 below)**
   - DON'T attempt Fix #4 without architectural discussion

5. **If 3+ Fixes Failed: Question Architecture**

   **Pattern indicating architectural problem:**
   - Each fix reveals new shared state/coupling/problem in different place
   - Fixes require "massive refactoring" to implement
   - Each fix creates new symptoms elsewhere

   **STOP and question fundamentals:**
   - Is this pattern fundamentally sound?
   - Are we "sticking with it through sheer inertia"?
   - Should we refactor architecture vs. continue fixing symptoms?

   **Discuss with your human partner before attempting more fixes**

   This is NOT a failed hypothesis - this is a wrong architecture.

## Red Flags - STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

**If 3+ fixes failed:** Question the architecture (see Phase 4.5)

## User Signals You're Doing It Wrong

**Watch for these redirections:**
- "Is that not happening?" - You assumed without verifying
- "Will it show us...?" - You should have added evidence gathering
- "Stop guessing" - You're proposing fixes without understanding
- "Ultrathink this" - Question fundamentals, not just symptoms
- "We're stuck?" (frustrated) - Your approach isn't working

**When you see these:** STOP. Return to Phase 1.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## When Process Reveals "No Root Cause"

If systematic investigation reveals issue is truly environmental, timing-dependent, or external:

1. You've completed the process
2. Document what you investigated
3. Implement appropriate handling (retry, timeout, error message)
4. Add monitoring/logging for future investigation

**But:** 95% of "no root cause" cases are incomplete investigation.

## Supporting Techniques

These techniques are part of systematic debugging and available in this directory:

- **`root-cause-tracing.md`** - Trace bugs backward through call stack to find original trigger
- **`defense-in-depth.md`** - Add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** - Replace arbitrary timeouts with condition polling

**Related skills:**
- **superpowers:test-driven-development** - For creating failing test case (Phase 4, Step 1)
- **superpowers:verification-before-completion** - Verify fix worked before claiming success

## Real-World Impact

From debugging sessions:
- Systematic approach: 15-30 minutes to fix
- Random fixes approach: 2-3 hours of thrashing
- First-time fix rate: 95% vs 40%
- New bugs introduced: Near zero vs common

---

# Project-Specific Debugging Tools (ExplainAnything)

The sections below provide project-specific tools and commands to apply the systematic debugging methodology in this codebase.

---

## Environment Detection

Before debugging, determine your environment:

```bash
# Check for local tmux instance
if ls /tmp/claude-instance-*.json 2>/dev/null | xargs -I {} jq -r 'select(.project_root == "'$(pwd)'") | .instance_id' {} 2>/dev/null | grep -q .; then
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

### Reproduce UI Issues (Playwright)
```
mcp__plugin_playwright_playwright__browser_navigate(url='https://...')
mcp__plugin_playwright_playwright__browser_snapshot()
mcp__plugin_playwright_playwright__browser_console_messages()
```

---

## Request ID Correlation

The `requestId` is your universal correlation key across all systems.

### Request ID Format
- **Client-generated**: `client-{timestamp}-{6-char-random}` (e.g., `client-1704067200000-abc123`)
- **Server fallback**: UUID v4 when client doesn't provide

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

| Tool | Purpose | Example Use |
|------|---------|-------------|
| `search_issues` | Find grouped errors | Recent unresolved issues |
| `get_issue_details` | Stacktrace, context | Deep dive on specific issue |
| `analyze_issue_with_seer` | AI root cause | Automated hypothesis generation |
| `search_events` | Individual events, counts | "How many errors today" |
| `get_logs` (Supabase) | Service logs | API, postgres, auth logs |
| `browser_snapshot` | Page state | Reproduce UI issues |
| `browser_console_messages` | JS errors | Client-side debugging |
| `browser_network_requests` | API calls | Check request/response |

---

## Sub-Commands

When invoked via `/debug`, these sub-commands provide quick access:

| Command | Purpose | What It Does |
|---------|---------|--------------|
| `/debug` | Full guided workflow | Detect env → walk through Phase 1-4 |
| `/debug logs` | Quick log access | Local: tmux capture, Deployed: Supabase logs |
| `/debug errors` | Search recent errors | Local: grep server.log, Deployed: Sentry search |
| `/debug trace <requestId>` | Trace specific request | Search all systems by requestId |
| `/debug sentry <issueId>` | Analyze Sentry issue | get_issue_details + analyze_with_seer |
