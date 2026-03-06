# Tmux Helper Commands Plan

## Background
Claude Code sessions are lost when a terminal closes. Users need a zero-argument shell function to exit claude and resume the same conversation inside a persistent tmux session. Session naming should auto-detect from the worktree directory to eliminate user error.

## Requirements
- Exit claude, then continue the same conversation inside tmux via `claude -c`
- Auto-detect session name from cwd (e.g. `worktree_37_1` → `s1`, `worktree0` → `s0`)
- Reattach to existing tmux session if already running
- Zero arguments — just type `s`
- Simple, minimal implementation

## Problem
Running Claude Code directly in a terminal means the session is tied to that terminal's lifetime. If the terminal closes or disconnects, the session is lost. A tmux wrapper provides persistence — detach with Ctrl+b d, reattach later with the same `s` command.

## Options Considered
1. **Explicit wrapper (`claude-tmux <name>`)** — requires manual naming, typo-prone → rejected
2. **Override `claude` command** — too magical, surprising behavior → rejected
3. **tmux popup keybinding** — only works if already in tmux → rejected
4. **`s <N>` with numeric arg** — still requires remembering which number → rejected
5. **Zero-arg `s` with cwd auto-detection** — simplest UX, no args to remember → **chosen**

## Phased Execution Plan

### Phase 1: Shell function
Create `s()` shell function in `docs/planning/tmux_usage/claude-tmux.sh`:

```bash
s() {
  local dir="$PWD"
  local name

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
    tmux new-session -s "$name" -c "$dir" "claude -c"
  fi
}
```

**Files modified:**
- `docs/planning/tmux_usage/claude-tmux.sh` — rewrite with `s()` function

### Phase 2: Test
- Run `s` from `worktree_37_1` → expect tmux session `s1` with `claude -c`
- Run `s` from `explainanything-worktree0` → expect `s0`
- Run `s` from non-worktree dir → expect error message
- Detach (Ctrl+b d), run `s` again → expect reattach
- Run from inside tmux → verify no nesting error

### Phase 3: Document
- Merge tmux dev server infrastructure into `docs/docs_overall/debugging.md`
- Add `s` function sourcing instructions for `.bashrc`/`.zshrc`

## Testing
- Manual: all scenarios in Phase 2
- No automated tests needed (shell function, not application code)

## Documentation Updates
- `docs/docs_overall/debugging.md` — merged tmux dev server infrastructure from `using_tmux_recommendations.md` and added `s` function sourcing instructions
