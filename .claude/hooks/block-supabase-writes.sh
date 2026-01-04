#!/bin/bash
# Blocks direct Supabase write commands to enforce GitHub Actions migrations.
# Reads/queries are allowed; writes must go through supabase/migrations/ and GitHub.

COMMAND="$TOOL_INPUT"

# Write patterns to block
BLOCKED_PATTERNS=(
  "supabase db push"
  "supabase db reset"
  "supabase migration up"
  "supabase migration repair"
  "psql.*-c"
  "psql.*-f"
  "psql.*--command"
  "psql.*--file"
)

# Read patterns to allow (even if they match a blocked pattern)
ALLOWED_PATTERNS=(
  "supabase migration list"
  "supabase db pull"
  "supabase db diff"
  "supabase db lint"
  "psql.*SELECT"
  "psql.*select"
  "psql.*\\d"
)

# Check if it's an allowed read pattern first
for pattern in "${ALLOWED_PATTERNS[@]}"; do
  if [[ "$COMMAND" =~ $pattern ]]; then
    exit 0
  fi
done

# Check for blocked write patterns
for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if [[ "$COMMAND" =~ $pattern ]]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct Supabase writes are blocked. Use GitHub Actions instead:\n\n1. Create migration: supabase/migrations/<timestamp>_<name>.sql\n2. Commit and push to main (deploys to staging)\n3. Merge main→production (deploys to prod)\n\nAllowed commands: supabase migration list, db pull, db diff, db lint, SELECT queries"
  }
}
EOF
    exit 0
  fi
done

# Not a Supabase write command - allow
exit 0
