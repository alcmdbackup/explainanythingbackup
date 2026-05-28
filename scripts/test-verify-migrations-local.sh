#!/bin/bash
# Test harness for scripts/verify-migrations-local.sh.
# Tests Docker availability detection, MIGRATION_VERIFY_SKIP, and migration
# apply success/failure paths.
#
# Some test cases require Docker to be installed. If absent, those are skipped
# rather than failed (CI runners have Docker; dev machines may not yet).
#
# Run: bash scripts/test-verify-migrations-local.sh

set -u

SCRIPT_ABS="$(pwd)/scripts/verify-migrations-local.sh"
PROJECT_ROOT="$(pwd)"
PASS=0
FAIL=0
SKIP=0

WORK_BASE=$(mktemp -d)
trap "rm -rf '$WORK_BASE'" EXIT

DOCKER_AVAILABLE=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=1
fi

# Run verify script from a fresh fake workspace; supabase/migrations is created
# fresh per invocation.
init_workspace() {
  local dir="$WORK_BASE/run-$$-$RANDOM"
  mkdir -p "$dir/supabase/migrations"
  cd "$dir" || exit 1
  git init -q -b main >/dev/null 2>&1
  git config user.email t@t
  git config user.name t
  echo "test" > README
  git add . && git commit -qm init >/dev/null 2>&1
}

write_clean_migration() {
  cat > supabase/migrations/00000000000001_create_users.sql <<'SQL'
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, name text NOT NULL);
SQL
}

write_broken_migration() {
  cat > supabase/migrations/00000000000002_bad.sql <<'SQL'
ALTER TABLE nonexistent_table ADD COLUMN x int;
SQL
}

run_verify() {
  local env_var="${1:-}"
  if [[ -n "$env_var" ]]; then
    env $env_var bash "$SCRIPT_ABS" 2>&1
  else
    bash "$SCRIPT_ABS" 2>&1
  fi
}

expect_exit() {
  local desc="$1"
  local expected="$2"   # 0 or 1
  local actual="$3"
  if [[ "$actual" -eq "$expected" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (expected exit $expected, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

skip() {
  echo "  SKIP: $1"
  SKIP=$((SKIP+1))
}

echo "=== MIGRATION_VERIFY_SKIP env var ==="
init_workspace
write_clean_migration
run_verify "MIGRATION_VERIFY_SKIP=true" >/dev/null
expect_exit "MIGRATION_VERIFY_SKIP=true → exit 0" 0 $?

echo ""
echo "=== Docker absence (only meaningful if docker IS absent) ==="
if [[ $DOCKER_AVAILABLE -eq 0 ]]; then
  init_workspace
  write_clean_migration
  OUTPUT=$(run_verify)
  if echo "$OUTPUT" | grep -q "requires Docker"; then
    echo "  PASS: docker absent → exits 1 with install instructions"
    PASS=$((PASS+1))
  else
    echo "  FAIL: docker absent should produce install instructions; got: $OUTPUT"
    FAIL=$((FAIL+1))
  fi
else
  skip "docker absent test (docker IS available on this machine)"
fi

echo ""
echo "=== Empty migrations dir ==="
if [[ $DOCKER_AVAILABLE -eq 1 ]]; then
  init_workspace
  run_verify >/dev/null
  expect_exit "no migrations → exit 0 (nothing to verify)" 0 $?
else
  skip "empty migrations test (requires docker)"
fi

echo ""
echo "=== Clean migrations apply ==="
if [[ $DOCKER_AVAILABLE -eq 1 ]]; then
  init_workspace
  write_clean_migration
  # TEMP DIAGNOSTIC (revert after CI reveals the real error): capture run_verify's
  # combined output and print it when the clean apply unexpectedly fails, instead of
  # swallowing it with >/dev/null. run_verify already does 2>&1.
  CLEAN_OUT=$(run_verify); CLEAN_RC=$?
  if [[ $CLEAN_RC -ne 0 ]]; then
    echo "  [DIAGNOSTIC] clean-migration verify failed (rc=$CLEAN_RC). Full output:"
    echo "$CLEAN_OUT" | sed 's/^/    | /'
  fi
  expect_exit "clean migration → exit 0" 0 $CLEAN_RC
else
  skip "clean migration test (requires docker)"
fi

echo ""
echo "=== Broken migration fails ==="
if [[ $DOCKER_AVAILABLE -eq 1 ]]; then
  init_workspace
  write_clean_migration
  write_broken_migration
  OUTPUT=$(run_verify)
  RC=$?
  if [[ $RC -eq 1 ]] && echo "$OUTPUT" | grep -q "FAIL: migration did not apply"; then
    echo "  PASS: broken migration → exit 1 with clear error"
    PASS=$((PASS+1))
  else
    echo "  FAIL: broken migration: rc=$RC output=$OUTPUT"
    FAIL=$((FAIL+1))
  fi
else
  skip "broken migration test (requires docker)"
fi

echo ""
echo "=== Live DB on port 54322 untouched ==="
# This test would only be meaningful if the user has supabase running.
# We trust the random-port design; assert documented behavior only.
skip "live-DB safety (covered by random-port design; assert by port observation in manual test)"

echo ""
echo "=== Smoke: script file exists and is executable ==="
cd "$PROJECT_ROOT" || exit 1
if [[ -x scripts/verify-migrations-local.sh ]]; then
  echo "  PASS: verify-migrations-local.sh exists and is executable"
  PASS=$((PASS+1))
else
  echo "  FAIL: verify-migrations-local.sh missing or not executable"
  FAIL=$((FAIL+1))
fi
if grep -q "\"migration:verify\":" package.json; then
  echo "  PASS: migration:verify script registered in package.json"
  PASS=$((PASS+1))
else
  echo "  FAIL: migration:verify NOT in package.json"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=================================================="
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "=================================================="
[[ $FAIL -eq 0 ]]
