#!/bin/bash
# Blocks direct dev server commands and file write operations to enforce proper tooling.
# See: docs/planning/tmux_usage/using_tmux_recommendations.md

COMMAND="$TOOL_INPUT"

# Patterns that indicate manual server start attempts
SERVER_PATTERNS=(
  "npm run dev"
  "npm start"
  "next dev"
  "next start"
  "node server"
  "npx next dev"
)

for pattern in "${SERVER_PATTERNS[@]}"; do
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

# Patterns that indicate bash file writes (bypass Edit/Write hooks)
# Only block writes to code directories, allow writes to /tmp, logs, etc.
FILE_WRITE_PATTERNS=(
  "> src/"
  ">> src/"
  "> app/"
  ">> app/"
  "> components/"
  ">> components/"
  "> lib/"
  ">> lib/"
  "> packages/"
  ">> packages/"
  "| tee src/"
  "| tee app/"
  "| tee -a src/"
  "| tee -a app/"
)

for pattern in "${FILE_WRITE_PATTERNS[@]}"; do
  if [[ "$COMMAND" == *"$pattern"* ]]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct file writes via bash are blocked.\n\nUse the Edit or Write tools instead to:\n- Ensure proper workflow enforcement\n- Enable automatic linting\n- Track file changes\n\nExample: Use Edit tool to modify files, not `echo > file`"
  }
}
EOF
    exit 0
  fi
done

# Not a blocked command - allow
exit 0
