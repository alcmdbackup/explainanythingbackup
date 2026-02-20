#!/usr/bin/env bash
# Tests for migration infrastructure: pre-commit hook and reorder logic.
# Run: bash scripts/test-migration-tools.sh

set -uo pipefail

PASS=0
FAIL=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$SCRIPT_DIR/.githooks/pre-commit"

# ── Helpers ──────────────────────────────────────────────────

setup_repo() {
  local tmpdir remote_dir
  remote_dir=$(mktemp -d)
  tmpdir=$(mktemp -d)

  git init -q --bare "$remote_dir"

  cd "$tmpdir" || exit 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath /dev/null
  git remote add origin "$remote_dir"
  mkdir -p supabase/migrations

  echo "$remote_dir" > "$tmpdir/.remote_dir"
  echo "$tmpdir"
}

cleanup_repo() {
  local remote_dir
  remote_dir=$(cat "$1/.remote_dir" 2>/dev/null || true)
  cd "$SCRIPT_DIR" || exit 1
  rm -rf "$1" "$remote_dir"
}

push_to_origin() {
  git push -q origin HEAD:main 2>/dev/null
  git fetch -q origin
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
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260214000001_new_feature.sql
git add supabase/migrations/20260214000001_new_feature.sql
OUTPUT=$(bash "$HOOK" 2>&1 || true)
assert_contains "detects stale timestamp" "ERROR: Migration timestamp" "$OUTPUT"
assert_contains "shows fix suggestion" "git mv" "$OUTPUT"
assert_contains "shows bypass" "no-verify" "$OUTPUT"
cleanup_repo "$REPO"

echo ""
echo "Test 2: Hook allows commit with valid migration timestamp"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260216000001_new_feature.sql
git add supabase/migrations/20260216000001_new_feature.sql
EXIT_CODE=0
bash "$HOOK" 2>&1 || EXIT_CODE=$?
assert_eq "allows valid timestamp" "0" "$EXIT_CODE"
cleanup_repo "$REPO"

echo ""
echo "Test 3: Hook skips when no migration files are staged"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch README.md
git add README.md
EXIT_CODE=0
bash "$HOOK" 2>&1 || EXIT_CODE=$?
assert_eq "skips non-migration files" "0" "$EXIT_CODE"
cleanup_repo "$REPO"

echo ""
echo "Test 4: Hook handles multiple stale migrations"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260213000001_first.sql
touch supabase/migrations/20260214000001_second.sql
git add supabase/migrations/
OUTPUT=$(bash "$HOOK" 2>&1 || true)
assert_contains "detects first stale file" "20260213000001" "$OUTPUT"
assert_contains "detects second stale file" "20260214000001" "$OUTPUT"
cleanup_repo "$REPO"

# ── Reorder logic tests ─────────────────────────────────────

echo ""
echo "=== Migration reorder logic tests ==="

echo ""
echo "Test 5: Reorder renames out-of-order migration"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260214000001_new_feature.sql
git add supabase/migrations/20260214000001_new_feature.sql
git commit -q -m "add migration"

LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | xargs -I{} basename {} | grep -oE '^[0-9]{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oE '^[0-9]{14}' || true)
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
RENAMED_FILE=$(ls supabase/migrations/ | grep "20260215000006")
assert_contains "file renamed with correct timestamp" "20260215000006_new_feature.sql" "$RENAMED_FILE"
cleanup_repo "$REPO"

echo ""
echo "Test 6: Reorder skips already-valid migrations"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260216000001_valid.sql
git add supabase/migrations/20260216000001_valid.sql
git commit -q -m "add migration"

LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | xargs -I{} basename {} | grep -oE '^[0-9]{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oE '^[0-9]{14}' || true)
  [ -z "$FILE_TS" ] && continue
  if [ "$FILE_TS" -le "$LATEST_ON_MAIN" ]; then
    DESCRIPTION=$(echo "$BASENAME" | sed "s/^${FILE_TS}_//")
    git mv "$file" "supabase/migrations/${NEXT_TS}_${DESCRIPTION}"
    NEXT_TS=$((NEXT_TS + 1))
    RENAMED=true
  fi
done <<< "$NEW_FILES"

assert_eq "no rename needed" "false" "$RENAMED"
ORIGINAL=$(ls supabase/migrations/ | grep "20260216000001")
assert_contains "original file unchanged" "20260216000001_valid.sql" "$ORIGINAL"
cleanup_repo "$REPO"

echo ""
echo "Test 7: Reorder handles multiple out-of-order migrations"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260213000001_alpha.sql
touch supabase/migrations/20260214000001_beta.sql
git add supabase/migrations/
git commit -q -m "add migrations"

LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | xargs -I{} basename {} | grep -oE '^[0-9]{14}' | sort -n | tail -1)
NEW_FILES=$(git diff --diff-filter=A --name-only origin/main -- supabase/migrations/ || true)
RENAMED=false
NEXT_TS=$((LATEST_ON_MAIN + 1))
while IFS= read -r file; do
  BASENAME=$(basename "$file")
  FILE_TS=$(echo "$BASENAME" | grep -oE '^[0-9]{14}' || true)
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

# ── Duplicate version detection tests ─────────────────────────

echo ""
echo "=== Duplicate version detection tests ==="

echo ""
echo "Test 8: Hook blocks commit when staged migration creates duplicate version"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
# Create a duplicate: one already on disk, one staged — both newer than main
touch supabase/migrations/20260216000001_first.sql
git add supabase/migrations/20260216000001_first.sql
git commit -q -m "add first"
# Now add another file with the same timestamp (simulates merge artifact)
touch supabase/migrations/20260216000001_second.sql
git add supabase/migrations/20260216000001_second.sql
EXIT_CODE=0
OUTPUT=$(bash "$HOOK" 2>&1) || EXIT_CODE=$?
assert_eq "hook exits non-zero" "1" "$EXIT_CODE"
assert_contains "detects duplicate version" "ERROR: Duplicate migration version" "$OUTPUT"
assert_contains "shows conflicting files" "20260216000001" "$OUTPUT"
cleanup_repo "$REPO"

echo ""
echo "Test 9: Hook allows commit when no duplicate versions exist"
REPO=$(setup_repo) && cd "$REPO"
touch supabase/migrations/20260215000005_existing.sql
git add -A && git commit -q -m "init"
push_to_origin
git checkout -q -b feature
touch supabase/migrations/20260216000001_unique.sql
git add supabase/migrations/20260216000001_unique.sql
EXIT_CODE=0
bash "$HOOK" 2>&1 || EXIT_CODE=$?
assert_eq "allows unique versions" "0" "$EXIT_CODE"
cleanup_repo "$REPO"

# ── Summary ──────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
