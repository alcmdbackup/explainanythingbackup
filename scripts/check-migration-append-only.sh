#!/usr/bin/env bash
# Blocking append-only check: shipped migrations must not be edited in place.
#
# Editing an already-applied migration silently does NOTHING on environments where it
# already ran (the file won't re-run) — so the change never lands there, creating drift.
# This is exactly how the #1073 ADD CONSTRAINT retrofit had to be done as an in-place
# edit and why prod/staging diverged. Create a NEW migration instead.
#
# Renames (git mv to a later timestamp, e.g. from the ordering check) show as
# delete+add or rename — NOT modify — so they are not flagged here.
#
# Usage: scripts/check-migration-append-only.sh [--base=<ref>]   (default origin/main)
# Per-file bypass: add a line containing `@migration-edit-approved` to each edited file.
# CI additionally honors a `migration-edit-approved` PR label (handled in the workflow).
set -uo pipefail

BASE="origin/main"
for arg in "$@"; do
  case "$arg" in --base=*) BASE="${arg#--base=}" ;; esac
done
MIGDIR="supabase/migrations"

# Two-dot (base tip vs HEAD); --diff-filter=M = in-place content modifications only.
MODIFIED=$(git diff --name-only --diff-filter=M "${BASE}" HEAD -- "$MIGDIR/*.sql" 2>/dev/null || true)
if [ -z "$MODIFIED" ]; then
  echo "No in-place edits to shipped migrations vs $BASE — OK."
  exit 0
fi

BLOCKED=false
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if [ -f "$file" ] && grep -q '@migration-edit-approved' "$file" 2>/dev/null; then
    echo "  allowed (@migration-edit-approved marker): $file"
    continue
  fi
  if [ "$BLOCKED" = false ]; then
    echo "ERROR: migrations are append-only — these shipped migrations were edited in place:"
    BLOCKED=true
  fi
  echo "  $file"
done <<< "$MODIFIED"

if [ "$BLOCKED" = true ]; then
  echo ""
  echo "Editing an already-applied migration is a no-op on environments where it ran -> drift."
  echo "Create a NEW migration instead. If the edit is genuinely safe (e.g. a guard-only"
  echo "retrofit on a not-yet-widely-applied migration), add a line containing"
  echo "'@migration-edit-approved' to each edited file, or apply the 'migration-edit-approved'"
  echo "PR label."
  exit 1
fi
echo "All in-place migration edits carry the @migration-edit-approved marker — OK."
exit 0
