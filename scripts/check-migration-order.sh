#!/usr/bin/env bash
# Blocking timestamp-order + duplicate-version check for newly-added migrations.
#
# Replaces the retired auto-rename workflow (.github/workflows/migration-reorder.yml).
# Instead of silently rewriting filenames in the PR — which resurrected deleted files
# and created orphaned schema_migrations ledger rows (the root of several drift
# incidents) — this FAILS the check and tells the author to rename manually.
#
# Usage: scripts/check-migration-order.sh [--base=<ref>]
#   --base   git ref to compare against (default: origin/main).
#            CI passes origin/<PR base ref> so the check works for main- and
#            production-targeted PRs alike.
#
# Exit codes: 0 = order OK / nothing to check; 1 = out-of-order or duplicate version.
set -euo pipefail

BASE="origin/main"
for arg in "$@"; do
  case "$arg" in
    --base=*) BASE="${arg#--base=}" ;;
  esac
done

MIGDIR="supabase/migrations"

# 1) Duplicate-version check across ALL files in the working tree (absorbed from the
#    retired reorder workflow's duplicate guard).
ALL_TS=$(ls "$MIGDIR"/*.sql 2>/dev/null | xargs -r -I{} basename {} | grep -oE '^[0-9]{14}' | sort || true)
if [ -n "$ALL_TS" ]; then
  DUPES=$(echo "$ALL_TS" | uniq -d || true)
  if [ -n "$DUPES" ]; then
    echo "ERROR: Duplicate migration version(s) detected:"
    while IFS= read -r ts; do
      [ -z "$ts" ] && continue
      echo "  Version $ts:"
      ls "$MIGDIR/${ts}"_* 2>/dev/null | sed 's/^/    /'
    done <<< "$DUPES"
    echo ""
    echo "Rename one colliding file to a unique, later 14-digit timestamp."
    exit 1
  fi
fi

# 2) Out-of-order check: any newly-added migration whose 14-digit timestamp is <= the
#    latest already on BASE would apply out of order (skipped / ledger drift).
LATEST_ON_BASE=$(git ls-tree "$BASE" --name-only "$MIGDIR/" 2>/dev/null \
  | xargs -r -I{} basename {} \
  | grep -oE '^[0-9]{14}' \
  | sort -n | tail -1 || true)

if [ -z "$LATEST_ON_BASE" ]; then
  echo "No migrations on $BASE (or base ref unavailable) — skipping order check."
  exit 0
fi

# Two-dot (base tip vs HEAD), matching the retired reorder workflow's semantics and
# avoiding merge-base resolution under CI's shallow base fetch.
NEW_FILES=$(git diff --name-only --diff-filter=A "${BASE}" HEAD -- "$MIGDIR/*.sql" 2>/dev/null || true)
if [ -z "$NEW_FILES" ]; then
  echo "No newly-added migrations vs $BASE — order OK."
  exit 0
fi

BLOCKED=false
NEXT_TS=$((LATEST_ON_BASE + 1))
while IFS= read -r file; do
  [ -z "$file" ] && continue
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oE '^[0-9]{14}' || true)
  [ -z "$FILE_TS" ] && continue
  if [ "$FILE_TS" -le "$LATEST_ON_BASE" ]; then
    if [ "$BLOCKED" = false ]; then
      echo "ERROR: migration timestamp(s) are not after the latest on $BASE ($LATEST_ON_BASE)."
      echo "Migrations apply in timestamp order; an out-of-order file is skipped or drifts the ledger."
      echo ""
      BLOCKED=true
    fi
    DESCRIPTION=$(echo "$BASENAME" | sed "s/^${FILE_TS}_//")
    echo "  $file"
    echo "    Fix: git mv \"$file\" \"$MIGDIR/${NEXT_TS}_${DESCRIPTION}\""
    NEXT_TS=$((NEXT_TS + 1))
  fi
done <<< "$NEW_FILES"

if [ "$BLOCKED" = true ]; then
  echo ""
  echo "Rename the file(s) above to later timestamps, then push again."
  exit 1
fi

echo "Migration order OK (all newly-added migrations are after $LATEST_ON_BASE on $BASE)."
exit 0
