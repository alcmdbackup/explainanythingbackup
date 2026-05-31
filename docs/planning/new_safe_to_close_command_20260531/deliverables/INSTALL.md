# Installation Instructions

The execution environment for this project (worktree_37_7) bind-mounts `.claude/commands/` as read-only at the OS level (verified via `mount | grep claude`), preventing in-session installation. The deliverables are staged here; install them from any shell outside this Claude session.

## TL;DR — one command

From the worktree root, **outside** a Claude Code session:

```bash
bash docs/planning/new_safe_to_close_command_20260531/deliverables/install.sh
```

The script runs the Phase 8b strict order (pre-flight anchor integrity → copy files → post-edit verification → atomic commit) with automatic rollback on any failure. Safe to re-run.

## What's here

| File | Destination | Action |
|---|---|---|
| `safe_to_close.md` | `.claude/commands/safe_to_close.md` | Create new file |
| `initialize.md` | `.claude/commands/initialize.md` | Replace existing file (5 anchor-text edits already applied) |
| `gitignore.patch` | `.gitignore` | Append one line |

## One-shot install

From the worktree root (e.g. `cd ~/Documents/ac/worktree_37_7`), in a shell where `.claude/commands/` is writable (typically: any shell NOT inside this Claude session — i.e. exit Claude first, or run from a peer worktree like `explainanything-worktree0`):

```bash
SRC=docs/planning/new_safe_to_close_command_20260531/deliverables

# 1. Stage the new slash command
cp "$SRC/safe_to_close.md" .claude/commands/safe_to_close.md

# 2. Replace initialize.md with the 5-edit version
cp "$SRC/initialize.md" .claude/commands/initialize.md

# 3. Append the gitignore line (idempotent — won't double-add)
grep -qxF '.claude/safe-to-close-verdict.json' .gitignore || \
  echo '.claude/safe-to-close-verdict.json' >> .gitignore

# 4. Atomic commit
git add -- .claude/commands/safe_to_close.md .claude/commands/initialize.md .gitignore
git commit -m "$(cat <<'EOF'
feat: /safe_to_close command + /initialize default Core Operations Docs

- Add .claude/commands/safe_to_close.md (Phases 1.5-7 of the plan)
- Apply 5 anchor-text edits to .claude/commands/initialize.md adding
  the Core Operations Docs group (environments, testing_overview,
  testing_setup, debugging) as default unconditional reads
- Add .claude/safe-to-close-verdict.json to .gitignore

Per plan: docs/planning/new_safe_to_close_command_20260531/
EOF
)"
```

## Phase 8b post-edit verification (pre-staged)

These checks already passed against the staged `initialize.md` in this folder. After installation, re-run them against the live file to confirm the copy preserved content:

```bash
grep -c "Core Workflow Docs:" .claude/commands/initialize.md            # expect 1
grep -c "Core Operations Docs:" .claude/commands/initialize.md          # expect 1
grep -c "Exclude the 7 core docs already read" .claude/commands/initialize.md  # expect 1
grep -c "Core docs are pre-read" .claude/commands/initialize.md         # expect 1
grep -c "^### Core Workflow Docs$" .claude/commands/initialize.md       # expect 1
grep -c "^### Core Operations Docs$" .claude/commands/initialize.md     # expect 1
grep -c "Core docs read: 7" .claude/commands/initialize.md              # expect 1
grep -c "feature_deep_dives/testing_setup.md" .claude/commands/initialize.md  # expect 2
echo $(( $(grep -c '^```' .claude/commands/initialize.md) % 2 ))        # expect 0 (balanced fences)
```

## Phase 8b rollback (if needed)

If the new `initialize.md` causes issues post-install:

```bash
git revert HEAD                                       # undo the install commit
# OR if you haven't committed yet:
git checkout HEAD -- .claude/commands/initialize.md   # discard pending edits
```

## Phase 9 manual smoke test (do this after install)

```bash
# Optional but recommended — invoke /initialize against a throwaway project
# and Ctrl-C after Step 2.5 completes successfully (i.e. all 7 core docs read).
# Goal: confirm the modified initialize.md has no parse-time errors and
# all 7 doc paths resolve.

# In Claude Code:
/initialize chore/throwaway_init_smoke_$(date +%s)
# (Ctrl-C after Step 2.5 finishes; do not actually create the project folder)
```

## Why bind-mount?

The harness running this Claude session pins `.claude/commands/`, `.claude/hooks/`, `.claude/skills/`, and `.claude/settings*.json` as read-only mounts during a session to prevent in-flight self-modification of the agent's runtime. This is a defensive measure, not a bug. Working around it via `dangerouslyDisableSandbox` would not help — the read-only flag is at the OS mount layer, below the Claude sandbox.
