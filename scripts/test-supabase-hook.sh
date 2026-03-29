#!/bin/bash
# Automated tests for .claude/hooks/block-supabase-writes.sh
# Runs the hook as a subprocess with TOOL_INPUT set, checks exit code and output.

HOOK=".claude/hooks/block-supabase-writes.sh"
PASS=0
FAIL=0

assert_blocked() {
  local desc="$1"
  local cmd="$2"
  local output
  output=$(TOOL_INPUT="$cmd" bash "$HOOK" 2>/dev/null)
  if echo "$output" | grep -q '"permissionDecision": "deny"'; then
    echo "  ✓ BLOCKED: $desc"
    ((PASS++))
  else
    echo "  ✗ EXPECTED BLOCKED: $desc"
    echo "    Command: $cmd"
    echo "    Output: $output"
    ((FAIL++))
  fi
}

assert_allowed() {
  local desc="$1"
  local cmd="$2"
  local output
  output=$(TOOL_INPUT="$cmd" bash "$HOOK" 2>/dev/null)
  if echo "$output" | grep -q '"permissionDecision": "deny"'; then
    echo "  ✗ EXPECTED ALLOWED: $desc"
    echo "    Command: $cmd"
    echo "    Output: $output"
    ((FAIL++))
  else
    echo "  ✓ ALLOWED: $desc"
    ((PASS++))
  fi
}

echo "Testing block-supabase-writes.sh"
echo "================================"
echo ""

echo "--- Should be BLOCKED ---"
assert_blocked "db query --linked SELECT" \
  'supabase db query --linked "SELECT 1"'

assert_blocked "db query --db-url" \
  'supabase db query --db-url "postgresql://foo@bar:5432/db" "SELECT 1"'

assert_blocked "db query --linked INSERT" \
  'supabase db query --linked "INSERT INTO foo VALUES (1)"'

assert_blocked "db push" \
  'supabase db push'

assert_blocked "db reset" \
  'supabase db reset'

assert_blocked "migration up" \
  'supabase migration up'

assert_blocked "migration repair" \
  'supabase migration repair --status reverted 20260101000000'

echo ""
echo "--- Should be ALLOWED ---"
assert_allowed "db query no flags (defaults to local)" \
  'supabase db query "SELECT 1"'

assert_allowed "db query --local" \
  'supabase db query --local "SELECT 1"'

assert_allowed "db query --local with write SQL (local is safe)" \
  'supabase db query --local "DROP TABLE foo"'

assert_allowed "inspect db table-stats --linked" \
  'supabase inspect db table-stats --linked'

assert_allowed "inspect db long-running-queries --linked" \
  'supabase inspect db long-running-queries --linked'

assert_allowed "migration list" \
  'supabase migration list'

assert_allowed "db diff --linked" \
  'supabase db diff --linked'

assert_allowed "db pull" \
  'supabase db pull'

assert_allowed "db dump --linked" \
  'supabase db dump --linked -f schema.sql'

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
