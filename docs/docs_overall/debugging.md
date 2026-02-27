# Debugging

Guide to debugging issues across all environments — local development, deployed preview, and production.

## Quick Reference

| What You Need | Tool | Command / Access |
|----------------|------|------------------|
| Local server logs | tmux | `tmux capture-pane -t claude-<id>-backend -p -S -100` |
| Production errors | Sentry | `/debug sentry <issueId>` or [Sentry dashboard](https://sentry.io) |
| Production traces | Honeycomb | [ui.honeycomb.io](https://ui.honeycomb.io) → `explainanything` dataset |
| Production database | query:prod | `npm run query:prod` |
| UI reproduction | Playwright MCP | `/debug` → headless browser |
| Systematic workflow | /debug skill | `/debug` in Claude Code |

---

## The `/debug` Skill

Claude Code includes a built-in `/debug` skill (`.claude/skills/debug/SKILL.md`) that enforces systematic debugging. Its core rule: **no fixes without root cause investigation first**.

### Four-Phase Workflow

| Phase | What You Do | Success Criteria |
|-------|-------------|------------------|
| **1. Root Cause** | Read errors thoroughly, reproduce consistently, trace data flow backward through call chain | Understand WHAT fails and WHY |
| **2. Pattern Analysis** | Find similar working code, compare implementations, identify differences | Know what distinguishes working from broken |
| **3. Hypothesis** | Form one clear theory, design minimal test changing one variable, predict outcome | Hypothesis confirmed or refined |
| **4. Implementation** | Create failing test, implement targeted fix, run full suite | Bug resolved, no regressions |

### Key Safeguards

- **3-strike rule**: If 3+ consecutive fixes fail, STOP — this signals architectural problems requiring discussion, not more patches
- **Red flags**: "Quick fix for now", "Let me just try...", proposing solutions before tracing data flow
- **Environment-aware**: Auto-detects local (tmux logs) vs deployed (Sentry/Honeycomb MCP) and suggests appropriate tools
- **Request ID correlation**: Traces requests across server logs, Sentry, and Honeycomb using `requestId`

### Sub-Commands

| Command | What It Does |
|---------|--------------|
| `/debug` | Full guided workflow — detect env, walk through phases 1-4 |
| `/debug logs` | Quick log access — local: tmux capture, deployed: Supabase logs |
| `/debug errors` | Search recent errors — local: grep, deployed: Sentry search |
| `/debug trace <requestId>` | Trace a specific request across all systems |
| `/debug sentry <issueId>` | Deep dive on a Sentry issue with AI root cause analysis |

---

## Local Development

### Server Logs via tmux

Dev servers run in tmux sessions managed automatically. Access logs:

```bash
# Find your instance ID
cat /tmp/claude-instance-*.json | jq -r '.instance_id'

# View backend logs (last 100 lines)
tmux capture-pane -t claude-<id>-backend -p -S -100

# View frontend logs
tmux capture-pane -t claude-<id>-frontend -p -S -100

# Or use log files directly
tail -100 server-<id>.log
tail -100 client-<id>.log
```

### Searching Logs

```bash
# Find errors
grep -i "error\|exception\|failed" server-<id>.log | tail -50

# Trace a specific request
grep "client-XXXXX" server-<id>.log | jq .
```

---

## Production Debugging

### Sentry (Error Tracking)

Sentry captures unhandled errors and exceptions in the deployed app.

- **Dashboard**: Sentry → explainanything project
- **Via Claude Code**: `/debug sentry EXPLAINANYTHING-XXX` for AI-assisted root cause analysis
- **Key fields**: stack trace, breadcrumbs, `requestId` tag for correlation

### Honeycomb (Traces and Logs)

Honeycomb captures distributed traces and structured logs from the deployed app.

- **Dashboard**: [ui.honeycomb.io](https://ui.honeycomb.io) → `explainanything` dataset
- **Filter by**: `requestId`, `trace.trace_id`, `http.route`, `error`
- **BubbleUp**: Identify what's different about slow/failing requests
- See `scripts/query-honeycomb.md` for detailed query instructions

**Log levels**: By default, only ERROR/WARN are sent. Enable all levels temporarily:
- Set `OTEL_SEND_ALL_LOG_LEVELS=true` in Vercel env vars (runtime, no rebuild needed)
- Set `NEXT_PUBLIC_LOG_ALL_LEVELS=true` for client-side debug logs (requires rebuild)

### Read-Only Production Database

Direct SQL access to production data using a safe, read-only PostgreSQL role.

```bash
# Interactive REPL
npm run query:prod

# Single query
npm run query:prod -- "SELECT count(*) FROM explanations"

# JSON output (pipe to jq)
npm run query:prod -- --json "SELECT id, explanation_title FROM explanations LIMIT 5" | jq '.'
```

**Safety**: Uses `readonly_local` role with SELECT-only privileges. Cannot write, even if you try. 30-second query timeout prevents runaway queries.

**Setup**: See [environments.md — Read-Only Production Access](environments.md#read-only-production-access)

**Common queries**:
```sql
-- Count content
SELECT count(*) FROM explanations;

-- Recent explanations
SELECT id, explanation_title, created_at FROM explanations ORDER BY created_at DESC LIMIT 10;

-- Check evolution runs
SELECT id, status, generation_method, created_at FROM evolution_runs ORDER BY created_at DESC LIMIT 10;

-- User activity
SELECT count(*), date_trunc('day', created_at) as day FROM "userQueries" GROUP BY day ORDER BY day DESC LIMIT 7;
```

---

## Cross-System Correlation

The `requestId` is the universal key for tracing a request across all systems.

### Request ID Format

| Source | Format |
|--------|--------|
| Client-generated | `client-{timestamp}-{6-char-random}` |
| Server fallback | UUID v4 |

### Tracing a Request

1. **Get the requestId** from browser console, Sentry issue, or server logs
2. **Local logs**: `grep "<requestId>" server-<id>.log`
3. **Sentry**: Search events by `requestId` tag
4. **Honeycomb**: Filter dataset by `requestId` field
5. **Database**: Query related records by timestamp/user if needed via `query:prod`

---

## Debugging Checklist

Before claiming an issue is resolved:

- [ ] Root cause identified (not just symptoms)
- [ ] Failing test reproduces the bug
- [ ] Fix addresses root cause
- [ ] All existing tests still pass
- [ ] No regressions introduced
