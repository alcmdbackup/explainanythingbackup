#!/bin/bash
# Only pushes to remote when starting in bypass permissions mode.
# In normal mode, the user can manually push when they choose.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only activate in bypass mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

cd "$CWD" || exit 0
BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && exit 0
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] && exit 0

REMOTE="origin"
LOGFILE="$CWD/.claude/logs/backup-audit.log"
mkdir -p "$(dirname "$LOGFILE")" 2>/dev/null

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOGFILE" 2>/dev/null
  echo "$1" >&2
}

# Push branch to remote for backup
if timeout 15s git push "$REMOTE" "$BRANCH" 2>/dev/null; then
  log "[BYPASS SAFETY] Pushed $BRANCH to $REMOTE"
else
  log "[BYPASS SAFETY] WARNING: Failed to push $BRANCH to $REMOTE — backup may not exist!"
fi

# Tag the pre-session state
TAG="backup/pre-bypass-$(date -u +%Y%m%dT%H%M%SZ)"
if git tag "$TAG" HEAD 2>/dev/null; then
  if timeout 10s git push "$REMOTE" "$TAG" 2>/dev/null; then
    log "[BYPASS SAFETY] Tagged and pushed $TAG"
  else
    log "[BYPASS SAFETY] WARNING: Tagged $TAG locally but failed to push to remote!"
  fi
else
  log "[BYPASS SAFETY] WARNING: Failed to create tag $TAG (may already exist from rapid restart)"
fi

exit 0
