#!/usr/bin/env bash
# Install /safe_to_close command + /initialize default-doc edits.
#
# Run from any shell where .claude/commands/ is writable (i.e. NOT inside
# a Claude Code session that bind-mounts it read-only). Invoke from the
# worktree root: `bash docs/planning/.../deliverables/install.sh`
#
# Safe to re-run: gitignore append is idempotent; cp is overwrite; commit
# is skipped if nothing changed.

set -euo pipefail

# Resolve worktree root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

# Sanity check: we should be at the worktree root.
if [[ ! -d .claude/commands ]]; then
  echo "ERROR: .claude/commands not found. Are you in the worktree root?"
  echo "Detected REPO_ROOT=$REPO_ROOT"
  exit 1
fi

# Sanity check: bind mount must be released (i.e. you're NOT inside a Claude session).
if ! touch .claude/commands/.write_probe 2>/dev/null; then
  echo "ERROR: .claude/commands/ is read-only."
  echo "       You're likely inside a Claude Code session whose bind-mount is active."
  echo "       Exit Claude (Ctrl-C / quit), then re-run this script from a plain shell."
  exit 1
fi
rm -f .claude/commands/.write_probe

# Phase 8b strict order: pre-flight integrity on live initialize.md first.
echo "→ Pre-flight: anchor integrity on current .claude/commands/initialize.md"
for anchor in \
  "Before creating project files, read these three core documents to understand the codebase context:" \
  "Exclude the 3 core docs already read: getting_started.md, architecture.md, project_workflow.md" \
  "Populate from the user-confirmed list in step 2.7" \
  "Documents created:"; do
  if ! grep -qF "$anchor" .claude/commands/initialize.md; then
    echo "ERROR: anchor not found in live initialize.md: \"$anchor\""
    echo "       initialize.md has drifted since this deliverable was prepared."
    echo "       Re-research current line numbers and re-stage."
    exit 1
  fi
done
if ! grep -qE "^### Core Docs$" .claude/commands/initialize.md; then
  echo "ERROR: \"### Core Docs\" heading not found in initialize.md."
  exit 1
fi
echo "  ✓ all 5 anchors present"

# Stage the new slash command.
echo "→ Copying safe_to_close.md → .claude/commands/safe_to_close.md"
cp "$SCRIPT_DIR/safe_to_close.md" .claude/commands/safe_to_close.md

# Replace initialize.md with the 5-edit version.
echo "→ Copying initialize.md → .claude/commands/initialize.md"
cp "$SCRIPT_DIR/initialize.md" .claude/commands/initialize.md

# Phase 8b post-edit verification on the live file.
echo "→ Post-edit verification on live initialize.md"
declare -A CHECKS=(
  ["Core Workflow Docs:"]=1
  ["Core Operations Docs:"]=1
  ["Exclude the 7 core docs already read"]=1
  ["Core docs are pre-read"]=1
  ["Core docs read: 7"]=1
)
for needle in "${!CHECKS[@]}"; do
  actual=$(grep -cF "$needle" .claude/commands/initialize.md)
  expected="${CHECKS[$needle]}"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "ERROR: post-edit check failed: \"$needle\" found $actual times (expected $expected)"
    echo "       Rolling back…"
    git checkout HEAD -- .claude/commands/initialize.md
    rm -f .claude/commands/safe_to_close.md
    exit 1
  fi
done
# Heading checks (must each appear exactly once at the top level).
for h in "^### Core Workflow Docs$" "^### Core Operations Docs$"; do
  actual=$(grep -cE "$h" .claude/commands/initialize.md)
  if [[ "$actual" -ne 1 ]]; then
    echo "ERROR: heading \"$h\" found $actual times (expected 1). Rolling back."
    git checkout HEAD -- .claude/commands/initialize.md
    rm -f .claude/commands/safe_to_close.md
    exit 1
  fi
done
# testing_setup.md must appear under feature_deep_dives (twice: Step 2.5 + Step 4).
ts_count=$(grep -cF "feature_deep_dives/testing_setup.md" .claude/commands/initialize.md)
if [[ "$ts_count" -ne 2 ]]; then
  echo "ERROR: feature_deep_dives/testing_setup.md found $ts_count times (expected 2). Rolling back."
  git checkout HEAD -- .claude/commands/initialize.md
  rm -f .claude/commands/safe_to_close.md
  exit 1
fi
# Fence balance.
fence_parity=$(( $(grep -c '^```' .claude/commands/initialize.md) % 2 ))
if [[ "$fence_parity" -ne 0 ]]; then
  echo 'ERROR: unbalanced triple-backtick fences in initialize.md. Rolling back.'
  git checkout HEAD -- .claude/commands/initialize.md
  rm -f .claude/commands/safe_to_close.md
  exit 1
fi
echo "  ✓ all 8 post-edit checks passed"

# Append gitignore entry (idempotent).
GITIGNORE_LINE=".claude/safe-to-close-verdict.json"
if ! grep -qxF "$GITIGNORE_LINE" .gitignore; then
  echo "→ Appending \"$GITIGNORE_LINE\" to .gitignore"
  echo "$GITIGNORE_LINE" >> .gitignore
else
  echo "→ .gitignore already contains \"$GITIGNORE_LINE\" (skip)"
fi

# Atomic commit.
echo "→ Staging files"
git add -- .claude/commands/safe_to_close.md .claude/commands/initialize.md .gitignore

if git diff --cached --quiet; then
  echo "→ Nothing staged. Already installed?"
  exit 0
fi

echo "→ Committing"
git commit -m "$(cat <<'EOF'
feat: /safe_to_close command + /initialize Core Operations Docs default

- Add .claude/commands/safe_to_close.md (Phases 1.5-7 of the plan)
- Apply 5 anchor-text edits to .claude/commands/initialize.md adding
  the Core Operations Docs group (environments, testing_overview,
  testing_setup, debugging) as default unconditional reads
- Add .claude/safe-to-close-verdict.json to .gitignore

Plan: docs/planning/new_safe_to_close_command_20260531/

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

echo
echo "✓ Install complete."
echo
echo "Next steps:"
echo "  1. (Optional) Restart Claude in this worktree."
echo "  2. Run /safe_to_close to verify it loads (Phase 9 HP-1)."
echo "  3. Run /finalize to push and create the PR."
