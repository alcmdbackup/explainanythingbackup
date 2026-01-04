#!/bin/bash
# SessionStart hook: Cleanup stale tmux sessions from previous runs.
# Servers are now started on-demand by ensure-server.sh when tests run.
# This hook only handles cleanup - no server startup at session start.

# --- H5: Check jq dependency explicitly ---
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required but not installed." >&2
  echo "Install with: brew install jq (macOS) or apt install jq (Linux)" >&2
  exit 1
fi

# Read hook input from stdin
read -r input

# Extract session_id and working directory
session_id=$(echo "$input" | jq -r '.session_id // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')

if [ -z "$session_id" ]; then
  echo "ERROR: No session_id provided in hook input" >&2
  exit 1
fi

# --- Clean up stale sessions from ANY worktree ---
# Strategy:
# 1. Instance files older than 4 hours = definitely stale
# 2. tmux sessions with no instance file = orphaned (file was deleted or never created)
# 3. tmux sessions whose instance file points to a dead process = stale
#
# This is safe across worktrees because:
# - All instance files are in /tmp (global)
# - All tmux sessions are prefixed with "claude-" (global namespace)

STALE_HOURS=4

# 1. Clean up instance files older than 4 hours
find /tmp -maxdepth 1 -name "claude-instance-*.json" -mmin +$((STALE_HOURS * 60)) 2>/dev/null | while read -r stale_file; do
  stale_id=$(basename "$stale_file" | sed 's/claude-instance-//; s/.json//')
  echo "Cleaning up stale session (>4h old): $stale_id"

  # Kill tmux sessions for this stale instance
  tmux kill-session -t "claude-${stale_id}-backend" 2>/dev/null || true
  tmux kill-session -t "claude-${stale_id}-frontend" 2>/dev/null || true

  # Remove stale instance file
  rm -f "$stale_file"
done

# 2. Clean up tmux sessions that have no matching instance file
# These are orphaned - the instance file was never created or was deleted
tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^claude-" | while read -r tmux_session; do
  # Extract instance ID from session name (claude-XXXXX-backend -> XXXXX)
  instance_from_tmux=$(echo "$tmux_session" | sed 's/^claude-//; s/-backend$//; s/-frontend$//')

  # Skip if instance file exists (session is legitimate)
  if [ -f "/tmp/claude-instance-${instance_from_tmux}.json" ]; then
    continue
  fi

  echo "Cleaning up orphaned tmux session (no instance file): $tmux_session"
  tmux kill-session -t "$tmux_session" 2>/dev/null || true
done

# 3. Clean up sessions where the tmux process inside has died
# (instance file exists but tmux session is a zombie)
for instance_file in /tmp/claude-instance-*.json; do
  [ -f "$instance_file" ] || continue

  file_id=$(basename "$instance_file" | sed 's/claude-instance-//; s/.json//')
  backend_session="claude-${file_id}-backend"

  # If instance file exists but tmux session doesn't, remove the file
  if ! tmux has-session -t "$backend_session" 2>/dev/null; then
    echo "Cleaning up stale instance file (tmux session gone): $file_id"
    rm -f "$instance_file"
  fi
done
# --- End stale cleanup ---

# Servers are now started on-demand - no startup here
echo "SessionStart cleanup complete. Servers will start on-demand when tests run."
exit 0
