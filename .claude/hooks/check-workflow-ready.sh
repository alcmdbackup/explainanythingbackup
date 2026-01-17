#!/bin/bash
# Checks workflow prerequisites before allowing Edit/Write operations.
# Blocks code edits until required docs are read and todos created.

# Read stdin JSON for tool input (use cat instead of read to handle EOF properly)
input=$(cat)

set -e
CWD=$(echo "$input" | jq -r '.cwd // empty')
TOOL_NAME=$(echo "$input" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Change to project directory for git commands
if [ -n "$CWD" ]; then
  cd "$CWD" || exit 0
fi

# --- Bypass Checks ---

# Method 1: Environment variable bypass
if [ "${WORKFLOW_BYPASS:-}" = "true" ]; then
  exit 0
fi

# Get current branch
BRANCH=$(git branch --show-current 2>/dev/null)

# Method 2: Detached HEAD - allow with warning
if [ -z "$BRANCH" ]; then
  if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
    # In rebase - allow
    exit 0
  fi
  echo "Warning: Detached HEAD state - workflow enforcement disabled" >&2
  exit 0
fi

# Method 3: Branch prefix exceptions
BYPASS_PREFIXES=("hotfix/" "docs/" "chore/" "fix/")
for prefix in "${BYPASS_PREFIXES[@]}"; do
  if [[ "$BRANCH" == "$prefix"* ]]; then
    exit 0
  fi
done

# Method 4: Main/master branches - no enforcement
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  exit 0
fi

# --- Branch Name Validation ---

# Validate branch name (alphanumeric, underscore, hyphen, forward slash only)
if [[ ! "$BRANCH" =~ ^[a-zA-Z0-9/_-]+$ ]]; then
  echo "Warning: Invalid branch name characters - workflow enforcement disabled" >&2
  exit 0
fi

# --- Check File Type (only enforce for code files) ---
# These checks run BEFORE project detection so docs/config edits are always allowed

# Allow edits to project docs (research, planning, progress, status)
if [[ "$FILE_PATH" == *"docs/planning/"* ]]; then
  exit 0
fi

# Allow edits to documentation
if [[ "$FILE_PATH" == *"docs/"* ]] || [[ "$FILE_PATH" == *".md" ]]; then
  exit 0
fi

# Allow edits to most config files (but not package.json or tsconfig)
if [[ "$FILE_PATH" == *".json" ]] || [[ "$FILE_PATH" == *".yaml" ]] || [[ "$FILE_PATH" == *".yml" ]] || [[ "$FILE_PATH" == *".toml" ]]; then
  if [[ "$FILE_PATH" != *"package.json"* ]] && [[ "$FILE_PATH" != *"tsconfig"* ]]; then
    exit 0
  fi
fi

# --- Block .claude/plans/* Writes (always blocked) ---

if [[ "$FILE_PATH" == *".claude/plans/"* ]]; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Do not use internal plan files.\n\nCreate a project folder at docs/planning/<branch_name>/ and write your plan to _planning.md there.\n\nProject planning docs should live in your project folder, not in .claude/plans/"
  }
}
EOF
  exit 0
fi

# --- Project Detection ---

PROJECT_DIR="docs/planning/${BRANCH}"
STATUS_FILE="${PROJECT_DIR}/_status.json"

# No project folder for this branch - BLOCK code edits
if [ ! -d "$PROJECT_DIR" ]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "No project folder found for branch '${BRANCH}'.\n\nCode edits require a project folder at:\n  docs/planning/${BRANCH}/\n\nTo set up a new project:\n1. Create folder: mkdir -p docs/planning/${BRANCH}\n2. Create _status.json, _research.md, _planning.md, _progress.md\n3. Read /docs/docs_overall/getting_started.md\n4. Read /docs/docs_overall/project_workflow.md\n5. Create todos with TodoWrite\n\nOr use a bypass branch prefix: hotfix/, fix/, docs/, chore/"
  }
}
EOF
  exit 0
fi

# Legacy project without _status.json - allow (migration exemption)
if [ ! -f "$STATUS_FILE" ]; then
  exit 0
fi

# --- Block Direct _status.json Writes ---

if [[ "$FILE_PATH" == *"_status.json"* ]]; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct edits to _status.json are blocked.\n\nThis file is managed automatically by workflow hooks.\nPrerequisites are tracked when you read the required docs."
  }
}
EOF
  exit 0
fi

# --- Branch Mismatch Detection ---

EXPECTED_BRANCH=$(jq -r '.branch // empty' "$STATUS_FILE" 2>/dev/null)
if [ -n "$EXPECTED_BRANCH" ] && [ "$EXPECTED_BRANCH" != "$BRANCH" ]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Branch mismatch detected!\n\nStatus file expects: $EXPECTED_BRANCH\nCurrent branch: $BRANCH\n\nEither:\n1. Switch back: git checkout $EXPECTED_BRANCH\n2. Or start a new project for this branch"
  }
}
EOF
  exit 0
fi

# --- Prerequisite Checks ---

GETTING_STARTED_READ=$(jq -r '.prerequisites.getting_started_read // empty' "$STATUS_FILE" 2>/dev/null)
PROJECT_WORKFLOW_READ=$(jq -r '.prerequisites.project_workflow_read // empty' "$STATUS_FILE" 2>/dev/null)
TODOS_CREATED=$(jq -r '.prerequisites.todos_created // empty' "$STATUS_FILE" 2>/dev/null)

MISSING=()
if [ -z "$GETTING_STARTED_READ" ]; then
  MISSING+=("getting_started.md")
fi
if [ -z "$PROJECT_WORKFLOW_READ" ]; then
  MISSING+=("project_workflow.md")
fi
if [ -z "$TODOS_CREATED" ]; then
  MISSING+=("TodoWrite (create task list)")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  MISSING_LIST=$(printf '%s\\n' "${MISSING[@]}" | sed 's/^/  - /')
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Prerequisites not met for code edits.\n\nMissing:\n${MISSING_LIST}\n\nBefore editing code:\n1. Read /docs/docs_overall/getting_started.md\n2. Read /docs/docs_overall/project_workflow.md\n3. Create todos using TodoWrite\n\nStatus: ${STATUS_FILE}"
  }
}
EOF
  exit 0
fi

# --- Test File Prerequisite Check ---
# Only enforce testing_overview.md for test files

is_test_file() {
  local path="$1"
  # Test directories
  [[ "$path" == *"/__tests__/"* ]] && return 0
  [[ "$path" == *"/testing/"* ]] && return 0
  # Test file suffixes
  [[ "$path" == *.test.ts ]] && return 0
  [[ "$path" == *.test.tsx ]] && return 0
  [[ "$path" == *.spec.ts ]] && return 0
  [[ "$path" == *.spec.tsx ]] && return 0
  [[ "$path" == *.integration.test.ts ]] && return 0
  [[ "$path" == *.esm.test.ts ]] && return 0
  # Test config files
  [[ "$path" == *"jest.config"* ]] && return 0
  [[ "$path" == *"jest.setup"* ]] && return 0
  [[ "$path" == *"playwright.config"* ]] && return 0
  return 1
}

if is_test_file "$FILE_PATH"; then
  TESTING_OVERVIEW_READ=$(jq -r '.prerequisites.testing_overview_read // empty' "$STATUS_FILE" 2>/dev/null)

  if [ -z "$TESTING_OVERVIEW_READ" ]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test file prerequisite not met.\n\nBefore editing test files, read:\n  /docs/docs_overall/testing_overview.md\n\nThis ensures familiarity with:\n- [TEST] prefix convention\n- Auto-tracking cleanup system\n- Testing tiers and commands\n- CI/CD workflow behavior"
  }
}
EOF
    exit 0
  fi
fi

# --- Frontend File Prerequisite Check ---
# Only enforce design_style_guide.md for frontend files

is_frontend_file() {
  local path="$1"
  # Component files
  [[ "$path" == *"/components/"* ]] && return 0
  # App pages (TSX files in app directory)
  [[ "$path" == *"/app/"* ]] && [[ "$path" == *.tsx ]] && return 0
  # Styling files
  [[ "$path" == *.css ]] && return 0
  [[ "$path" == *"tailwind.config"* ]] && return 0
  # Editor files (Lexical)
  [[ "$path" == *"/editorFiles/"* ]] && return 0
  # Hooks (often contain UI logic)
  [[ "$path" == *"/hooks/"* ]] && return 0
  # Reducers (UI state management)
  [[ "$path" == *"/reducers/"* ]] && return 0
  # Contexts (UI contexts)
  [[ "$path" == *"/contexts/"* ]] && return 0
  return 1
}

if is_frontend_file "$FILE_PATH"; then
  DESIGN_STYLE_GUIDE_READ=$(jq -r '.prerequisites.design_style_guide_read // empty' "$STATUS_FILE" 2>/dev/null)

  if [ -z "$DESIGN_STYLE_GUIDE_READ" ]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Frontend file prerequisite not met.\n\nBefore editing frontend/UI files, read:\n  /docs/docs_overall/design_style_guide.md\n\nThis ensures familiarity with:\n- Midnight Scholar design system\n- CSS variable tokens (--surface-*, --accent-*, --text-*)\n- Typography tokens (font-display, font-body, font-ui)\n- Shadow system (shadow-warm-*)\n- Border radius tokens (rounded-page, rounded-book)"
  }
}
EOF
    exit 0
  fi
fi

# All checks passed - allow the operation
exit 0
