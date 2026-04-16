#!/usr/bin/env bash
# Idempotent _research.md writer.
# Usage: bash .claude/lib/scaffold_research.sh <project-folder> <project-name>
# No-op if the file already exists.

set -euo pipefail

PROJECT_DIR="${1:?project folder path required}"
PROJECT_NAME="${2:?project name required}"
TARGET="${PROJECT_DIR}/${PROJECT_NAME}_research.md"

if [[ -f "$TARGET" ]]; then
  echo "scaffold_research: $TARGET exists, skipping" >&2
  exit 0
fi

mkdir -p "$PROJECT_DIR"

# Single-quoted heredoc delimiter prevents $VAR expansion of user content
# (here there is none, but enforce the pattern consistently).
cat > "$TARGET" <<'TEMPLATE'
# Research

## Problem Statement
[Description of the problem]

## Requirements
[Detailed task list / requirements]

## High Level Summary
[Summary of findings]

## Documents Read
- [list of docs reviewed]

## Code Files Read
- [list of code files reviewed]
TEMPLATE

echo "scaffold_research: wrote $TARGET" >&2
