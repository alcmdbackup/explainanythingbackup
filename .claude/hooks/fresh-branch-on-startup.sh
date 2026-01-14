#!/bin/bash
# Creates a fresh branch from remote main on startup, unless resuming.
# Skips if already on a session/* branch from a previous startup.

input=$(cat)
SOURCE=$(echo "$input" | jq -r '.source // empty')
CWD=$(echo "$input" | jq -r '.cwd // empty')

cd "$CWD" || exit 0

# Only run on fresh startup, not resume
if [ "$SOURCE" != "startup" ]; then
  exit 0
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)

# Skip if already on a session branch (prevents double-switching)
if [[ "$CURRENT_BRANCH" == session/* ]]; then
  echo "Already on session branch: $CURRENT_BRANCH"
  exit 0
fi

# Skip if on main/master (user explicitly wants to be here)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  # Generate branch name with timestamp
  BRANCH_NAME="session/$(date +%Y%m%d_%H%M%S)"

  # Fetch and create fresh branch
  git fetch origin main 2>/dev/null

  if git checkout -b "$BRANCH_NAME" origin/main 2>/dev/null; then
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Started fresh session on branch: $BRANCH_NAME (based on origin/main). Previous branch was: $CURRENT_BRANCH"
  }
}
EOF
  else
    echo "Warning: Could not create fresh branch, staying on $CURRENT_BRANCH" >&2
  fi
  exit 0
fi

# On a feature branch - inform but don't switch
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Continuing on existing branch: $CURRENT_BRANCH. Use 'claude --continue' or 'claude -c' to explicitly resume work."
  }
}
EOF

exit 0
