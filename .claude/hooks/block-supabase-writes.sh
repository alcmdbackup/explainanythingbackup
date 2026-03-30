#!/bin/bash
# Blocks direct Supabase write commands and unsafe remote queries.
# Hook is defense-in-depth; the DB readonly_local role is the authoritative enforcement layer.

COMMAND="$TOOL_INPUT"

# Write patterns to block
BLOCKED_PATTERNS=(
  "supabase db push"
  "supabase db reset"
  "supabase migration up"
  "supabase migration repair"
  "supabase db query --linked"
  "supabase db query --db-url"
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
  "supabase db query --local"
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
    # Provide specific guidance for query --linked/--db-url
    if [[ "$COMMAND" =~ "supabase db query" ]]; then
      cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "supabase db query --linked/--db-url is blocked because it can execute arbitrary writes.\n\nUse safe, read-only alternatives instead:\n  npm run query:staging -- \"SELECT ...\"   (staging, DB-enforced read-only)\n  npm run query:prod -- \"SELECT ...\"      (production, DB-enforced read-only)\n  supabase inspect db <command> --linked   (read-only pg_stat views)\n\nFor local queries, use: supabase db query \"SELECT ...\" (defaults to --local)"
  }
}
EOF
      exit 0
    fi
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

# supabase db query with no --linked/--db-url defaults to --local (safe)
if [[ "$COMMAND" =~ "supabase db query" ]] && [[ ! "$COMMAND" =~ "--linked" ]] && [[ ! "$COMMAND" =~ "--db-url" ]]; then
  exit 0
fi

# Not a Supabase write command - allow
exit 0
