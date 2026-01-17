# Debugging Skill Command Proposal Research

**Date**: 2026-01-16T07:09:00-0800
**Researcher**: Claude
**Git Commit**: c69645b453a1828b3bc14aa4935cf6cd1d06dd84
**Branch**: feat/debugging_skill_command_proposal_20260116
**Repository**: explainanything

## Problem Statement

Create a Claude Skill that utilizes the full set of tools (e.g., MCP, observability, logging) to efficiently debug any issues that occur in any environments. It should be implemented both as a command and as a skill.

## High Level Summary

The codebase has a comprehensive observability infrastructure but no dedicated debugging skill that ties it all together. The existing `superpowers:systematic-debugging` skill provides methodology but doesn't integrate with the project's specific tooling. This research documents what exists today to inform the design of a unified debugging skill.

### Key Findings

1. **Existing Systematic Debugging Skill** (`superpowers:systematic-debugging`) provides a 4-phase methodology but is generic—not tailored to this project's tools
2. **Rich Logging Infrastructure** with client→server→OTLP pipeline ready for debugging
3. **Multiple MCP Tools Available**: Sentry, Supabase, Playwright, Honeycomb—all configured but not unified into a debugging workflow
4. **tmux-based Dev Server Management** provides log access patterns documented in project
5. **No Dedicated Project Debugging Command** exists in `.claude/commands/`

---

## Documents Read

- `docs/feature_deep_dives/request_tracing_observability.md` - Request ID propagation, logging wrappers, OTLP integration
- `docs/docs_overall/environments.md` - Environment configurations, observability setup, GitHub secrets
- `docs/docs_overall/testing_overview.md` - Test tiers, CI/CD workflows, debugging patterns
- `docs/planning/tmux_usage/using_tmux_recommendations.md` - Dev server management for debugging
- `~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/skills/systematic-debugging/SKILL.md` - Existing debugging methodology

## Code Files Read

- `src/lib/logging/client/` - Client-side logging infrastructure (5 files)
- `src/lib/logging/server/` - Server-side logging infrastructure (2 main files)
- `.claude/commands/` - Existing Claude commands (no debug command)
- `.mcp.json` - MCP server configurations
- `docs/planning/tmux_usage/ensure-server.sh` - On-demand server starter with crash recovery
- `docs/planning/tmux_usage/start-dev-tmux.sh` - tmux session creation and port allocation
- `docs/planning/tmux_usage/idle-watcher.sh` - Background daemon for auto-shutdown
- `.claude/hooks/block-manual-server.sh` - PreToolUse hook blocking manual server starts
- `.claude/hooks/cleanup-tmux.sh` - SessionEnd hook for cleanup
- `src/lib/requestIdContext.ts` - AsyncLocalStorage context management
- `src/lib/serverReadRequestId.ts` - Server action wrapper for request ID extraction
- `src/hooks/clientPassRequestId.ts` - Client-side request ID generation

---

## Detailed Findings

### 1. Existing Systematic Debugging Skill (superpowers:systematic-debugging)

**Location**: `~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/skills/systematic-debugging/`

**Core Principle**: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST"

**Four Mandatory Phases**:
1. **Phase 1: Root Cause Investigation** - Trace error backward through call stack
2. **Phase 2: Pattern Analysis** - Compare working vs broken cases
3. **Phase 3: Hypothesis and Testing** - Form single hypothesis, design test
4. **Phase 4: Implementation** - Fix with verification

**Supporting Techniques**:
- `root-cause-tracing.md` - Trace bugs backward through call stack
- `defense-in-depth.md` - Add validation at multiple layers
- `condition-based-waiting.md` - Replace arbitrary timeouts with polling

**Limitations for This Project**:
- Generic methodology, not integrated with project-specific tools
- Doesn't know about Sentry MCP, Honeycomb MCP, Supabase MCP
- Doesn't reference tmux log access patterns
- No environment-specific guidance (local vs staging vs production)

---

### 2. Logging Infrastructure

#### Client-Side (`src/lib/logging/client/`)

| File | Purpose |
|------|---------|
| `earlyLogger.ts` | Pre-hydration console capture via `window.__PRE_HYDRATION_LOGS__` |
| `consoleInterceptor.ts` | Patches console, persists to localStorage, captures uncaught errors |
| `remoteFlusher.ts` | Batches logs every 30s, sends to `/api/client-logs`, uses sendBeacon on unload |
| `clientLogging.ts` | `withClientLogging()` wrapper for function instrumentation |
| `logConfig.ts` | Environment-based log level filtering |

**Log Flow**:
```
Console.log → localStorage buffer → Remote Flusher → /api/client-logs → Server
```

**Key Utilities**:
- `window.exportLogs()` - Manual log export
- `window.clearLogs()` - Clear localStorage logs

#### Server-Side (`src/lib/logging/server/`)

| File | Purpose |
|------|---------|
| `automaticServerLoggingBase.ts` | `withServerLogging()`, `withServerTracing()`, `withServerLoggingAndTracing()` |
| `otelLogger.ts` | `emitLog()` to OTLP backend (Honeycomb), trace correlation |

**Key Wrappers**:
```typescript
// Logging only
const fn = withServerLogging(originalFn, 'functionName', config);

// Tracing only
const fn = withServerTracing(originalFn, 'operationName', config);

// Both
const fn = withServerLoggingAndTracing(originalFn, 'name', logConfig, traceConfig);
```

**OTLP Export**:
- Production: Only ERROR/WARN sent (override with `OTEL_SEND_ALL_LOG_LEVELS=true`)
- Dev/staging: All levels sent
- Batch processor: max 100 queue, 50 batch size, 5s delay

---

### 3. Request Tracing Infrastructure

**Key Files**:
- `src/lib/requestIdContext.ts` - AsyncLocalStorage for request context
- `src/hooks/clientPassRequestId.ts` - Client-to-server propagation
- `src/lib/tracing/fetchWithTracing.ts` - Browser trace injection (W3C traceparent)

**RequestIdContext API**:
```typescript
RequestIdContext.run({ requestId, userId }, callback)  // Wrap operation
RequestIdContext.getRequestId()                         // Get current ID
RequestIdContext.getUserId()                            // Get current user
```

**Request Flow**:
```
Client Request (fetchWithTracing injects traceparent)
    ↓
API Route / Server Action
    ↓
RequestIdContext.run() wraps operation
    ↓
withServerLoggingAndTracing() decorates functions
    ↓
logger.info/error() auto-attaches requestId
    ↓
AsyncLocalStorage preserves context across await
```

---

### 4. MCP Tools Available for Debugging

#### Sentry MCP (Enabled)

**Tools**:
- `mcp__plugin_sentry_sentry__search_issues` - Search grouped issues
- `mcp__plugin_sentry_sentry__search_events` - Search events, counts, aggregations
- `mcp__plugin_sentry_sentry__get_issue_details` - Detailed issue info with stacktrace
- `mcp__plugin_sentry_sentry__get_trace_details` - Trace information
- `mcp__plugin_sentry_sentry__analyze_issue_with_seer` - AI root cause analysis
- Plus: `search_issue_events`, `get_issue_tag_values`, `get_event_attachment`

**Project**: `minddojo/explainanything`

#### Supabase MCP (Enabled)

**Tools**:
- `mcp__supabase__list_tables` - Schema inspection
- `mcp__supabase__get_logs` - Service logs (api, postgres, auth, edge-function, etc.)
- `mcp__supabase__get_advisors` - Security/performance recommendations
- `mcp__supabase__list_migrations` - Migration history

#### Honeycomb MCP (Configured)

**URL**: `https://mcp.honeycomb.io/mcp` (HTTP transport, OAuth auth)

**Tools**:
- `list_datasets` - Enumerate datasets
- `run_query` - Execute analytics queries
- `get_columns` - Column metadata
- `get_trace_link` - Generate UI deep links
- `analyze_columns` - Statistical metrics

#### Playwright MCP (Enabled)

**Tools**:
- `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`
- `browser_console_messages` - Capture JS errors/warnings
- `browser_take_screenshot` - Visual debugging
- `browser_network_requests` - Network inspection

---

### 5. Environment-Specific Debugging

| Environment | Database | Observability | Log Access |
|-------------|----------|---------------|------------|
| **Local Dev** | Dev Supabase | ❌ | tmux: `tmux capture-pane -t claude-<id>-backend -p -S -100` |
| **Unit Tests** | Mocked | ❌ | Jest console output |
| **Integration** | Dev Supabase (service role) | ❌ | Jest console output |
| **E2E Tests** | Dev Supabase | ❌ | Playwright traces, `server-<id>.log` |
| **Vercel Preview** | Dev Supabase | ✅ Honeycomb + Sentry | Honeycomb UI, Sentry UI |
| **Vercel Production** | Prod Supabase | ✅ Honeycomb + Sentry | Honeycomb UI, Sentry UI |

**tmux Log Access Pattern** (from CLAUDE.md):
```bash
# Find instance
cat /tmp/claude-instance-*.json | jq -r '.instance_id'

# View backend logs
tmux capture-pane -t claude-<id>-backend -p -S -100

# View frontend logs
tmux capture-pane -t claude-<id>-frontend -p -S -100

# Or use log files
tail -100 server-<id>.log
```

---

### 6. tmux Infrastructure Deep Dive

#### Overview

The project uses on-demand tmux-based dev servers that:
- Start automatically when needed (e.g., E2E tests)
- Auto-shutdown after 5 minutes of inactivity
- Support crash recovery with same instance ID
- Isolate multiple Claude Code sessions via unique ports (3100-3999)

#### Core Scripts

| Script | Purpose |
|--------|---------|
| `docs/planning/tmux_usage/ensure-server.sh` | Entry point - health check, crash detection, atomic locking |
| `docs/planning/tmux_usage/start-dev-tmux.sh` | Creates tmux session, allocates port, writes instance file |
| `docs/planning/tmux_usage/idle-watcher.sh` | Background daemon - monitors idle time, kills after 5 minutes |

#### Instance ID & File-Based Discovery

**Instance ID Format**: 8 random hex characters (e.g., `a7f2c9d1`)
- Generated via: `head -c 8 /dev/urandom | xxd -p`
- ~4 billion possible IDs (no collision risk)

**Instance File**: `/tmp/claude-instance-{id}.json`
```json
{
  "instance_id": "a7f2c9d1",
  "backend_session": "claude-a7f2c9d1-backend",
  "backend_port": 3547,
  "backend_url": "http://localhost:3547",
  "backend_log": "/path/to/server-a7f2c9d1.log",
  "project_root": "/Users/abel/Documents/explainanything-base/worktree_35_3",
  "started_at": "2026-01-16T15:30:45Z"
}
```

**Port Allocation Algorithm**:
1. Hash instance ID with MD5
2. Extract first 4 hex chars → convert to decimal
3. `port = 3100 + (hash_num % 900)` → range 3100-3999
4. If port occupied, increment until available (max 100 attempts)

#### Server Lifecycle

```
1. ensure-server.sh called (by Playwright or manually)
       ↓
2. Check for existing instance file matching project_root
       ↓
3. If found: health check via curl (2s timeout)
       ↓
4. If healthy: touch idle timestamp, exit (server reused)
       ↓
5. If unhealthy/crashed: cleanup, keep same instance ID
       ↓
6. start-dev-tmux.sh creates new tmux session
       ↓
7. Wait for server to respond (max 30s)
       ↓
8. Write instance file, start idle-watcher daemon
       ↓
9. Server runs until 5 minutes idle → auto-killed
```

#### Idle Timeout Mechanism

**Timestamp File**: `/tmp/claude-idle-{id}.timestamp`
- Touched every time `ensure-server.sh` runs (resets 5-min countdown)
- `idle-watcher.sh` checks file age every 60 seconds
- If age > 300 seconds: kills tmux session, removes instance file

**Watcher Self-Termination**: When no servers remain, watcher exits automatically

#### Claude Code Hooks Integration

| Hook | Event | Purpose |
|------|-------|---------|
| `.claude/hooks/block-manual-server.sh` | PreToolUse (Bash) | Blocks `npm run dev`, `next dev`, etc. |
| `.claude/hooks/start-dev-servers.sh` | SessionStart | Cleans up stale sessions (>4 hours old) |
| `.claude/hooks/cleanup-tmux.sh` | SessionEnd | Kills tmux sessions for this Claude instance |

**Enforcement via PreToolUse**:
```bash
# Blocked patterns:
"npm run dev", "npm start", "next dev", "next start", "node server", "npx next dev"

# Allowed exceptions:
Commands containing "ensure-server" or "start-dev-tmux"
```

#### Debugging Commands for tmux

```bash
# Find current instance
ID=$(cat /tmp/claude-instance-*.json 2>/dev/null | jq -r 'select(.project_root == "'$(pwd)'") | .instance_id')

# View last 100 lines of server logs
tmux capture-pane -t claude-${ID}-backend -p -S -100

# Real-time log monitoring
tail -f server-${ID}.log

# List all Claude tmux sessions
tmux list-sessions | grep "^claude-"

# Get server URL
cat /tmp/claude-instance-*.json | jq -r 'select(.project_root == "'$(pwd)'") | .frontend_url'

# Manually ensure server is running
./docs/planning/tmux_usage/ensure-server.sh

# Force stop a server
tmux kill-session -t claude-${ID}-backend

# Check idle watcher status
ps aux | grep idle-watcher
tail -50 /tmp/claude-idle-watcher.log
```

---

### 7. Request ID Propagation Deep Dive

#### Overview

Request IDs propagate from client to server using a "sandwich" pattern:
1. Client wraps payload with `__requestId` field
2. Server extracts and removes `__requestId` before calling business logic
3. AsyncLocalStorage maintains context across all async operations
4. All logger calls auto-inject `requestId`, `userId`, `sessionId`

#### Request ID Format

**Client-generated**: `client-{timestamp}-{6-char-random}`
- Example: `client-1704067200000-abc123`

**Server fallback**: UUID v4 (when client doesn't provide)
- Example: `550e8400-e29b-41d4-a716-446655440000`

#### Client-Side Generation (`src/hooks/clientPassRequestId.ts`)

```typescript
// Hook usage in React components
const { withRequestId } = useAuthenticatedRequestId();

// Wrap server action calls
await saveExplanationAction(withRequestId({ explanationId: 123 }));
```

**What `withRequestId()` does**:
1. Generates unique request ID: `client-${Date.now()}-${random}`
2. Sets `RequestIdContext.setClient()` for client-side logging
3. Sets Sentry tags for client-side error correlation
4. Returns payload with `__requestId` field added:
   ```typescript
   {
     explanationId: 123,
     __requestId: { requestId: 'client-xxx', userId: 'user-123', sessionId: 'sess-456' }
   }
   ```

#### Server-Side Extraction (`src/lib/serverReadRequestId.ts`)

```typescript
// Decorator pattern for server actions
export const myAction = serverReadRequestId(_myAction);
```

**What `serverReadRequestId()` does**:
1. Extracts `__requestId` from `args[0].__requestId`
2. **Deletes `__requestId` from payload** (business logic never sees it)
3. Sets Sentry scope with user and tags
4. Wraps execution in `RequestIdContext.run()`:
   ```typescript
   return RequestIdContext.run(requestIdData, async () => {
     return await originalFunction(...args);  // args without __requestId
   });
   ```

#### Context Management (`src/lib/requestIdContext.ts`)

**Dual-environment implementation**:
- **Server (Node.js)**: Uses `AsyncLocalStorage` for async isolation
- **Client (Browser)**: Uses module-level variable with restoration

**API**:
```typescript
RequestIdContext.run(data, callback)  // Wrap async operation
RequestIdContext.get()                 // Get full context
RequestIdContext.getRequestId()        // Returns ID or 'unknown'
RequestIdContext.getUserId()           // Returns user or 'anonymous'
RequestIdContext.getSessionId()        // Returns session or 'unknown'
```

**Key Property**: AsyncLocalStorage guarantees context isolation even through:
- Nested async operations
- `Promise.all()` / `Promise.race()`
- `setTimeout()` / `setInterval()`
- Third-party async libraries

#### Logger Integration (`src/lib/server_utilities.ts`)

```typescript
// Every logger call auto-injects context
const addRequestId = (data) => {
  const requestId = RequestIdContext.getRequestId();
  const userId = RequestIdContext.getUserId();
  const sessionId = RequestIdContext.getSessionId();
  return { requestId, userId, sessionId, ...data };
};

// Usage - context added automatically
logger.info('Processing request', { explanationId: 123 });
```

**Log Output Format** (`server.log`):
```json
{
  "timestamp": "2026-01-16T12:00:00.000Z",
  "level": "INFO",
  "message": "Processing request",
  "requestId": "client-1704067200000-abc123",
  "userId": "user-456",
  "sessionId": "sess-789",
  "data": { "explanationId": 123 }
}
```

#### Complete Request Flow

```
CLIENT BROWSER
├─ useAuthenticatedRequestId() hook
├─ Generate: "client-1704067200000-abc123"
├─ RequestIdContext.setClient() for client logging
├─ Sentry.setTag('requestId', ...)
└─ withRequestId(data) → adds __requestId to payload

                    ↓ HTTP POST (Next.js Server Action)

NEXT.JS SERVER
├─ serverReadRequestId wrapper intercepts
├─ Extract: args[0].__requestId
├─ Delete: __requestId from args (clean payload)
├─ Set Sentry scope with requestId, userId
└─ RequestIdContext.run(data, callback)

                    ↓ During execution

ASYNC OPERATIONS
├─ Business logic runs inside context
├─ All nested async calls maintain context
├─ logger.info/error() auto-inject requestId
└─ Errors captured with requestId in Sentry

                    ↓ Logging destinations

OBSERVABILITY
├─ Console: [INFO] message { requestId, ... }
├─ server.log: JSON with requestId at top level
├─ Sentry: Breadcrumbs + error scope
└─ Honeycomb: OTLP logs with requestId field
```

#### Searching Logs by Request ID

```bash
# Local: Search server.log by request ID
grep "client-1704067200000-abc123" server.log

# Local: Search with jq for structured queries
cat server.log | jq 'select(.requestId == "client-1704067200000-abc123")'

# Sentry MCP: Search issues by request ID tag
# Use: mcp__plugin_sentry_sentry__search_events with requestId filter

# Honeycomb MCP: Query logs by requestId field
# Use: run_query with WHERE requestId = 'client-xxx'
```

---

### 8. Existing Debugging Documentation

| Document | Content |
|----------|---------|
| `docs/planning/tmux_usage/using_tmux_recommendations.md` | On-demand dev server management, log access patterns |
| `docs/feature_deep_dives/debugging_skill.md` | Placeholder (empty template) |
| `docs/planning/testing_additions/e2e_test_major_fixes_progress_remaining_issues.md` | Real-world systematic debugging example (5-phase approach) |

---

### 9. What's Missing (Gap Analysis)

| Gap | Impact |
|-----|--------|
| No unified debugging command | Must manually know which tools to use |
| No environment detection | Must manually determine local vs deployed |
| No automatic log correlation | Must manually find request IDs, trace IDs |
| No Sentry↔Honeycomb correlation | Two separate trace systems |
| No guided workflow | Generic skill doesn't know project specifics |
| No MCP tool orchestration | Each tool used independently |

---

## Architecture Documentation

### Current Observability Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│  earlyLogger.ts → consoleInterceptor.ts → remoteFlusher.ts      │
│       ↓                    ↓                    ↓                │
│  window buffer         localStorage         /api/client-logs    │
│                                                                  │
│  fetchWithTracing.ts → injects traceparent header                │
│  Sentry.init() → captures errors, session replay                 │
└──────────────────────────────┬──────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER (Next.js)                          │
├─────────────────────────────────────────────────────────────────┤
│  RequestIdContext.run() → wraps all operations                   │
│  withServerLoggingAndTracing() → instruments functions           │
│  otelLogger.ts → emitLog() to OTLP                               │
│                                                                  │
│  /api/client-logs → receives browser logs                        │
│  /api/traces → proxies traces to Honeycomb                       │
│  /api/monitoring → Sentry tunnel                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                     OBSERVABILITY BACKENDS                       │
├─────────────────────────────────────────────────────────────────┤
│  Honeycomb (OTLP)          │  Sentry                            │
│  - Distributed traces       │  - Error tracking                  │
│  - Structured logs          │  - Session replay                  │
│  - Metrics                  │  - Performance monitoring          │
│  - MCP: run_query           │  - MCP: analyze_issue_with_seer    │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Tool Categories for Debugging

| Category | Tools | Use Case |
|----------|-------|----------|
| **Error Investigation** | Sentry MCP | Find errors, get stacktraces, AI analysis |
| **Log Analysis** | Honeycomb MCP, Supabase MCP | Query logs, find patterns |
| **Database Inspection** | Supabase MCP | Check data state, migrations |
| **UI Debugging** | Playwright MCP | Reproduce issues, capture screenshots |
| **Local Development** | tmux commands | Access dev server logs |

---

---

### 10. What the Debugging Skill Should Leverage

Based on this research, the debugging skill should integrate these existing capabilities:

#### Environment Detection

```bash
# Check for local tmux instance
if ls /tmp/claude-instance-*.json 2>/dev/null | grep -q .; then
  # Local development - use tmux logs
else
  # Deployed - use Sentry/Honeycomb MCP
fi
```

#### Local Debugging Workflow

1. **Find instance**: `cat /tmp/claude-instance-*.json | jq -r 'select(.project_root == "'$(pwd)'") | .instance_id'`
2. **View logs**: `tmux capture-pane -t claude-{id}-backend -p -S -100`
3. **Search by request ID**: `grep "client-xxx" server.log`
4. **Real-time monitoring**: `tail -f server-{id}.log`

#### Deployed Debugging Workflow

1. **Find errors**: `mcp__plugin_sentry_sentry__search_issues` with natural language query
2. **Get details**: `mcp__plugin_sentry_sentry__get_issue_details` with issue ID
3. **AI analysis**: `mcp__plugin_sentry_sentry__analyze_issue_with_seer` for root cause
4. **Query logs**: Honeycomb MCP `run_query` with requestId filter
5. **Check database**: `mcp__supabase__get_logs` for service-specific logs

#### Request ID Correlation Pattern

```typescript
// The skill should help users find the request ID from:
// 1. Error message in Sentry (requestId tag)
// 2. Browser console (client-xxx format)
// 3. Server logs (search by timestamp range)
// 4. Honeycomb trace (requestId field)
```

#### Integration with Systematic Debugging

The skill should wrap `superpowers:systematic-debugging` methodology with project-specific tooling:

| Phase | Generic Approach | Project-Specific Tools |
|-------|------------------|------------------------|
| **1. Root Cause** | "Trace error backward" | tmux logs, Sentry stacktrace, request ID search |
| **2. Pattern Analysis** | "Compare working vs broken" | Honeycomb queries, Supabase data comparison |
| **3. Hypothesis** | "Form single hypothesis" | Use Seer AI analysis, log correlation |
| **4. Implementation** | "Fix with verification" | Playwright MCP for UI verification |

---

## Open Questions

1. ~~**Should the skill auto-detect environment?**~~ **YES** - Check for `/tmp/claude-instance-*.json`
2. ~~**Should it integrate with existing systematic-debugging?**~~ **YES** - Extend with project-specific tools
3. **How to handle Sentry↔Honeycomb trace correlation?** (Currently separate - may need manual requestId linking)
4. **Should there be sub-commands?** (e.g., `/debug logs`, `/debug errors`, `/debug trace`)
5. ~~**How to handle authentication for MCP tools?**~~ **Most are pre-configured** - Honeycomb needs OAuth

---

## Research Conclusions

### Key Insights

1. **The infrastructure is ready** - All observability tools (Sentry, Honeycomb, Supabase, Playwright MCP) are configured and working
2. **Request ID is the correlation key** - Every log, error, and trace includes `requestId` for cross-referencing
3. **Environment determines tools** - Local uses tmux/logs, deployed uses MCP tools
4. **tmux discovery is file-based** - `/tmp/claude-instance-*.json` provides all server metadata

### Recommended Approach

The debugging skill should:
1. **Auto-detect environment** via instance file presence
2. **Wrap systematic-debugging** with project-specific tool guidance
3. **Provide request ID discovery** from multiple sources
4. **Orchestrate MCP tools** based on debugging phase

### Files to Create

1. `.claude/commands/debug.md` - Main debugging command
2. `.claude/skills/debug/SKILL.md` - Skill version (for auto-invocation)
3. Update `docs/feature_deep_dives/debugging_skill.md` - Documentation

---

## Related Research

- [Request Tracing & Observability](../feature_deep_dives/request_tracing_observability.md)
- [Environments](../docs_overall/environments.md)
- [Testing Overview](../docs_overall/testing_overview.md)
- [tmux Usage Recommendations](../tmux_usage/using_tmux_recommendations.md)
