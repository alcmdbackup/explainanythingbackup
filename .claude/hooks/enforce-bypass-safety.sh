#!/bin/bash
# Conditional safety enforcer: only active in --dangerously-skip-permissions mode.
# In normal interactive mode, exits immediately with zero overhead.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')

# Fast path: do nothing in normal mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

deny() {
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"[BYPASS SAFETY] $1\"}}"
  exit 0
}

# --- MCP filesystem write tools (bypass all Bash-level protections) ---
case "$TOOL_NAME" in
  mcp__filesystem__write_text_file|mcp__filesystem__move_file|mcp__filesystem__create_directory)
    deny "Blocked: MCP filesystem write operation in bypass mode"
    ;;
esac

# --- Edit/Write: protect critical files ---
if [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
  case "$FILE_PATH" in
    */CLAUDE.md)          deny "Blocked: $TOOL_NAME to CLAUDE.md in bypass mode" ;;
    */settings.json)
      # Allow .claude/settings.json (managed separately), block root settings.json
      if [[ "$FILE_PATH" != *".claude/settings.json"* ]]; then
        deny "Blocked: $TOOL_NAME to settings.json in bypass mode"
      fi
      ;;
    *.claude/hooks/*)     deny "Blocked: $TOOL_NAME to .claude/hooks/ in bypass mode" ;;
    *.claude/doc-mapping*) deny "Blocked: $TOOL_NAME to .claude/doc-mapping.json in bypass mode" ;;
    *.claude/commands/*)  deny "Blocked: $TOOL_NAME to .claude/commands/ in bypass mode" ;;
    *.env|*.env.local|*.env.production|*.env.development)
                          deny "Blocked: $TOOL_NAME to env file in bypass mode" ;;
  esac
  exit 0
fi

# --- Read: protect secrets ---
if [ "$TOOL_NAME" = "Read" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
  case "$FILE_PATH" in
    *.env.local|*.env.production|*.env.development)
      deny "Blocked: Read of secret env file in bypass mode"
      ;;
  esac
  exit 0
fi

# --- Bash: comprehensive command inspection ---
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Normalize extra whitespace (prevents "git  push  --force" evasion)
COMMAND=$(printf '%s' "$COMMAND" | tr -s ' ')

# --- Protected file patterns ---
PROTECTED="CLAUDE\.md|settings\.json|\.claude/hooks/|\.claude/doc-mapping|\.claude/commands/|\.claude/push-gate\.json|\.env"

# Normalize command: replace && || ; with newlines, then check each sub-command
# This catches "echo x && echo y > CLAUDE.md" where the dangerous part is a later sub-command
NORMALIZED=$(printf '%s' "$COMMAND" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')

# --- Docker escape (full sandbox bypass) ---
if printf '%s' "$COMMAND" | grep -qE "^docker (run|exec|build)|^docker-compose "; then
  deny "Blocked: docker command in bypass mode"
fi

# --- Permission manipulation ---
if printf '%s' "$COMMAND" | grep -qE "^chmod |^chown "; then
  deny "Blocked: permission manipulation in bypass mode"
fi

# --- Git internals destruction ---
if printf '%s' "$COMMAND" | grep -qE "rm -rf \.git"; then
  deny "Blocked: rm -rf .git in bypass mode"
fi

# File writes to protected paths (via redirect, tee, sed -i, cp, mv, dd, truncate, rm)
if printf '%s' "$NORMALIZED" | grep -qE "(>|tee |sed -i|cp |mv |dd |truncate |rm ).*($PROTECTED)"; then
  deny "Blocked: write to protected file in bypass mode"
fi

# Echo/cat/printf redirect to protected files
if printf '%s' "$NORMALIZED" | grep -qE "(echo|cat|printf).*>.*($PROTECTED)"; then
  deny "Blocked: redirect to protected file in bypass mode"
fi

# Force push (any variant, any flag position, including +refspec syntax)
if printf '%s' "$COMMAND" | grep -qE "git push.*(--force|--force-with-lease|-f( |$))|git push [^ ]+ [+]"; then
  deny "Blocked: force push in bypass mode"
fi

# Destructive git operations (reset --hard allowed — backup hook ensures recovery)
# Covers combined flags (-xfd, -dfx, etc.) and long (--force) forms of git clean
if printf '%s' "$COMMAND" | grep -qE "git (clean (-[a-zA-Z]*f[a-zA-Z]*|--force)|checkout -- \.|restore -- \.|stash (drop|clear)|branch -D)"; then
  deny "Blocked: destructive git operation in bypass mode"
fi

# git apply (patch content not inspectable)
if printf '%s' "$COMMAND" | grep -qE "git apply"; then
  deny "Blocked: git apply in bypass mode (patch content not inspectable)"
fi

# git add -A / git add . (bulk staging)
if printf '%s' "$COMMAND" | grep -qE "git add (-A|\.( |$))"; then
  deny "Blocked: bulk git staging in bypass mode"
fi

# git commit --amend (rewrites last commit)
if printf '%s' "$COMMAND" | grep -qE "git commit.*--amend"; then
  deny "Blocked: commit amend in bypass mode"
fi

# Data exfiltration via gh (block command substitution via $() or backticks in body/title args)
if printf '%s' "$COMMAND" | grep -qE 'gh (gist create|issue create.*(\$\(|`)|pr create.*(\$\(|`))'; then
  deny "Blocked: potential data exfiltration in bypass mode"
fi

# Mass process kill
if printf '%s' "$COMMAND" | grep -qE 'kill -[0-9]+ -1|pkill -f "\.\*"'; then
  deny "Blocked: mass process kill in bypass mode"
fi

# rm -rf on project directories
if printf '%s' "$COMMAND" | grep -qE "rm -rf (src|docs|\.claude|node_modules|public)"; then
  deny "Blocked: recursive delete of project directory in bypass mode"
fi

# ln -s targeting protected files (symlink attack vector)
if printf '%s' "$COMMAND" | grep -qE "ln -s.*($PROTECTED)"; then
  deny "Blocked: symlink to protected file in bypass mode"
fi

# timeout wrapping denied commands (bypass vector)
if printf '%s' "$COMMAND" | grep -qE "timeout [0-9]+s? (docker|chmod|chown|rm -rf \.git)"; then
  deny "Blocked: timeout wrapping denied command in bypass mode"
fi

exit 0
