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

**Server killed during E2E tests:**
Playwright's global-setup/teardown touch the idle timestamp to prevent kills during test runs.
If the server is still killed mid-test, check:
- `/tmp/claude-idle-watcher.log` for kill events
- Whether `global-setup.ts` found the instance file
- Manually touch: `touch /tmp/claude-idle-$(cat /tmp/claude-instance-*.json | jq -r '.instance_id').timestamp`

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
s -d       # same, but with --dangerously-skip-permissions
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

**Setup**: See [environments.md — Read-Only Database Access](environments.md#read-only-database-access)

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

## Supabase CLI Debugging

The Supabase CLI (`npx supabase`, v2.84.4) provides database inspection and debugging tools for both staging and production. Use the `/debug` skill for guided debugging workflows that incorporate these tools.

### Setup

```bash
# One-time: authenticate with Supabase
npx supabase login

# Link to staging (prod linking is blocked by settings.json)
npx supabase link --project-ref ifubinffdbyewoezcidz
```

### Ad-Hoc SQL Queries (Staging & Production)

Use `npm run query:staging` and `npm run query:prod` for safe, read-only SQL access. Both use a dedicated `readonly_local` PostgreSQL role with SELECT-only privileges — writes are impossible even if you try.

```bash
# Staging
npm run query:staging                                    # Interactive REPL (staging> prompt)
npm run query:staging -- "SELECT count(*) FROM explanations"
npm run query:staging -- --json "SELECT id, explanation_title FROM explanations LIMIT 5"

# Production
npm run query:prod                                       # Interactive REPL (prod> prompt)
npm run query:prod -- "SELECT count(*) FROM explanations"
npm run query:prod -- --json "SELECT id, explanation_title FROM explanations LIMIT 5" | jq '.'
```

**Common debugging queries:**
```sql
-- Recent explanations
SELECT id, explanation_title, created_at FROM explanations ORDER BY created_at DESC LIMIT 10;

-- Check evolution runs
SELECT id, status, generation_method, created_at FROM evolution_runs ORDER BY created_at DESC LIMIT 10;

-- User activity (last 7 days)
SELECT count(*), date_trunc('day', created_at) as day FROM "userQueries" GROUP BY day ORDER BY day DESC LIMIT 7;

-- Find test content pollution
SELECT count(*) FROM explanations WHERE explanation_title LIKE '[TEST]%';
```

### Database Inspection (via Supabase CLI)

These read-only commands work against the linked project (staging by default, or specify `--db-url`):

| Command | Purpose |
|---------|---------|
| `npx supabase inspect db long-running-queries --linked` | Queries running > 5 minutes |
| `npx supabase inspect db blocking --linked` | Queries holding locks + waiting queries |
| `npx supabase inspect db locks --linked` | Exclusive locks on relations |
| `npx supabase inspect db outliers --linked` | Queries by total execution time |
| `npx supabase inspect db calls --linked` | Queries by total call count |
| `npx supabase inspect db table-stats --linked` | Table sizes, index sizes, row counts |
| `npx supabase inspect db index-stats --linked` | Index usage and unused indices |
| `npx supabase inspect db bloat --linked` | Dead tuple space estimation |
| `npx supabase inspect db vacuum-stats --linked` | Vacuum operations per table |
| `npx supabase inspect db db-stats --linked` | Cache hit rates, WAL size |

### Security & Performance Audits

```bash
# Check for RLS issues, unindexed foreign keys, exposed auth.users
npx supabase db advisors --linked

# Schema dump for inspection
npx supabase db dump --linked -f schema.sql

# Compare local vs remote schema
npx supabase db diff --linked

# Check migration status
npx supabase migration list
```

### Safety Matrix

| Method | Safety | Use for |
|--------|--------|---------|
| `npm run query:staging` | **DB-enforced** read-only | Ad-hoc staging SQL queries |
| `npm run query:prod` | **DB-enforced** read-only | Ad-hoc production SQL queries |
| `npx supabase inspect db *` | Read-only (pg_stat views) | Database health inspection |
| `npx supabase db advisors` | Read-only (analysis) | Security/performance checks |
| `npx supabase db dump` | Read-only (pg_dump) | Schema export |
| `supabase db query --linked` | **BLOCKED by hook** | Use query:staging/query:prod instead |
| `supabase link` to prod | **BLOCKED by settings.json** | Prod linking not allowed |

> **Note:** `supabase db query --linked` is blocked because it can execute arbitrary writes. The `query:staging`/`query:prod` scripts use a DB-enforced read-only role, making them the safe path for ad-hoc queries.

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

### Debugging Cost Accuracy (Bug A / Bug B)

The evolution pipeline has two historical cost-accuracy bugs. Both are fixed but worth knowing for debugging future regressions.

**Bug A — per-invocation cost inflation from string-length math:** If `evolution_agent_invocations.cost_usd` disagrees with the summed `llmCallTracking.estimated_cost_usd` rows for the same `evolution_invocation_id`, you're seeing the legacy string-length cost path (now replaced in `createEvolutionLLMClient.ts` with token-based `calculateLLMCost`). Verify via:
```sql
SELECT inv.id, inv.cost_usd AS pipeline_cost,
       COALESCE(SUM(llm.estimated_cost_usd), 0) AS billed_cost,
       inv.cost_usd - COALESCE(SUM(llm.estimated_cost_usd), 0) AS diff
FROM evolution_agent_invocations inv
LEFT JOIN "llmCallTracking" llm ON llm.evolution_invocation_id = inv.id
WHERE inv.run_id = '<run-id>' GROUP BY inv.id, inv.cost_usd;
```
Expected: `|diff| < 0.0001`.

**Bug B — sibling cost bleed under parallel dispatch:** If sum of per-invocation `cost_usd` for a run far exceeds run-level `evolution_metrics.cost`, the per-invocation attribution is bleeding siblings' spend via the `detail.totalCost` before/after-delta path. Fixed by routing the LLM client through the `AgentCostScope` in `Agent.run()`. Verify:
```sql
SELECT
  (SELECT SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = '<run-id>') AS sum_invocations,
  (SELECT value FROM evolution_metrics WHERE entity_type='run' AND entity_id='<run-id>' AND metric_name='cost') AS run_cost;
```
Expected: both numbers match within rounding. Pre-fix on run `b0778925` they diverged 4.7×.

**Rollback for Phase 2.5:** flip `EVOLUTION_USE_SCOPE_OWNSPENT=false` in Vercel env to revert to the legacy delta path (no redeploy needed).

### Debugging "Hide test content" filter silently hiding rows

If the `/admin/evolution/runs` "Hide test content" checkbox returns zero rows even with real non-test runs present, the legacy `.not('strategy_id', 'in', '(<uuids>)')` path was being generated with a huge IN list (~36 KB URL at 984 test strategies on staging) that silently blew past PostgREST's URL length ceiling. The replacement path uses an embedded `!inner` join on `evolution_strategies.is_test_content`. Test-strategy names are flagged by a Postgres BEFORE trigger calling `evolution_is_test_name(text)` — if a new pattern appears in `evolution/src/services/shared.ts:isTestContentName`, update `supabase/migrations/*_evolution_is_test_content.sql` to match, and extend the shared `TEST_NAME_FIXTURES` table (used by the anti-drift test in `evolution/src/services/shared.test.ts`).

### Backfilling historical cost inaccuracies

`evolution/scripts/backfillInvocationCostFromTokens.ts` repairs `evolution_agent_invocations.cost_usd` + run-level `cost`/`generation_cost`/`ranking_cost`/`seed_cost` metrics from `llmCallTracking`. Default is `--dry-run`; add `--apply` to write. Use `--run-id <uuid>` for single-run spot fixes. Uses `writeMetricReplace` (plain upsert) instead of `writeMetricMax` (GREATEST) so downward corrections actually land.

### Related

- [Cost Optimization](../../evolution/docs/cost_optimization.md) — Budget event logger implementation details
- [Reference](../../evolution/docs/reference.md) — CostTracker API including `releaseReservation` and `setEventLogger`

---

## Debugging Checklist

Before claiming an issue is resolved:

- [ ] Root cause identified (not just symptoms)
- [ ] Failing test reproduces the bug
- [ ] Fix addresses root cause
- [ ] All existing tests still pass
- [ ] No regressions introduced
