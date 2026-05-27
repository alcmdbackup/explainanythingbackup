#!/bin/bash
# Test harness for .claude/hooks/update-ci-gate.sh.
# The Stop hook can't be invoked with stdin like PreToolUse hooks; instead we
# stub `gh` via a temp PATH override that returns canned JSON.
#
# Run: bash scripts/test-update-ci-gate.sh

set -u

HOOK_ABS="$(pwd)/.claude/hooks/update-ci-gate.sh"
PROJECT_ROOT="$(pwd)"
PASS=0
FAIL=0

WORK_BASE=$(mktemp -d)
trap "rm -rf '$WORK_BASE'" EXIT

init_workspace() {
  local branch="$1"
  local dir="$WORK_BASE/run-$$-$RANDOM"
  mkdir -p "$dir/.claude"
  cd "$dir" || exit 1
  git init -q -b main >/dev/null 2>&1
  git config user.email t@t
  git config user.name t
  echo "test" > README
  git add . && git commit -qm init >/dev/null 2>&1
  git checkout -q -b "$branch" 2>/dev/null
}

# Create a stub `gh` on PATH that returns the requested JSON via STDIN_OR_FILE.
# Usage: stub_gh <json>
stub_gh() {
  local json="$1"
  STUB_DIR="$WORK_BASE/stub-$$-$RANDOM"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/gh" <<EOF
#!/bin/bash
# Stub gh — returns canned JSON for 'gh pr view --json ...'
echo '$json'
EOF
  chmod +x "$STUB_DIR/gh"
  STUB_PATH="$STUB_DIR:$PATH"
}

# Run hook with the stub-gh on PATH
run_hook() {
  PATH="$STUB_PATH" bash "$HOOK_ABS" 2>/dev/null
}

run_hook_no_gh() {
  # PATH without gh — simulate gh-missing
  PATH="/usr/bin:/bin" bash "$HOOK_ABS" 2>/dev/null
}

read_gate_field() {
  jq -r "$1 // \"\"" .claude/ci-gate.json 2>/dev/null
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" = "$actual" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

assert_no_file() {
  local desc="$1" path="$2"
  if [[ ! -f "$path" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (file exists: $path)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Bypass: hotfix branch (should not write) ==="
init_workspace hotfix/urgent
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_no_file "hotfix branch → no ci-gate.json written" ".claude/ci-gate.json"

echo ""
echo "=== Kill switch: .ci-gate.disabled ==="
init_workspace feat/foo
touch .claude/ci-gate.disabled
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_no_file ".ci-gate.disabled → no write" ".claude/ci-gate.json"

echo ""
echo "=== Asymmetric bypass: fix/ branch DOES get state written ==="
init_workspace fix/abc
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_eq "fix/ branch + CI FAILURE → status=closed (loophole closed)" "closed" "$(read_gate_field .status)"

echo ""
echo "=== Asymmetric bypass: docs/ branch DOES get state written ==="
init_workspace docs/abc
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_eq "docs/ branch + CI FAILURE → status=closed (loophole closed)" "closed" "$(read_gate_field .status)"

echo ""
echo "=== Asymmetric bypass: chore/ branch DOES get state written ==="
init_workspace chore/abc
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_eq "chore/ branch + CI FAILURE → status=closed (loophole closed)" "closed" "$(read_gate_field .status)"

echo ""
echo "=== Skip on main/production ==="
init_workspace main
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_no_file "main branch → no write" ".claude/ci-gate.json"

echo ""
echo "=== gh missing → no write, no error ==="
init_workspace feat/foo
run_hook_no_gh
assert_no_file "gh not on PATH → no write" ".claude/ci-gate.json"

echo ""
echo "=== gh returns empty (no PR) → no write ==="
init_workspace feat/foo
stub_gh ''
run_hook
assert_no_file "no PR for branch → no clobber" ".claude/ci-gate.json"

echo ""
echo "=== CI failure → status=closed + last_failure_commit set ==="
init_workspace feat/foo
HEAD_AT_TEST=$(git rev-parse HEAD)
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]}'
run_hook
assert_eq "CI failure → status=closed" "closed" "$(read_gate_field .status)"
assert_eq "CI failure → branch field" "feat/foo" "$(read_gate_field .branch)"
assert_eq "CI failure → last_failure_commit set to HEAD" "$HEAD_AT_TEST" "$(read_gate_field .last_failure_commit)"
assert_eq "CI failure → schema_version=1" "1" "$(read_gate_field .schema_version)"
assert_eq "CI failure → last_observation_source=stop_hook" "stop_hook" "$(read_gate_field .last_observation_source)"

echo ""
echo "=== All checks SUCCESS → status=open + clears failure_commit ==="
init_workspace feat/foo
# Seed prior CLOSED state
jq -n --arg b "feat/foo" --arg c "deadbeef" \
  '{branch:$b, status:"closed", last_failure_commit:$c, last_observation_source:"stop_hook", schema_version:1}' \
  > .claude/ci-gate.json
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"},{"conclusion":"SUCCESS","status":"COMPLETED"}]}'
run_hook
assert_eq "all SUCCESS → status=open" "open" "$(read_gate_field .status)"
assert_eq "all SUCCESS → last_failure_commit cleared" "" "$(read_gate_field .last_failure_commit)"

echo ""
echo "=== PENDING checks → preserve prior status ==="
init_workspace feat/foo
jq -n --arg b "feat/foo" --arg c "deadbeef" \
  '{branch:$b, status:"closed", last_failure_commit:$c, last_observation_source:"stop_hook", schema_version:1}' \
  > .claude/ci-gate.json
stub_gh '{"number":1,"statusCheckRollup":[{"conclusion":null,"status":"IN_PROGRESS"}]}'
run_hook
assert_eq "PENDING + prior closed → preserve closed" "closed" "$(read_gate_field .status)"
assert_eq "PENDING + prior closed → preserve failure_commit" "deadbeef" "$(read_gate_field .last_failure_commit)"

echo ""
echo "=== Smoke: hook is registered as Stop entry ==="
cd "$PROJECT_ROOT" || exit 1
if grep -q "update-ci-gate.sh" .claude/settings.json; then
  echo "  PASS: update-ci-gate.sh is registered in .claude/settings.json"
  PASS=$((PASS+1))
else
  echo "  FAIL: update-ci-gate.sh NOT registered"
  FAIL=$((FAIL+1))
fi
if [[ -x ".claude/hooks/update-ci-gate.sh" ]]; then
  echo "  PASS: hook file exists and is executable"
  PASS=$((PASS+1))
else
  echo "  FAIL: hook file missing or not executable"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=================================================="
echo "Results: $PASS passed, $FAIL failed"
echo "=================================================="
[[ $FAIL -eq 0 ]]
