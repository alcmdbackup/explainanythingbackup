# Systematic Log Analysis & Debugging Workflow for Claude Code

## Overview

This plan establishes a repeatable workflow for examining logs, identifying warnings/errors, and systematically debugging them using Claude Code.

---

## Your Observability Infrastructure

You have **two complementary systems**:

### 1. File Logs (Development)
| Log | Location | Populated By |
|-----|----------|--------------|
| `server.log` | Project root | `logger.*()` calls in `src/lib/server_utilities.ts` |
| `client.log` | Project root | POST to `/api/client-logs` (dev only) |

**Format**: JSON lines with `timestamp`, `level`, `message`, `data`, `requestId`, `userId`

### 2. OpenTelemetry → Grafana Cloud (Dev + Prod)
| Component | Details |
|-----------|---------|
| Endpoint | `otlp-gateway-prod-us-west-0.grafana.net/otlp` |
| Service | `explainanything` |
| Tracers | `llm`, `database`, `vector`, `application` |
| Auto-instrumented | HTTP, Pinecone, Supabase, unhandled rejections |

**Key files**: `instrumentation.ts`, `src/lib/logging/server/automaticServerLoggingBase.ts`

---

## Which System to Use When

| Scenario | Best Choice | Why |
|----------|-------------|-----|
| Local development debugging | **File logs** | Instant feedback, no network |
| Trace request across services | **Grafana** | Distributed tracing with span visualization |
| Inspect function I/O values | **File logs** | `withLogging()` captures inputs/outputs |
| Find slow operations | **Grafana** | Timing metrics, latency percentiles |
| Production errors | **Grafana** | File logs disabled in prod |
| Correlate client + server | **Either** | Both have requestId correlation |

**Recommendation**: Start with file logs for quick local debugging, use Grafana for distributed/timing/production issues.

---

## Phase 1: Log Collection & Analysis

### Step 1.1 - Extract warnings and errors from logs

```bash
# Server errors and warnings
grep -E '"level":"(ERROR|WARN)"' server.log | jq '.' 2>/dev/null || cat

# Client errors and warnings
grep -E '"level":"(ERROR|WARN)"' client.log | jq '.' 2>/dev/null || cat

# Count by level
echo "=== Error/Warning counts ==="
grep -o '"level":"[^"]*"' server.log client.log 2>/dev/null | sort | uniq -c
```

### Step 1.2 - Group errors by type/pattern

```bash
# Extract unique error messages
grep '"level":"ERROR"' server.log | jq -r '.message' | sort | uniq -c | sort -rn

# Find stack traces
grep -A5 '"level":"ERROR"' server.log | grep -E "(Error|at )"
```

### Step 1.3 - Correlate with request IDs

```bash
# Trace a specific request across client and server
REQUEST_ID="your-request-id"
grep "$REQUEST_ID" server.log client.log | jq '.'
```

### Step 1.4 - Query Grafana Cloud for errors

Access your Grafana dashboard and use these queries:

**Find error spans** (Tempo/Traces):
```
{ resource.service.name="explainanything" } | status=error
```

**Filter by tracer type**:
```
{ name=~"explainanything-llm.*" }     # LLM/OpenAI errors
{ name=~"explainanything-database.*" } # Supabase errors
{ name=~"explainanything-vector.*" }   # Pinecone errors
```

**Find slow operations** (>1s):
```
{ resource.service.name="explainanything" } | duration > 1s
```

**Grafana Cloud URL**: Check your `package.json` dev script for the OTLP endpoint credentials.

### Step 1.5 - Set up Grafana MCP for Claude Code access

Grafana has official MCP support! This lets Claude Code query your traces directly.

**Setup**:
```bash
# Add Grafana Cloud Traces MCP server
claude mcp add --transport=http tempo https://<your-stack-id>.grafana.net/tempo/api/mcp

# Verify it's connected
claude mcp list
```

**Authentication**: You'll need a Grafana Cloud API token with traces read access.

**Usage in Claude Code**:
Once configured, you can ask Claude Code directly:
- "Show me recent error traces from explainanything"
- "What services are calling Pinecone?"
- "Find the slowest operations in the last hour"

Claude Code will use the MCP server to query your traces and return results.

**References**:
- [Grafana Cloud Traces MCP Documentation](https://grafana.com/docs/grafana-cloud/send-data/traces/mcp-server/)
- [mcp-grafana GitHub](https://github.com/grafana/mcp-grafana)

---

## Phase 2: Prioritization

### Priority Matrix

| Priority | Criteria | Action |
|----------|----------|--------|
| P0 | Crashes, data loss, security | Fix immediately |
| P1 | User-facing errors, broken features | Fix this session |
| P2 | Warnings, degraded performance | Queue for fix |
| P3 | Debug noise, cosmetic | Batch cleanup |

### Categorize findings

1. Count total errors/warnings
2. Group by error message pattern
3. Identify most frequent issues
4. Check if errors are user-impacting

---

## Phase 3: Systematic Debugging with Claude Code

### For each error (in priority order):

#### Step 3.1 - Understand the error
```
Ask Claude Code:
"Analyze this error from my logs: [paste error JSON]
- What is the root cause?
- What file/function is involved?
- What are potential fixes?"
```

#### Step 3.2 - Reproduce the issue
- Use Playwright MCP to trigger the error scenario
- Check browser console for client errors
- Monitor server.log in real-time: `tail -f server.log`

#### Step 3.3 - Debug with context
```
Ask Claude Code:
"Debug this issue:
- Error: [error message]
- File: [file from stack trace]
- Request ID: [for correlation]

Read the relevant code and suggest a fix."
```

#### Step 3.4 - Implement & verify fix
1. Claude Code implements the fix
2. Run linting: `npm run lint`
3. Run type check: `npm run type-check`
4. Run tests: `npm test`
5. Reproduce scenario to confirm fix

---

## Phase 4: Useful Claude Code Commands

### Quick log analysis
```bash
# Tail logs in real-time
tail -f server.log | jq '.'

# Recent errors only (last 100 lines)
tail -100 server.log | grep '"level":"ERROR"' | jq '.'

# Errors in last hour (if timestamps are sortable)
grep '"level":"ERROR"' server.log | tail -20 | jq '.'
```

### Claude Code prompts for debugging

1. **Initial analysis**: "Read server.log and client.log, identify all warnings and errors, and group them by pattern"

2. **Deep dive**: "For error [X], trace through the codebase to find the root cause"

3. **Fix verification**: "After this fix, run the relevant tests and check logs for the same error pattern"

---

## Phase 5: Automation (Optional Enhancements)

### Create a log analysis script

Could add `scripts/analyze-logs.ts`:
- Parse JSON logs
- Filter by level
- Group by error pattern
- Output prioritized report

### Add log monitoring hook

Could create a Claude Code hook that:
- Scans logs after each test run
- Alerts on new error patterns
- Suggests relevant code to investigate

---

## Quick Reference Workflow

### Option A: File Logs (Local Dev)
```
1. Run: grep -E '"level":"(ERROR|WARN)"' server.log client.log | jq '.'
2. Prioritize by frequency and severity
3. For each issue:
   a. Share error with Claude Code
   b. Ask for root cause analysis
   c. Implement fix
   d. Verify with tests + log check
4. Repeat until clean
```

### Option B: Grafana Cloud via MCP (Recommended for Claude Code)
```
1. Set up Grafana MCP: claude mcp add --transport=http tempo https://<stack>.grafana.net/tempo/api/mcp
2. Ask Claude Code: "Query my traces for errors in explainanything service"
3. Claude Code retrieves traces directly and analyzes them
4. Ask follow-up: "What's causing this error? Show me the relevant code."
5. Claude Code correlates trace → code → fix
```

### Option C: Grafana Cloud Dashboard (Manual)
```
1. Open Grafana → Explore → Select Tempo data source
2. Query: { resource.service.name="explainanything" } | status=error
3. Click on error spans to see full trace
4. Note the operation name and attributes
5. Share trace details with Claude Code for debugging
```

---

## Current State Note

**server.log**: Currently empty/missing. Server-side `logger.*()` calls exist but may not be triggered in typical flows. Consider adding `withLogging()` wrappers to key functions.

**client.log**: Working (2KB of entries). Captures runtime events, user actions, and async operations.

**Grafana**: Actively receiving traces for Pinecone, Supabase, and unhandled rejections.

---

## Sources

- [Better Stack: Logging Best Practices](https://betterstack.com/community/guides/logging/logging-best-practices/)
- [StrongDM: Log Management Best Practices 2025](https://www.strongdm.com/blog/log-management-best-practices)
- [ClaudeLog: Using Claude Code for Debugging](https://claudelog.com/faqs/how-to-use-claude-code-for-debugging/)
