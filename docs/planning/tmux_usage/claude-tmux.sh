# Source this file in .bashrc/.zshrc to get the `s` function.
# Auto-detects worktree from pwd and creates/reattaches a tmux session running claude -c.

s() {
  local dir="$PWD"
  local name
  local claude_cmd="claude -c"

  # -d: start with --dangerously-skip-permissions
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
