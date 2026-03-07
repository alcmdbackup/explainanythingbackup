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

### On-Demand Dev Servers

Dev servers start automatically when needed (e.g. `npm run test:e2e`) and stop after 5 minutes idle. Each Claude Code session gets its own isolated port (3100-3999).

```
npm run test:e2e
       ↓
ensure-server.sh checks: server running?
  No → start-dev-tmux.sh starts server in tmux
  Yes → reset idle timer
       ↓
Playwright discovers server via /tmp/claude-instance-*.json
       ↓
Tests run → idle-watcher.sh monitors → no tests for 5 min → kill server
```

**Note:** First test run after idle takes ~10-30s while server starts. Subsequent tests are instant.

**Never start servers manually** (`npm run dev`, `next dev`, etc.) — a PreToolUse hook blocks these. Use `npm run test:e2e` or `./docs/planning/tmux_usage/ensure-server.sh` instead.

**Prerequisites:**
```bash
# macOS
brew install jq

# Linux
apt install tmux jq lsof xxd curl
```

| File | Purpose |
|------|---------|
| `docs/planning/tmux_usage/ensure-server.sh` | On-demand server starter (called by Playwright) |
| `docs/planning/tmux_usage/start-dev-tmux.sh` | Creates tmux session with Next.js |
| `docs/planning/tmux_usage/idle-watcher.sh` | Daemon that kills idle servers |
| `.claude/hooks/start-dev-servers.sh` | SessionStart cleanup |
| `.claude/hooks/cleanup-tmux.sh` | SessionEnd cleanup |
| `.claude/hooks/block-manual-server.sh` | PreToolUse hook blocking direct server starts |

### Server Logs via tmux

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

### Dev Server Troubleshooting

**Server not starting:**
```bash
chmod +x docs/planning/tmux_usage/*.sh
npm run dev:server --dry-run
```

**Wrong server URL in tests:**
```bash
BASE_URL=http://localhost:3142 npm run test:e2e
```

**Orphaned servers:**
```bash
tmux list-sessions | grep "^claude-" | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
rm /tmp/claude-instance-*.json /tmp/claude-idle-*.timestamp
```

**Idle watcher not cleaning up:**
```bash
cat /tmp/claude-idle-watcher.pid
tail -50 /tmp/claude-idle-watcher.log
pkill -f idle-watcher.sh
./docs/planning/tmux_usage/idle-watcher.sh &
```

| Variable | Purpose |
|----------|---------|
| `BASE_URL` | Override server discovery |
| `CI` | Use Playwright's webServer instead of tmux |
| `E2E_TEST_MODE` | Bypass SSE streaming for test stability |

### Running Claude Code in tmux

Source `docs/planning/tmux_usage/claude-tmux.sh` in your `.bashrc`/`.zshrc` to get the `s` function. It auto-detects the worktree from your current directory and creates/reattaches a named tmux session running `claude -c` (continue last conversation).

```bash
source ~/Documents/ac/explainanything-worktree0/docs/planning/tmux_usage/claude-tmux.sh

# From any worktree directory:
s          # auto-creates/reattaches tmux session (s0, s1, s2, etc.)
# Ctrl+b d to detach, `s` again to reattach
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

## Emergency Recovery from Backup

If the primary repo (`Minddojo/explainanything`) is compromised or lost, restore from the backup mirror:

```bash
# Clone from backup
git clone https://github.com/alcmdbackup/explainanythingbackup.git explainanything-recovered

# Verify branches
cd explainanything-recovered
git branch -a

# Re-point origin to the primary repo (once restored)
git remote set-url origin https://github.com/Minddojo/explainanything.git
```

The backup repo has all feature branches, `main`, and `production` — synced automatically by `/finalize` and `/mainToProd`. See [environments.md — Backup Mirror Repository](environments.md#backup-mirror-repository) for full details.

---

## Debugging Budget Exhaustion in Evolution Runs

When an evolution run stops early with `BudgetExceededError`, use the `evolution_budget_events` audit log to trace what happened.

### Quick Diagnosis

```sql
-- See all budget events for a run
SELECT event_type, agent_name, amount_usd, total_spent_usd, total_reserved_usd, available_budget_usd
FROM evolution_budget_events
WHERE run_id = '<run-id>'
ORDER BY created_at;

-- Check for leaked reservations (release_failed = reservation queue was empty when release attempted)
SELECT * FROM evolution_budget_events
WHERE run_id = '<run-id>' AND event_type = 'release_failed';

-- See reserve/release balance per agent
SELECT agent_name,
  count(*) FILTER (WHERE event_type = 'reserve') AS reserves,
  count(*) FILTER (WHERE event_type = 'release_ok') AS releases,
  count(*) FILTER (WHERE event_type = 'release_failed') AS release_failures,
  count(*) FILTER (WHERE event_type = 'spend') AS spends
FROM evolution_budget_events
WHERE run_id = '<run-id>'
GROUP BY agent_name;
```

### What to Look For

| Symptom | Cause | Fix |
|---------|-------|-----|
| Many `reserve` events without matching `spend` or `release_ok` | LLM calls failing silently without releasing reservations | Check `llmClient.ts` try/catch wrapping |
| `total_reserved_usd` growing monotonically | Leaked reservations accumulating | Verify `releaseReservation` is called on all error paths |
| `release_failed` events | Release attempted on empty queue (double-release or no prior reserve) | Check agent error handling logic |
| Budget exhausted well below cap | Reserved amount + spent amount fills budget | Compare `total_reserved_usd` to expected reservation sizes |

### Related

- [Cost Optimization](../../evolution/docs/evolution/cost_optimization.md) — Budget event logger implementation details
- [Reference](../../evolution/docs/evolution/reference.md) — CostTracker API including `releaseReservation` and `setEventLogger`

---

## Debugging Checklist

Before claiming an issue is resolved:

- [ ] Root cause identified (not just symptoms)
- [ ] Failing test reproduces the bug
- [ ] Fix addresses root cause
- [ ] All existing tests still pass
- [ ] No regressions introduced
