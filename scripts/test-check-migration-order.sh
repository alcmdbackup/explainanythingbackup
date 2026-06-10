#!/usr/bin/env bash
# Tests scripts/check-migration-order.sh against an ephemeral git repo fixture.
# Covers: in-order (pass), out-of-order (fail), duplicate version (fail).
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/check-migration-order.sh"
PASS=0
FAIL=0

check() { # $1=desc $2=expected_rc $3=actual_rc
  if [ "$2" = "$3" ]; then echo "  ok: $1"; PASS=$((PASS+1));
  else echo "  FAIL: $1 (expected rc=$2, got rc=$3)"; FAIL=$((FAIL+1)); fi
}

setup_base() { # creates a temp repo with one base migration on branch 'base'
  TMP=$(mktemp -d)
  cd "$TMP"
  git init -q
  git config user.email t@t.t; git config user.name t
  git checkout -q -b base
  mkdir -p supabase/migrations
  echo "select 1;" > supabase/migrations/20260101000000_base.sql
  git add -A; git commit -qm base
}
teardown() { cd /; rm -rf "$TMP"; }

echo "Test 1: in-order new migration -> pass (rc 0)"
setup_base
git checkout -q -b feat-ok
echo "select 2;" > supabase/migrations/20260102000000_ok.sql
git add -A; git commit -qm ok
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "in-order passes" 0 $?
teardown

echo "Test 2: out-of-order new migration (<= base max) -> fail (rc 1)"
setup_base
git checkout -q -b feat-bad
echo "select 3;" > supabase/migrations/20251231000000_bad.sql
git add -A; git commit -qm bad
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "out-of-order fails" 1 $?
teardown

echo "Test 3: duplicate version -> fail (rc 1)"
setup_base
git checkout -q -b feat-dupe
# second file sharing the base timestamp (collision)
echo "select 4;" > supabase/migrations/20260101000000_dupe.sql
git add -A; git commit -qm dupe
bash "$SCRIPT" --base=base >/dev/null 2>&1; check "duplicate version fails" 1 $?
teardown

echo ""
echo "check-migration-order tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
