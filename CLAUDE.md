# My defaults
- Always start by reading /docs/docs_overall/getting_started.md
- Always run frontend and backend in tmux so that can easily tail logs for debugging when needed
- Include comments at the top of every file explaining in 1-2 sentences what the file does.

## Debugging with tmux Dev Servers

Dev servers are automatically started by SessionStart hooks. Access logs via:

```bash
# 1. Find your instance
cat /tmp/claude-instance-*.json | jq -r '.instance_id'
# Output: abc123

# 2. View server logs (last 100 lines)
tmux capture-pane -t claude-abc123-backend -p -S -100

# 3. View frontend logs
tmux capture-pane -t claude-abc123-frontend -p -S -100

# 4. Or use log files directly
tail -100 server-abc123.log
tail -100 client-abc123.log
```

For full debugging workflow, see: `docs/planning/tmux_usage/using_tmux_recommendations.md`

## Server Management Rules

**NEVER manually start dev servers.** The project uses on-demand tmux server management.

### What NOT to do:
- `npm run dev` or `npm run dev:server` directly
- `next dev` or any direct Next.js server commands
- Starting servers in background with `&`
- Any manual server startup

### What TO do instead:
- Run `npm run test:e2e` - servers start automatically via `ensure-server.sh`
- Use `./docs/planning/tmux_usage/ensure-server.sh` if you need a server outside tests
- Check `/tmp/claude-instance-*.json` for running server URLs
- View logs via `tmux capture-pane -t claude-<id>-backend -p -S -100`

Servers are managed by the tmux infrastructure and will auto-shutdown after 5 minutes idle.
See: `docs/planning/tmux_usage/using_tmux_recommendations.md`

