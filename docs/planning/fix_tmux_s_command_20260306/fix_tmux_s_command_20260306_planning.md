# Fix Tmux S Command Plan

## Background
The `s` command (defined in `docs/planning/tmux_usage/claude-tmux.sh`) is supposed to spin up a tmux session and launch Claude Code within it, but it's not working. It needs investigation and fixing so that users can reliably create/reattach named tmux sessions running `claude -c` from any worktree directory.

## Requirements (from GH Issue #652)
- Fix the `s` command in `docs/planning/tmux_usage/claude-tmux.sh` so it correctly creates/reattaches tmux sessions running `claude -c`
- Investigate why the command fails (no specific error details available)
- Ensure worktree auto-detection works correctly

## Problem
The `s` function in `claude-tmux.sh` is never loaded into the user's shell because the `source` line was never added to `~/.bashrc`. The function code itself is correct — the patterns match the actual directory layout (`*worktree0` for `explainanything-worktree0`, `*worktree*_[0-9]` for `worktree_37_N`). The docs in `debugging.md` reference a hardcoded worktree path (`worktree_37_1`) that breaks every time `reset_worktrees` increments the counter.

## Options Considered

### Source path strategy
1. **Option A: Use `explainanything-worktree0` path (chosen)** - Stable, always exists, always has latest main code, persists across `reset_worktrees` runs
2. **Option B: Glob at shell startup** - e.g., `source ~/Documents/ac/worktree_*/docs/...` — fragile, could match multiple files
3. **Option C: Symlink** - Create `~/bin/claude-tmux.sh` symlink — extra setup, another thing to maintain

### Pattern matching
- **No changes needed** - Existing patterns correctly match the actual directory layout

## Phased Execution Plan

### Phase 1: Add source line to `~/.bashrc`
Add to `~/.bashrc`:
```bash
# Claude Code tmux launcher
source ~/Documents/ac/explainanything-worktree0/docs/planning/tmux_usage/claude-tmux.sh
```
This is a one-time manual step outside the repo. Verify with `source ~/.bashrc && type s`.

### Phase 2: Update documentation
Update `docs/docs_overall/debugging.md` line 155 to use `explainanything-worktree0` path instead of hardcoded `worktree_37_1`.

**Files modified:**
- `docs/docs_overall/debugging.md`

### Rollback
`git revert` the docs commit. Remove the `source` line from `~/.bashrc`.

## Testing

### Manual verification
1. Run `source ~/.bashrc` then `type s` → should show the function
2. `cd ~/Documents/ac/explainanything-worktree0` → run `s` → should create tmux session `s0` running `claude -c`
3. Detach (`Ctrl+b d`) → run `s` again → should reattach to `s0`
4. `cd ~/Documents/ac/worktree_37_2` → run `s` → should create tmux session `s2`
5. Detach → run `s` again → should reattach to `s2`
6. From a non-worktree directory → run `s` → should show error message

### CI/CD
No CI changes needed. This PR only modifies `.md` files, so CI takes the fast path (lint + tsc only). No automated safety net, but appropriate for a docs-only change.

### No automated tests needed
This is a shell utility script — manual verification is sufficient.

## Documentation Updates
- `docs/docs_overall/debugging.md` - Update source path from hardcoded `worktree_37_1` to `explainanything-worktree0`
- `docs/docs_overall/testing_overview.md` - No changes needed (doesn't reference `s` command)
- `docs/feature_deep_dives/testing_setup.md` - No changes needed (doesn't reference `s` command)
