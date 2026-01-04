#!/bin/bash
# Blocks direct dev server commands to enforce on-demand tmux infrastructure.
# See: docs/planning/tmux_usage/using_tmux_recommendations.md

COMMAND="$TOOL_INPUT"

# Patterns that indicate manual server start attempts
BLOCKED_PATTERNS=(
  "npm run dev"
  "npm start"
  "next dev"
  "next start"
  "node server"
  "npx next dev"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if [[ "$COMMAND" == *"$pattern"* ]]; then
    # Allow if called from infrastructure scripts
    if [[ "$COMMAND" == *"ensure-server"* ]] || [[ "$COMMAND" == *"start-dev-tmux"* ]]; then
      exit 0
    fi

    # Block with explanation
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct server starts are blocked. Use the on-demand tmux infrastructure instead:\n\n1. Run tests: `npm run test:e2e` (auto-starts server)\n2. Manual start: `./docs/planning/tmux_usage/ensure-server.sh`\n3. Check running servers: `cat /tmp/claude-instance-*.json`\n\nSee: docs/planning/tmux_usage/using_tmux_recommendations.md"
  }
}
EOF
    exit 0
  fi
done

# Not a server command - allow
exit 0
