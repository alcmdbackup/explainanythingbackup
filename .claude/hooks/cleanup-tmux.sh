#!/bin/bash
# Cleanup tmux sessions for this Claude Code instance.
# Called automatically by SessionEnd hook when Claude Code exits.

# --- H5: Check jq dependency explicitly ---
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required but not installed." >&2
  exit 1
fi

# Read hook input from stdin (JSON with session_id, reason, etc.)
read -r input

# Extract session_id from hook input
session_id=$(echo "$input" | jq -r '.session_id // empty')

if [ -z "$session_id" ]; then
  echo "ERROR: No session_id provided, skipping cleanup" >&2
  exit 1
fi

# Kill tmux sessions prefixed with this session_id
# Use array to track killed sessions (avoids subshell variable scope issue)
killed_sessions=()
while IFS= read -r session; do
  if [[ "$session" == "claude-${session_id}"* ]]; then
    if tmux kill-session -t "$session" 2>/dev/null; then
      echo "Killed tmux session: $session"
      killed_sessions+=("$session")
    fi
  fi
done < <(tmux list-sessions -F "#{session_name}" 2>/dev/null)

echo "Killed ${#killed_sessions[@]} tmux session(s)"

# Clean up instance info file
INSTANCE_INFO="/tmp/claude-instance-${session_id}.json"
if [ -f "$INSTANCE_INFO" ]; then
  rm -f "$INSTANCE_INFO"
  echo "Removed instance info: $INSTANCE_INFO"
fi

# Clean up log files (optional - comment out to preserve logs)
# PROJECT_ROOT=$(echo "$input" | jq -r '.cwd // empty')
# if [ -n "$PROJECT_ROOT" ]; then
#   rm -f "$PROJECT_ROOT/server-${session_id}.log"
#   rm -f "$PROJECT_ROOT/client-${session_id}.log"
# fi

exit 0
