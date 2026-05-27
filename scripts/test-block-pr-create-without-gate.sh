#!/bin/bash
# Test harness for .claude/hooks/block-pr-create-without-gate.sh.
# Pipes mock JSON into the hook and asserts deny/allow behavior across
# matcher, bypass, high-blast, and reactive paths.
#
# Run: bash scripts/test-block-pr-create-without-gate.sh

set -u

HOOK=".claude/hooks/block-pr-create-without-gate.sh"
PASS=0
FAIL=0

# Save original project root so we can return for smoke tests
PROJECT_ROOT="$(pwd)"

# Use an isolated workspace base; each init_workspace creates a fresh subdir
WORK_BASE=$(mktemp -d)
trap "rm -rf '$WORK_BASE'" EXIT

# Initialize a fresh fake git repo (in a new subdir each time)
WORK_DIR=""
init_workspace() {
  local branch="$1"
  WORK_DIR="$WORK_BASE/run-$$-$RANDOM"
  mkdir -p "$WORK_DIR"
  cd "$WORK_DIR" || exit 1
  git init -q -b main
  git config user.email t@t
  git config user.name t
  mkdir -p supabase/migrations .claude
  echo "-- placeholder" > supabase/migrations/00000000000000_init.sql
  git add . && git commit -qm init
  # Set up origin via a bare clone so origin/main resolves
  git clone -q --bare . "$WORK_DIR.origin.git" >/dev/null 2>&1
  git remote add origin "$WORK_DIR.origin.git" 2>/dev/null
  git fetch -q origin 2>/dev/null
  git checkout -q -b "$branch"
}

# Run hook with given command on stdin; return JSON-or-empty output
run_hook() {
  local cmd="$1"
  local env_var="${2:-}"
  local json
  json=$(jq -n --arg c "$cmd" '{tool_input: {command: $c}}')
  if [[ -n "$env_var" ]]; then
    echo "$json" | env $env_var bash "$HOOK_ABS" 2>/dev/null
  else
    echo "$json" | bash "$HOOK_ABS" 2>/dev/null
  fi
}

expect() {
  local desc="$1"
  local expected="$2"  # "deny" or "allow"
  local output="$3"
  local denied=0
  if echo "$output" | grep -q '"permissionDecision".*"deny"'; then denied=1; fi
  if [[ "$expected" = "deny" && $denied -eq 1 ]] || [[ "$expected" = "allow" && $denied -eq 0 ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (expected $expected, output: $output)"
    FAIL=$((FAIL+1))
  fi
}

# Resolve hook to absolute path before cd'ing
HOOK_ABS="$(pwd)/$HOOK"
if [[ ! -f "$HOOK_ABS" ]]; then
  echo "Hook not found: $HOOK_ABS"
  exit 1
fi

# Helper to make a migration-touching diff
add_migration() {
  echo "-- new migration" > supabase/migrations/00000000000001_new.sql
  git add supabase/migrations/00000000000001_new.sql
  git commit -qm "add migration"
}

write_valid_push_gate() {
  jq -n --arg c "$(git rev-parse HEAD)" \
    '{commit: $c, skill: "finalize", timestamp: "2026-05-27T00:00:00Z"}' \
    > .claude/push-gate.json
}

write_valid_test_pass() {
  jq -n --arg c "$(git rev-parse HEAD)" \
    '{commit: $c, tests: ["lint","typecheck","test:esm","test","test:integration","test:e2e:critical"], passed_at: "2026-05-27T00:00:00Z", schema_version: 1}' \
    > .claude/test-pass.json
}

write_valid_override() {
  jq -n --arg b "$(git branch --show-current)" --arg c "$(git rev-parse HEAD)" \
    '{branch: $b, commit: $c, reason: "flaky test #123", approved_at: "2026-05-27T00:00:00Z", approved_by: "test", schema_version: 1}' \
    > .claude/ci-gate-override.json
}

write_ci_gate_closed() {
  jq -n --arg b "$(git branch --show-current)" --arg sha "$(git rev-parse HEAD)" \
    '{branch: $b, status: "closed", last_observed_at: "2026-05-27T00:00:00Z", last_observed_sha: $sha, last_failure_commit: $sha, last_observation_source: "stop_hook", schema_version: 1}' \
    > .claude/ci-gate.json
}

write_ci_gate_open() {
  jq -n --arg b "$(git branch --show-current)" --arg sha "$(git rev-parse HEAD)" \
    '{branch: $b, status: "open", last_observed_at: "2026-05-27T00:00:00Z", last_observed_sha: $sha, last_observation_source: "stop_hook", schema_version: 1}' \
    > .claude/ci-gate.json
}

echo "=== Matcher: PR-creating commands → IS_PR_CREATE (then high-blast determines deny) ==="
init_workspace feat/foo
add_migration
expect "gh pr create + migration + no gate → deny" deny "$(run_hook 'gh pr create --base main')"
expect "gh pr ready + migration + no gate → deny" deny "$(run_hook 'gh pr ready 123')"
expect "gh api POST /pulls + migration + no gate → deny" deny "$(run_hook 'gh api repos/foo/bar/pulls -X POST -F head=feat/foo')"
expect "gh api graphql createPullRequest + migration + no gate → deny" deny "$(run_hook 'gh api graphql -f query="mutation { createPullRequest(input: $i) { pullRequest { id } } }"')"
expect "bash -c with gh pr create + migration + no gate → deny" deny "$(run_hook 'bash -c "gh pr create --base main"')"

echo ""
echo "=== Matcher: out-of-matcher commands → allow ==="
init_workspace feat/foo
add_migration
expect "gh pr view 123 → allow" allow "$(run_hook 'gh pr view 123')"
expect "gh pr list → allow" allow "$(run_hook 'gh pr list')"
expect "gh pr edit 123 --add-label foo → allow" allow "$(run_hook 'gh pr edit 123 --add-label foo')"
expect "gh pr checks → allow" allow "$(run_hook 'gh pr checks')"
expect "gh pr diff 123 → allow" allow "$(run_hook 'gh pr diff 123')"
expect "gh pr comment 123 --body x → allow" allow "$(run_hook 'gh pr comment 123 --body x')"
expect "gh pr merge 123 → allow" allow "$(run_hook 'gh pr merge 123')"
expect "gh pr ready --undo 123 → allow" allow "$(run_hook 'gh pr ready --undo 123')"
expect "gh api GET /pulls → allow" allow "$(run_hook 'gh api repos/foo/bar/pulls')"
expect "gh api graphql read (no createPullRequest) → allow" allow "$(run_hook 'gh api graphql -f query="{ repository(name: x) { pullRequests(first: 5) { nodes { id } } } }"')"
expect "git log | grep gh pr create → allow (substring in quoted body)" allow "$(run_hook "git log | grep 'gh pr create'")"
expect "gh pr comment with literal in body → allow" allow "$(run_hook 'gh pr comment 123 --body "remember to gh pr create next"')"
expect "echo arbitrary → allow" allow "$(run_hook 'echo hello')"
expect "git commit -m with gh pr create in body → allow (regression #1)" allow "$(run_hook 'git commit -m "feat: gate gh pr create on push-gate"')"
expect "git commit -m with both bash -c and gh pr create in body → allow (regression #2)" allow "$(run_hook 'git commit -m "explains bash -c wrappers and gh pr create matching"')"

echo ""
echo "=== High-blast path: migration-touching ==="
init_workspace feat/foo
add_migration
expect "migration-touching diff + no gate → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
write_valid_push_gate
expect "migration-touching diff + valid push-gate → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
write_valid_override
expect "migration-touching diff + valid override → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
echo "not valid json {{" > .claude/push-gate.json
expect "migration-touching + malformed push-gate JSON → deny (fail closed)" deny "$(run_hook 'gh pr create --base main')"

echo ""
echo "=== High-blast path: --base production ==="
init_workspace feat/foo
expect "--base production + no gate → deny" deny "$(run_hook 'gh pr create --base production')"

init_workspace feat/foo
expect "--base=production (equals form) + no gate → deny" deny "$(run_hook 'gh pr create --base=production')"

init_workspace feat/foo
expect '--base "production" (quoted) + no gate → deny' deny "$(run_hook 'gh pr create --base "production"')"

init_workspace feat/foo
write_valid_push_gate
expect "--base production + valid push-gate → allow" allow "$(run_hook 'gh pr create --base production')"

echo ""
echo "=== Bypass: hotfix branch ==="
init_workspace hotfix/urgent
add_migration
expect "hotfix branch + no gate → allow" allow "$(run_hook 'gh pr create --base main')"

echo ""
echo "=== Bypass: DISABLE_PR_GATE env var ==="
init_workspace feat/foo
add_migration
expect "DISABLE_PR_GATE=true env → allow" allow "$(run_hook 'gh pr create --base main' 'DISABLE_PR_GATE=true')"
expect "inline DISABLE_PR_GATE=true → allow" allow "$(run_hook 'DISABLE_PR_GATE=true gh pr create --base main')"

echo ""
echo "=== Reactive path: branch with normal feature → main PR ==="
init_workspace feat/foo
expect "no migration + no gate + no ci-gate → allow (OPEN by default)" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_open
expect "ci-gate OPEN + no test-pass → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
expect "ci-gate CLOSED + no test-pass → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
write_valid_test_pass
expect "ci-gate CLOSED + matching test-pass → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
jq -n --arg c "deadbeef" '{commit: $c, tests: ["lint","typecheck","test:esm","test","test:integration","test:e2e:critical"], passed_at: "2026-05-27T00:00:00Z", schema_version: 1}' > .claude/test-pass.json
expect "ci-gate CLOSED + stale test-pass (wrong SHA) → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
write_valid_override
expect "ci-gate CLOSED + valid override → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
touch .claude/ci-gate.disabled
expect "ci-gate CLOSED + .ci-gate.disabled kill switch → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
echo "not json {{" > .claude/ci-gate.json
expect "reactive path + malformed ci-gate.json → allow (fail open)" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
jq -n '{branch: "feat/other", status: "closed", schema_version: 1}' > .claude/ci-gate.json
expect "ci-gate CLOSED for different branch → allow" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
jq -n '{branch: "feat/foo", status: "closed", schema_version: 99}' > .claude/ci-gate.json
expect "ci-gate unknown schema_version → allow (fail open with warning)" allow "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
write_ci_gate_closed
jq -n --arg c "$(git rev-parse HEAD)" \
  '{commit: $c, tests: ["lint","typecheck"], passed_at: "2026-05-27T00:00:00Z", schema_version: 1}' \
  > .claude/test-pass.json
expect "ci-gate CLOSED + test-pass with partial tests array (length<6) → deny" deny "$(run_hook 'gh pr create --base main')"

echo ""
echo "=== Override validation ==="
init_workspace feat/foo
add_migration
jq -n --arg b "$(git branch --show-current)" --arg c "$(git rev-parse HEAD)" \
  '{branch: $b, commit: $c, approved_at: "2026-05-27T00:00:00Z", schema_version: 1}' \
  > .claude/ci-gate-override.json
expect "override missing reason → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
jq -n --arg b "$(git branch --show-current)" --arg c "$(git rev-parse HEAD)" \
  '{branch: $b, commit: $c, reason: "x", schema_version: 1, approved_at: "2099-01-01T00:00:00Z"}' \
  > .claude/ci-gate-override.json
expect "override with future-dated approved_at → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
jq -n --arg b "$(git branch --show-current)" \
  '{branch: $b, commit: "deadbeef", reason: "x", approved_at: "2026-05-27T00:00:00Z", schema_version: 1}' \
  > .claude/ci-gate-override.json
expect "override commit mismatches HEAD → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
jq -n --arg c "$(git rev-parse HEAD)" \
  '{branch: "feat/other", commit: $c, reason: "x", approved_at: "2026-05-27T00:00:00Z", schema_version: 1}' \
  > .claude/ci-gate-override.json
expect "override branch mismatches current → deny" deny "$(run_hook 'gh pr create --base main')"

init_workspace feat/foo
add_migration
jq -n --arg b "$(git branch --show-current)" --arg c "$(git rev-parse HEAD)" \
  '{branch: $b, commit: $c, reason: "x", approved_at: "2026-05-27T00:00:00Z", schema_version: 99}' \
  > .claude/ci-gate-override.json
expect "override with unknown schema_version → deny" deny "$(run_hook 'gh pr create --base main')"

echo ""
echo "=== Hook smoke test: hook is registered ==="
cd "$PROJECT_ROOT" || exit 1
if grep -q "block-pr-create-without-gate.sh" .claude/settings.json; then
  echo "  PASS: hook is registered in .claude/settings.json"
  PASS=$((PASS+1))
else
  echo "  FAIL: hook NOT registered in .claude/settings.json"
  FAIL=$((FAIL+1))
fi
if [[ -x ".claude/hooks/block-pr-create-without-gate.sh" ]]; then
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
