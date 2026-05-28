#!/bin/bash
# Startup script for running isolated Next.js dev server in tmux session.
# Each Claude Code instance gets its own server with unique session name and port.
# Cleanup happens automatically via SessionEnd hook when Claude Code exits.

set -e

# Get the project root (parent of docs/planning/tmux_usage)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# --- H5: Check required dependencies explicitly ---
check_dependency() {
  if ! command -v "$1" &> /dev/null; then
    echo "ERROR: Required dependency '$1' not found. Install with: $2" >&2
    exit 1
  fi
}

check_dependency "jq" "brew install jq (macOS) or apt install jq (Linux)"
check_dependency "tmux" "brew install tmux (macOS) or apt install tmux (Linux)"
check_dependency "lsof" "Should be pre-installed on macOS/Linux"

# --- H4: Instance ID with 8 hex chars (increased entropy: 4 billion possibilities) ---
INSTANCE_ID="${1:-$(head -c 8 /dev/urandom | xxd -p)}"

# Session name for the unified Next.js server
SERVER_SESSION="claude-${INSTANCE_ID}-backend"

# Generate unique port based on instance ID hash (deterministic per instance)
# Port range: 3100-3999 (900 ports available)
HASH=$(echo -n "$INSTANCE_ID" | md5 -q 2>/dev/null || echo -n "$INSTANCE_ID" | md5sum | cut -c1-8)
HASH_NUM=$((16#${HASH:0:4}))
SERVER_PORT=$((3100 + (HASH_NUM % 900)))

# --- H3: Port-finding with timeout (max 100 iterations) ---
MAX_PORT_ATTEMPTS=100
port_attempts=0
while lsof -i ":$SERVER_PORT" >/dev/null 2>&1; do
  SERVER_PORT=$((SERVER_PORT + 1))
  port_attempts=$((port_attempts + 1))
  if [ $port_attempts -ge $MAX_PORT_ATTEMPTS ]; then
    echo "ERROR: Could not find available port after $MAX_PORT_ATTEMPTS attempts (ports 3100-$SERVER_PORT all occupied)" >&2
    exit 1
  fi
done

# Log file includes instance ID
SERVER_LOG="server-${INSTANCE_ID}.log"

echo "Starting isolated dev server for instance: $INSTANCE_ID"
echo "Project root: $PROJECT_ROOT"
echo "Server port: $SERVER_PORT"

# Kill existing session for this instance if any
tmux kill-session -t "$SERVER_SESSION" 2>/dev/null || true

# --- C2: Verify npm script exists before starting ---
# Note: npm run --dry-run doesn't work in npm 7+ (it actually runs the command)
# Instead, check package.json directly for the script
if ! grep -q '"dev:server"' "$PROJECT_ROOT/package.json"; then
  echo "ERROR: npm script 'dev:server' not found in package.json" >&2
  echo "Add this to your package.json scripts:" >&2
  echo '  "dev:server": "next dev --turbopack"' >&2
  exit 1
fi

# Start Next.js dev server with unique port
cd "$PROJECT_ROOT"
tmux new-session -d -s "$SERVER_SESSION" -c "$PROJECT_ROOT" \
  "PORT=$SERVER_PORT npm run dev:server 2>&1 | tee $SERVER_LOG; echo 'Server exited with code: '\$?"

# --- C3 & H1: Wait for server to be ready before writing instance file ---
echo "Waiting for server to start..."
MAX_WAIT=30
waited=0
server_ready=false

while [ $waited -lt $MAX_WAIT ]; do
  # Check if tmux session is still alive
  if ! tmux has-session -t "$SERVER_SESSION" 2>/dev/null; then
    echo "ERROR: Server process exited unexpectedly. Check $PROJECT_ROOT/$SERVER_LOG for details." >&2
    exit 1
  fi

  # Check if server is responding on the port
  if curl -s -o /dev/null -w '' --connect-timeout 1 "http://localhost:$SERVER_PORT" 2>/dev/null; then
    server_ready=true
    break
  fi

  sleep 1
  waited=$((waited + 1))
  echo "  Waiting... ($waited/$MAX_WAIT seconds)"
done

if [ "$server_ready" = false ]; then
  echo "WARNING: Server may not be fully ready after ${MAX_WAIT}s, but tmux session is alive."
  echo "Check logs: tmux capture-pane -t $SERVER_SESSION -p -S -50"
fi

# --- Pre-warm critical routes to reduce cold start times ---
# This compiles the most commonly accessed pages in the background
warm_cache() {
  local url="http://localhost:$SERVER_PORT"
  echo "Pre-warming cache for critical routes..."

  # Warm in background with timeout, don't block startup
  (
    # Wait a moment for server to be fully stable
    sleep 2

    # Critical routes in order of importance
    # Use curl with short timeout - we just want to trigger compilation
    for route in "/login" "/" "/results?q=test" "/api/client-logs"; do
      curl -s -o /dev/null --connect-timeout 5 --max-time 120 "${url}${route}" 2>/dev/null &
    done

    # Wait for all background curls to complete (or timeout)
    wait

    echo "[pre-warm] Cache warming complete"
  ) >> "$PROJECT_ROOT/$SERVER_LOG" 2>&1 &

  echo "  Cache warming started in background (check logs for progress)"
}

# Only pre-warm if not explicitly disabled
if [ "${SKIP_PREWARM:-}" != "true" ]; then
  warm_cache
fi

# Write instance info to temp file for other tools to discover
# Only written AFTER server verification (fixes C3 and H1)
INSTANCE_INFO="/tmp/claude-instance-${INSTANCE_ID}.json"
cat > "$INSTANCE_INFO" << EOF
{
  "instance_id": "$INSTANCE_ID",
  "backend_session": "$SERVER_SESSION",
  "frontend_session": "$SERVER_SESSION",
  "backend_port": $SERVER_PORT,
  "frontend_port": $SERVER_PORT,
  "backend_url": "http://localhost:$SERVER_PORT",
  "frontend_url": "http://localhost:$SERVER_PORT",
  "backend_log": "$PROJECT_ROOT/$SERVER_LOG",
  "frontend_log": "$PROJECT_ROOT/$SERVER_LOG",
  "project_root": "$PROJECT_ROOT",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Create idle timestamp file for the watcher
IDLE_TIMESTAMP="/tmp/claude-idle-${INSTANCE_ID}.timestamp"
touch "$IDLE_TIMESTAMP"
echo "Created idle timestamp: $IDLE_TIMESTAMP"

# Start idle watcher if not already running
WATCHER_SCRIPT="$SCRIPT_DIR/idle-watcher.sh"
if [ -x "$WATCHER_SCRIPT" ]; then
  # Run watcher in background, detached from this process
  nohup "$WATCHER_SCRIPT" >> /tmp/claude-idle-watcher.log 2>&1 &
  disown
  echo "Started idle watcher (5 min timeout)"
fi

echo ""
echo "Dev server started in tmux session:"
tmux list-sessions | grep "claude-${INSTANCE_ID}" || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Instance ID: $INSTANCE_ID"
echo ""
echo "URL: http://localhost:$SERVER_PORT"
echo ""
echo "Claude Code can access logs with:"
echo "  tmux capture-pane -t $SERVER_SESSION -p -S -100"
echo ""
echo "Instance info saved to: $INSTANCE_INFO"
echo ""
echo "To stop (or let SessionEnd hook auto-cleanup):"
echo "  tmux kill-session -t $SERVER_SESSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Output just the instance ID for easy capture by calling scripts
echo ""
echo "INSTANCE_ID=$INSTANCE_ID"
