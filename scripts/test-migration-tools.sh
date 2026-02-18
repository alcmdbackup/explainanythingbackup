#!/usr/bin/env bash
# Tests for migration infrastructure: pre-commit hook and reorder logic.
# Run: bash scripts/test-migration-tools.sh

set -euo pipefail

PASS=0
FAIL=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$SCRIPT_DIR/.githooks/pre-commit"

# ── Helpers ──────────────────────────────────────────────────

setup_repo() {
  local tmpdir
  tmpdir=$(mktemp -d)
  cd "$tmpdir"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  mkdir -p supabase/migrations
  echo "$tmpdir"
}

cleanup_repo() {
  cd "$SCRIPT_DIR"
  rm -rf "$1"
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected to contain '$needle')"
    FAIL=$((FAIL + 1))
  fi
}

# ── Pre-commit hook tests ───────────────────────────────────

echo "=== Pre-commit hook tests ==="

echo ""
echo "Test 1: Hook blocks commit with stale migration timestamp"
REPO=$(setup_repo)
# Simulate origin/main with a migration
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main  # fake origin/main branch
git checkout -q -b feature
# Add a migration with an older timestamp
touch supabase/migrations/20260214000001_new_feature.sql
git add supabase/migrations/20260214000001_new_feature.sql
OUTPUT=$(bash "$HOOK" 2>&1 || true)
EXIT_CODE=$?
# The hook should detect that 20260214000001 <= 20260215000005
assert_contains "detects stale timestamp" "ERROR: Migration timestamp" "$OUTPUT"
assert_contains "shows fix suggestion" "git mv" "$OUTPUT"
assert_contains "shows bypass" "no-verify" "$OUTPUT"
cleanup_repo "$REPO"

echo ""
echo "Test 2: Hook allows commit with valid migration timestamp"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
# Add a migration with a newer timestamp
touch supabase/migrations/20260216000001_new_feature.sql
git add supabase/migrations/20260216000001_new_feature.sql
EXIT_CODE=0
bash "$HOOK" 2>&1 || EXIT_CODE=$?
assert_eq "allows valid timestamp" "0" "$EXIT_CODE"
cleanup_repo "$REPO"

echo ""
echo "Test 3: Hook skips when no migration files are staged"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
# Stage a non-migration file
touch README.md
git add README.md
EXIT_CODE=0
bash "$HOOK" 2>&1 || EXIT_CODE=$?
assert_eq "skips non-migration files" "0" "$EXIT_CODE"
cleanup_repo "$REPO"

echo ""
echo "Test 4: Hook handles multiple stale migrations"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
touch supabase/migrations/20260213000001_first.sql
touch supabase/migrations/20260214000001_second.sql
git add supabase/migrations/
OUTPUT=$(bash "$HOOK" 2>&1 || true)
# Should show both files
assert_contains "detects first stale file" "20260213000001" "$OUTPUT"
assert_contains "detects second stale file" "20260214000001" "$OUTPUT"
cleanup_repo "$REPO"

# ── Reorder logic tests ─────────────────────────────────────

echo ""
echo "=== Migration reorder logic tests ==="

echo ""
echo "Test 5: Reorder renames out-of-order migration"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
# Add out-of-order migration
touch supabase/migrations/20260214000001_new_feature.sql
git add supabase/migrations/20260214000001_new_feature.sql
git commit -q -m "add migration"

# Run the reorder logic inline (simulating the Action)
LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | grep -oP '^\d{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oP '^\d{14}' || true)
  [ -z "$FILE_TS" ] && continue
  if [ "$FILE_TS" -le "$LATEST_ON_MAIN" ]; then
    DESCRIPTION=$(echo "$BASENAME" | sed "s/^${FILE_TS}_//")
    NEW_NAME="supabase/migrations/${NEXT_TS}_${DESCRIPTION}"
    git mv "$file" "$NEW_NAME"
    NEXT_TS=$((NEXT_TS + 1))
    RENAMED=true
  fi
done <<< "$NEW_FILES"

assert_eq "renamed flag is true" "true" "$RENAMED"
# Check the new filename exists
RENAMED_FILE=$(ls supabase/migrations/ | grep "20260215000006")
assert_contains "file renamed with correct timestamp" "20260215000006_new_feature.sql" "$RENAMED_FILE"
cleanup_repo "$REPO"

echo ""
echo "Test 6: Reorder skips already-valid migrations"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
# Add valid migration (timestamp > main's latest)
touch supabase/migrations/20260216000001_valid.sql
git add supabase/migrations/20260216000001_valid.sql
git commit -q -m "add migration"

LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | grep -oP '^\d{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oP '^\d{14}' || true)
  [ -z "$FILE_TS" ] && continue
  if [ "$FILE_TS" -le "$LATEST_ON_MAIN" ]; then
    DESCRIPTION=$(echo "$BASENAME" | sed "s/^${FILE_TS}_//")
    git mv "$file" "supabase/migrations/${NEXT_TS}_${DESCRIPTION}"
    NEXT_TS=$((NEXT_TS + 1))
    RENAMED=true
  fi
done <<< "$NEW_FILES"

assert_eq "no rename needed" "false" "$RENAMED"
# Original file should still exist
ORIGINAL=$(ls supabase/migrations/ | grep "20260216000001")
assert_contains "original file unchanged" "20260216000001_valid.sql" "$ORIGINAL"
cleanup_repo "$REPO"

echo ""
echo "Test 7: Reorder handles multiple out-of-order migrations"
REPO=$(setup_repo)
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
git checkout -q -b origin/main
git checkout -q -b feature
touch supabase/migrations/20260213000001_alpha.sql
touch supabase/migrations/20260214000001_beta.sql
git add supabase/migrations/
git commit -q -m "add migrations"

LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | grep -oP '^\d{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oP '^\d{14}' || true)
  [ -z "$FILE_TS" ] && continue
  if [ "$FILE_TS" -le "$LATEST_ON_MAIN" ]; then
    DESCRIPTION=$(echo "$BASENAME" | sed "s/^${FILE_TS}_//")
    git mv "$file" "supabase/migrations/${NEXT_TS}_${DESCRIPTION}"
    NEXT_TS=$((NEXT_TS + 1))
    RENAMED=true
  fi
done <<< "$NEW_FILES"

assert_eq "renamed multiple files" "true" "$RENAMED"
FILES=$(ls supabase/migrations/ | sort)
assert_contains "first rename correct" "20260215000006_alpha.sql" "$FILES"
assert_contains "second rename correct" "20260215000007_beta.sql" "$FILES"
cleanup_repo "$REPO"

# ── Summary ──────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
