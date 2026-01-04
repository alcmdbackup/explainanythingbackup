#!/bin/bash
# Ensures a dev server is running for the current Claude Code instance.
# Starts server on-demand if not already running, resets idle timer.
# Includes crash recovery: detects dead servers and restarts them automatically.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Get instance ID from instance file matching this project
get_instance_id() {
  for f in /tmp/claude-instance-*.json; do
    [ -f "$f" ] || continue
    local proj_root
    proj_root=$(jq -r '.project_root // empty' "$f" 2>/dev/null)
    if [ "$proj_root" = "$PROJECT_ROOT" ]; then
      jq -r '.instance_id' "$f"
      return 0
    fi
  done
  return 1
}

# Check if server is actually responding (not just tmux session alive)
check_server_health() {
  local instance_id="$1"
  local instance_file="/tmp/claude-instance-${instance_id}.json"

  if [ ! -f "$instance_file" ]; then
    return 1
  fi

  local port
  port=$(jq -r '.frontend_port // empty' "$instance_file" 2>/dev/null)
  if [ -z "$port" ]; then
    return 1
  fi

  # Quick health check - server should respond within 2 seconds
  if curl -s -o /dev/null --connect-timeout 2 --max-time 2 "http://localhost:$port" 2>/dev/null; then
    return 0
  fi

  return 1
}

# Clean up stale instance files for crashed servers
cleanup_crashed_instance() {
  local instance_id="$1"
  echo "[ensure-server] Cleaning up crashed instance $instance_id..."

  # Remove instance file
  rm -f "/tmp/claude-instance-${instance_id}.json"

  # Remove idle timestamp
  rm -f "/tmp/claude-idle-${instance_id}.timestamp"

  # Kill tmux session if somehow still exists
  tmux kill-session -t "claude-${instance_id}-backend" 2>/dev/null || true

  # Remove any stale lock
  rmdir "/tmp/claude-server-${instance_id}.lock" 2>/dev/null || true
}

# Check if server already running for this project
INSTANCE_ID=$(get_instance_id 2>/dev/null || echo "")

if [ -n "$INSTANCE_ID" ]; then
  # Found an instance file - check if server is actually alive
  if tmux has-session -t "claude-${INSTANCE_ID}-backend" 2>/dev/null; then
    # Tmux session exists - verify server is responding
    if check_server_health "$INSTANCE_ID"; then
      # Server healthy - just reset idle timer
      touch "/tmp/claude-idle-${INSTANCE_ID}.timestamp"
      echo "[ensure-server] Server already running for instance $INSTANCE_ID"
      exit 0
    else
      # Tmux alive but server not responding - might be starting up or crashed
      # Give it a moment and check again
      sleep 2
      if check_server_health "$INSTANCE_ID"; then
        touch "/tmp/claude-idle-${INSTANCE_ID}.timestamp"
        echo "[ensure-server] Server recovered for instance $INSTANCE_ID"
        exit 0
      fi

      # Server unresponsive - kill and restart
      echo "[ensure-server] Server unresponsive, restarting instance $INSTANCE_ID..."
      cleanup_crashed_instance "$INSTANCE_ID"
      # Keep the same instance ID for restart
    fi
  else
    # Tmux session dead but instance file exists - crashed server
    echo "[ensure-server] Detected crashed server for instance $INSTANCE_ID"
    cleanup_crashed_instance "$INSTANCE_ID"
    # Keep the same instance ID for restart
  fi
fi

# No server running (or crashed and cleaned up) - need to start one
# Generate new instance ID only if we don't have one
if [ -z "$INSTANCE_ID" ]; then
  INSTANCE_ID=$(head -c 8 /dev/urandom | xxd -p)
fi

echo "[ensure-server] Starting server for instance $INSTANCE_ID..."

# Use mkdir for atomic locking (works on macOS and Linux)
LOCK_DIR="/tmp/claude-server-${INSTANCE_ID}.lock"
MAX_WAIT=60
waited=0

while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ $waited -ge $MAX_WAIT ]; then
    echo "[ensure-server] ERROR: Could not acquire lock after ${MAX_WAIT}s" >&2
    exit 1
  fi
  echo "[ensure-server] Another process is starting the server, waiting..."
  sleep 1
  waited=$((waited + 1))

  # Check if server was started by other process
  if tmux has-session -t "claude-${INSTANCE_ID}-backend" 2>/dev/null; then
    touch "/tmp/claude-idle-${INSTANCE_ID}.timestamp"
    echo "[ensure-server] Server started by another process"
    exit 0
  fi
done

# We have the lock - start the server
cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_lock EXIT

"$SCRIPT_DIR/start-dev-tmux.sh" "$INSTANCE_ID"
