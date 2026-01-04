# On-Demand Dev Servers for Claude Code

Isolated dev servers that start when needed and stop after 5 minutes idle. Reduces memory usage when running multiple Claude Code sessions.

## How It Works

```
npm run test:e2e
       ↓
ensure-server.sh checks: server running?
  No → start-dev-tmux.sh starts server in tmux
  Yes → reset idle timer
       ↓
Playwright discovers server via /tmp/claude-instance-*.json
       ↓
Tests run
       ↓
idle-watcher.sh monitors activity
  No tests for 5 min → kill server
```

Each Claude session gets its own isolated port (3100-3999 range) to prevent database/auth conflicts.

**Note:** First test run after idle takes ~10-30s while server starts. Subsequent tests are instant.

## Quick Reference

| Task | Command |
|------|---------|
| View server logs | `tmux capture-pane -t claude-<id>-backend -p -S -100` |
| List running servers | `tmux list-sessions \| grep claude-` |
| Get server URL | `cat /tmp/claude-instance-*.json \| jq '.frontend_url'` |
| Find your instance ID | `cat /tmp/claude-instance-*.json \| jq -r '.instance_id'` |
| Manual server start | `./docs/planning/tmux_usage/ensure-server.sh` |
| Force stop server | `tmux kill-session -t claude-<id>-backend` |
| Check idle watcher | `ps aux \| grep idle-watcher` |

## Prerequisites

```bash
# macOS (all standard except jq)
brew install jq

# Linux
apt install tmux jq lsof xxd curl
```

## Debugging Workflow

1. **Check server logs** (most common)
   ```bash
   ID=$(cat /tmp/claude-instance-*.json | jq -r '.instance_id')
   tmux capture-pane -t claude-${ID}-backend -p -S -100
   ```

2. **Check browser console** (via Playwright MCP)
   - `mcp__playwright__browser_console_messages`
   - `mcp__playwright__browser_network_requests`

3. **Check instance status**
   ```bash
   cat /tmp/claude-instance-*.json
   ```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BASE_URL` | Override server discovery |
| `CI` | Use Playwright's webServer instead of tmux |
| `E2E_TEST_MODE` | Bypass SSE streaming for test stability |

## Troubleshooting

### Server not starting
```bash
# Check ensure-server.sh is executable
chmod +x docs/planning/tmux_usage/*.sh

# Check npm script exists
npm run dev:server --dry-run
```

### Wrong server URL in tests
```bash
# Set explicit URL
BASE_URL=http://localhost:3142 npm run test:e2e
```

### Orphaned servers
```bash
# Kill all Claude servers
tmux list-sessions | grep "^claude-" | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
rm /tmp/claude-instance-*.json /tmp/claude-idle-*.timestamp
```

### Idle watcher not cleaning up
```bash
# Check if running
cat /tmp/claude-idle-watcher.pid

# View watcher logs
tail -50 /tmp/claude-idle-watcher.log

# Restart manually
pkill -f idle-watcher.sh
./docs/planning/tmux_usage/idle-watcher.sh &
```

## Enforcement via PreToolUse Hook

A PreToolUse hook prevents Claude Code from manually starting servers. This ensures the on-demand pattern is always used.

**Blocked commands:**
- `npm run dev`, `npm start`
- `next dev`, `next start`
- `node server`, `npx next dev`

**Allowed commands:**
- `npm run test:e2e` (triggers `ensure-server.sh`)
- `./docs/planning/tmux_usage/ensure-server.sh` (direct infrastructure call)
- Any command containing `ensure-server` or `start-dev-tmux`

When blocked, Claude Code receives a helpful error message pointing to this documentation.

**Hook file:** `.claude/hooks/block-manual-server.sh`

## Files

| File | Purpose |
|------|---------|
| `ensure-server.sh` | On-demand server starter (called by Playwright) |
| `start-dev-tmux.sh` | Creates tmux session with Next.js |
| `idle-watcher.sh` | Daemon that kills idle servers |
| `.claude/hooks/start-dev-servers.sh` | SessionStart cleanup (no longer starts servers) |
| `.claude/hooks/cleanup-tmux.sh` | SessionEnd cleanup |
| `.claude/hooks/block-manual-server.sh` | PreToolUse hook blocking direct server starts |
