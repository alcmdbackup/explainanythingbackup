#!/usr/bin/env bash
# Tests scripts/check-migration-append-only.sh against an ephemeral git repo fixture.
# Covers: no edits (pass), in-place edit (fail), edit + marker (pass), rename (pass).
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/check-migration-append-only.sh"
PASS=0
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "  ok: $1"; PASS=$((PASS+1)); else echo "  FAIL: $1 (expected rc=$2, got rc=$3)"; FAIL=$((FAIL+1)); fi; }

setup_base() {
  TMP=$(mktemp -d); cd "$TMP"
  git init -q; git config user.email t@t.t; git config user.name t
  git checkout -q -b base
  mkdir -p supabase/migrations
  printf 'create table x();\n' > supabase/migrations/20260101000000_base.sql
  git add -A; git commit -qm base
  git checkout -q -b feat
}
teardown() { cd /; rm -rf "$TMP"; }

echo "Test 1: no migration edits -> pass (0)"
setup_base
printf 'select 1;\n' > supabase/migrations/20260102000000_new.sql  # new file, not an edit
git add -A; git commit -qm new
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "no in-place edits passes" 0 $?
teardown

echo "Test 2: in-place edit of shipped migration -> fail (1)"
setup_base
printf 'create table x();\n-- tweaked\n' > supabase/migrations/20260101000000_base.sql
git add -A; git commit -qm edit
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "in-place edit fails" 1 $?
teardown

echo "Test 3: in-place edit WITH marker -> pass (0)"
setup_base
printf 'create table x();\n-- @migration-edit-approved guard-only\n' > supabase/migrations/20260101000000_base.sql
git add -A; git commit -qm edit-approved
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "marker bypass passes" 0 $?
teardown

echo "Test 4: rename (git mv) -> pass (0, not a modify)"
setup_base
git mv supabase/migrations/20260101000000_base.sql supabase/migrations/20260103000000_base.sql
git commit -qm rename
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "rename passes" 0 $?
teardown

echo ""
echo "check-migration-append-only tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
