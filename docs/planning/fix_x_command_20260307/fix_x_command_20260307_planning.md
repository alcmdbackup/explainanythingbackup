# Fix X Command Plan

## Background
Add a `-d` flag to the `s` tmux helper command that starts Claude Code with `--dangerously-skip-permissions` mode. Currently the `s` command (from `claude-tmux.sh`) auto-detects the worktree and creates/reattaches a tmux session running `claude -c`. This fix adds an optional `-d` flag so users can run `s -d` to start with permissions skipped.

## Requirements (from GH Issue #671)
- Add `-d` flag to the `s` command in `claude-tmux.sh` that passes `--dangerously-skip-permissions` to `claude`

## Problem
The `s` command in `claude-tmux.sh` always starts Claude Code with `claude -c` (continue mode). There is no way to pass additional flags like `--dangerously-skip-permissions` without editing the script. Users who frequently need to skip permissions must manually run the full command instead of using the convenient `s` shortcut. Adding a `-d` flag preserves the ergonomic benefits while supporting the skip-permissions workflow.

## Options Considered

### Option A: Parse `-d` flag with simple conditional (CHOSEN)
- Add a local variable `claude_args` initialized to `"claude -c"`
- Check if `$1` is `-d`, and if so append `--dangerously-skip-permissions` and shift
- Use `$claude_args` in the `tmux new-session` command
- **Pros**: Minimal change, easy to understand, extensible for future flags
- **Cons**: None significant

### Option B: Separate `sd` alias function
- Create a second function `sd()` that calls `s` with a hardcoded flag
- **Pros**: Even simpler invocation
- **Cons**: Code duplication, user chose against this approach

## Phased Execution Plan

### Phase 1: Modify `claude-tmux.sh`
**File**: `docs/planning/tmux_usage/claude-tmux.sh`

Changes:
1. Add `-d` flag parsing at the top of the function (after `local dir` and `local name`)
2. Build the claude command string conditionally
3. Use the command string in `tmux new-session`

**Before** (line 20):
```bash
tmux new-session -s "$name" -c "$dir" "claude -c"
```

**After**:
```bash
s() {
  local dir="$PWD"
  local name
  local claude_cmd="claude -c"

  if [[ "$1" == "-d" ]]; then
    claude_cmd="claude -c --dangerously-skip-permissions"
    shift
  fi

  case "$(basename "$dir")" in
    *worktree0)       name="s0" ;;
    *worktree*_[0-9]) name="s${dir##*_}" ;;
    *)
      echo "Not in a worktree directory. Run from ~/Documents/ac/worktree_*" >&2
      return 1
      ;;
  esac

  if tmux has-session -t "$name" 2>/dev/null; then
    tmux attach-session -t "$name"
  else
    tmux new-session -s "$name" -c "$dir" "$claude_cmd"
  fi
}
```

### Phase 2: Update documentation
**File**: `docs/docs_overall/debugging.md`

Update the "Running Claude Code in tmux" section (lines 150-160) to document the `-d` flag:
```markdown
s          # auto-creates/reattaches tmux session
s -d       # same, but with --dangerously-skip-permissions
```

## Testing
- **Manual verification**: Source the updated script, run `s -d` from a worktree directory, confirm Claude starts with skip-permissions mode
- **Edge cases**: Run `s` without `-d` to confirm no regression; run from non-worktree directory to confirm error still works
- No unit tests needed — this is a standalone shell script with no test infrastructure

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/debugging.md` - Add `-d` flag to the `s` command documentation (lines 150-160)
- `docs/docs_overall/testing_overview.md` - No changes needed
