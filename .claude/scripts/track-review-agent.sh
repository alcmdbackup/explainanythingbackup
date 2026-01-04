#!/bin/bash
# Track subagent completion for plan review loops
# Called by SubagentStop hook when Task agents complete

set -e

STATE_DIR=".claude/review-state"
mkdir -p "$STATE_DIR"

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract session info
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Log agent completion
echo "{\"timestamp\": \"$TIMESTAMP\", \"session_id\": \"$SESSION_ID\", \"event\": \"agent_completed\"}" >> "$STATE_DIR/agent-completions.jsonl"

# Exit 0 to allow agent to complete normally
exit 0
