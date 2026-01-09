#!/bin/bash
# Tracks prerequisite completion (doc reads, todo creation) in project _status.json.
# PostToolUse hook for Read and TodoWrite tools.

# Read stdin JSON for tool input
read -r input
CWD=$(echo "$input" | jq -r '.cwd // empty')
TOOL_NAME=$(echo "$input" | jq -r '.tool_name // empty')

# For Read tool, get file_path from tool_input
# For TodoWrite, we just track that it was called
if [ "$TOOL_NAME" = "Read" ]; then
  FILE_PATH=$(echo "$input" | jq -r '.tool_input.file_path // empty')
elif [ "$TOOL_NAME" = "TodoWrite" ]; then
  FILE_PATH=""  # Not applicable for TodoWrite
else
  # Unknown tool - exit silently
  exit 0
fi

# Change to project directory for git commands
if [ -n "$CWD" ]; then
  cd "$CWD" || exit 0
fi

# Get current branch
BRANCH=$(git branch --show-current 2>/dev/null)

# No branch or special states - skip tracking
if [ -z "$BRANCH" ]; then
  exit 0
fi

# Skip bypass branches
BYPASS_PREFIXES=("hotfix/" "docs/" "chore/" "fix/")
for prefix in "${BYPASS_PREFIXES[@]}"; do
  if [[ "$BRANCH" == "$prefix"* ]]; then
    exit 0
  fi
done

# Skip main/master
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  exit 0
fi

# Find project directory
PROJECT_DIR="docs/planning/${BRANCH}"
STATUS_FILE="${PROJECT_DIR}/_status.json"

# No project folder - skip
if [ ! -d "$PROJECT_DIR" ]; then
  exit 0
fi

# --- Determine what to track ---

FIELD_TO_UPDATE=""
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$TOOL_NAME" = "Read" ]; then
  if [[ "$FILE_PATH" == *"getting_started.md"* ]]; then
    FIELD_TO_UPDATE=".prerequisites.getting_started_read"
  elif [[ "$FILE_PATH" == *"project_workflow.md"* ]]; then
    FIELD_TO_UPDATE=".prerequisites.project_workflow_read"
  fi
elif [ "$TOOL_NAME" = "TodoWrite" ]; then
  FIELD_TO_UPDATE=".prerequisites.todos_created"
fi

# Nothing to track
if [ -z "$FIELD_TO_UPDATE" ]; then
  exit 0
fi

# --- Create _status.json if it doesn't exist ---

if [ ! -f "$STATUS_FILE" ]; then
  cat > "$STATUS_FILE" << EOF
{
  "project": "$BRANCH",
  "branch": "$BRANCH",
  "created_at": "$TIMESTAMP",
  "prerequisites": {}
}
EOF
fi

# --- Atomic update with locking ---

LOCK_DIR="${STATUS_FILE}.lock"

# Acquire lock (with timeout)
acquire_lock() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ $waited -ge 50 ]; then
      echo "Warning: Could not acquire lock for status update" >&2
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

release_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

# Try to acquire lock
if ! acquire_lock; then
  exit 0  # Fail silently - don't block the operation
fi

# Ensure lock is released on exit
trap release_lock EXIT

# Check if field already has a value (don't overwrite)
EXISTING=$(jq -r "$FIELD_TO_UPDATE // empty" "$STATUS_FILE" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  release_lock
  exit 0
fi

# Update status file atomically
TEMP_FILE="${STATUS_FILE}.tmp.$$"
if jq "$FIELD_TO_UPDATE = \"$TIMESTAMP\"" "$STATUS_FILE" > "$TEMP_FILE" 2>/dev/null; then
  mv "$TEMP_FILE" "$STATUS_FILE"
else
  rm -f "$TEMP_FILE"
  echo "Warning: Failed to update status file" >&2
fi

release_lock
exit 0
