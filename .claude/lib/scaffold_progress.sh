#!/usr/bin/env bash
# Idempotent _progress.md writer.
# Usage: bash .claude/lib/scaffold_progress.sh <project-folder> <project-name>
# No-op if the file already exists.

set -euo pipefail

PROJECT_DIR="${1:?project folder path required}"
PROJECT_NAME="${2:?project name required}"
TARGET="${PROJECT_DIR}/${PROJECT_NAME}_progress.md"

if [[ -f "$TARGET" ]]; then
  echo "scaffold_progress: $TARGET exists, skipping" >&2
  exit 0
fi

mkdir -p "$PROJECT_DIR"

cat > "$TARGET" <<'TEMPLATE'
# Progress

## Phase 1
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

### User Clarifications
[Questions asked and answers received]
TEMPLATE

echo "scaffold_progress: wrote $TARGET" >&2
