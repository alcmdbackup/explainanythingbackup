#!/bin/bash
# Background daemon that monitors server idle time and kills servers after 5 minutes of inactivity.
# Self-terminates when no servers remain to avoid zombie processes.

IDLE_TIMEOUT_SECONDS=300  # 5 minutes
CHECK_INTERVAL=60         # Check every 60 seconds

# Ensure only one watcher runs at a time
WATCHER_PID_FILE="/tmp/claude-idle-watcher.pid"

# Check if another watcher is already running
if [ -f "$WATCHER_PID_FILE" ]; then
  existing_pid=$(cat "$WATCHER_PID_FILE")
  if kill -0 "$existing_pid" 2>/dev/null; then
    echo "[idle-watcher] Already running with PID $existing_pid"
    exit 0
  fi
  # Stale PID file, remove it
  rm -f "$WATCHER_PID_FILE"
fi

# Write our PID
echo $$ > "$WATCHER_PID_FILE"

cleanup() {
  rm -f "$WATCHER_PID_FILE"
  exit 0
}
trap cleanup EXIT INT TERM

echo "[idle-watcher] Started with PID $$, timeout=${IDLE_TIMEOUT_SECONDS}s"

while true; do
  servers_found=0

  for timestamp_file in /tmp/claude-idle-*.timestamp; do
    [ -f "$timestamp_file" ] || continue
    servers_found=1

    # Extract instance ID from filename: claude-idle-XXXX.timestamp -> XXXX
    instance_id=$(basename "$timestamp_file" | sed 's/^claude-idle-//; s/\.timestamp$//')

    # Get file age in seconds
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS: use stat with -f
      file_time=$(stat -f %m "$timestamp_file")
    else
      # Linux: use stat with -c
      file_time=$(stat -c %Y "$timestamp_file")
    fi
    now=$(date +%s)
    age=$((now - file_time))

    if [ $age -gt $IDLE_TIMEOUT_SECONDS ]; then
      echo "[idle-watcher] Instance $instance_id idle for ${age}s (>${IDLE_TIMEOUT_SECONDS}s), killing..."

      # Kill tmux session
      if tmux kill-session -t "claude-${instance_id}-backend" 2>/dev/null; then
        echo "[idle-watcher] Killed tmux session claude-${instance_id}-backend"
      fi

      # Remove instance file
      instance_file="/tmp/claude-instance-${instance_id}.json"
      if [ -f "$instance_file" ]; then
        rm -f "$instance_file"
        echo "[idle-watcher] Removed $instance_file"
      fi

      # Remove timestamp file
      rm -f "$timestamp_file"
      echo "[idle-watcher] Removed $timestamp_file"
    else
      remaining=$((IDLE_TIMEOUT_SECONDS - age))
      echo "[idle-watcher] Instance $instance_id active, ${remaining}s until timeout"
    fi
  done

  # If no servers found, check if any tmux sessions exist
  if [ $servers_found -eq 0 ]; then
    claude_sessions=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^claude-" | wc -l | tr -d ' ')
    if [ "$claude_sessions" -eq 0 ]; then
      echo "[idle-watcher] No servers remaining, exiting"
      exit 0
    fi
  fi

  sleep $CHECK_INTERVAL
done
