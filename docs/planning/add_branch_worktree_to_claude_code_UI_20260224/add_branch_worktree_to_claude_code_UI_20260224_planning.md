# Add Branch Worktree To Claude Code UI Plan

## Background
The Claude Code CLI UI currently doesn't display key context about the working environment. We need to customize it to show the current worktree/working directory, current git branch, and project file name so developers can quickly see which environment they're working in without running separate commands.

## Requirements (from GH Issue #553)
- A) Show current worktree or working directory
- B) Show current git branch
- C) Show project file name
- D) Also show context window % and session cost (nice-to-have)

## Problem
When working across multiple worktrees and branches, it's hard to know at a glance which environment Claude Code is running in. The current UI shows no persistent context about the worktree, branch, or active project. This causes confusion when switching between worktrees, especially since worktree names (e.g., `worktree_37_5`) don't convey the project being worked on. A status line showing all three pieces of context would eliminate this confusion.

## Feature Verification
The **statusLine** is a fully documented, officially supported Claude Code feature:
- Official docs: https://code.claude.com/docs/en/statusline.md
- Configured via `statusLine` key in `~/.claude/settings.json` or `.claude/settings.json`
- Scripts receive JSON session data via **stdin** and print to **stdout**
- Runs as a **direct subprocess** of Claude Code — NOT through the hooks system, NOT subject to Bash tool permission rules
- Updates after each assistant message, permission changes, or vim mode toggles (300ms debounce)
- Can be set up via `/statusline` command or manual configuration
- `/statusline delete` removes it

## Options Considered

### Option A: Single-line bash script with caching (Chosen)
- One bash script at `~/.claude/statusline.sh`
- Single line with all 5 fields: worktree, branch, project, context %, cost
- Caches git branch for 5s in `$HOME/.claude/cache/`
- Configured in `~/.claude/settings.json` (user-level, survives worktree resets)
- **Pros**: Simple, fast, no dependencies beyond jq, dense info in one line
- **Cons**: Line may get long on narrow terminals

### Option B: Multi-line display
- Two lines separating workspace info from metrics
- **Pros**: More readable with breathing room
- **Cons**: Uses more vertical terminal space

### Option C: Use /statusline command to auto-generate
- **Pros**: Easiest setup
- **Cons**: No control over project name derivation logic

## Phased Execution Plan

### Phase 1: Create status line script (`~/.claude/statusline.sh`)

**Script location decision:** `~/.claude/statusline.sh` (user home). Rationale:
- User-level = survives worktree resets (per `managing_claude_settings.md`)
- This is a personal UI preference, not project-specific code
- Not version-controlled (same as `~/.claude/settings.json`)

**Script logic:**
```bash
#!/bin/bash
# Status line for Claude Code: shows worktree, branch, project, context %, cost

# Dependency check
if ! command -v jq &>/dev/null; then
    echo "[statusline: jq not found]"
    exit 0
fi

input=$(cat)

# From JSON stdin — all variables quoted for safety
DIR="$(echo "$input" | jq -r '.workspace.current_dir // empty')"
PCT="$(echo "$input" | jq -r '(.context_window.used_percentage // 0) | floor')"
COST="$(echo "$input" | jq -r '.cost.total_cost_usd // 0')"

# Fallback if DIR is empty or not a valid directory
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
    echo "[no workspace]"
    exit 0
fi

# Worktree name = basename of current dir
WORKTREE="$(basename "$DIR")"

# Git branch with 5s cache (per-worktree cache file in ~/.claude/cache/)
CACHE_DIR="$HOME/.claude/cache"
mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/statusline-git-${WORKTREE}"
CACHE_MAX_AGE=5

cache_is_stale() {
    [ ! -f "$CACHE_FILE" ] || \
    [ $(($(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0))) -gt "$CACHE_MAX_AGE" ]
}

if cache_is_stale; then
    if git -C "$DIR" rev-parse --git-dir &>/dev/null; then
        BRANCH="$(git -C "$DIR" branch --show-current 2>/dev/null)"
        [ -z "$BRANCH" ] && BRANCH="detached"
    else
        BRANCH="no-repo"
    fi
    # Atomic write: write to temp then move to prevent partial reads
    echo "$BRANCH" > "$CACHE_FILE.tmp" && mv "$CACHE_FILE.tmp" "$CACHE_FILE"
else
    BRANCH="$(cat "$CACHE_FILE")"
fi

# Project name = everything after first / in branch name
# feat/my_project → my_project, feat/a/b/c → a/b/c, main → -
case "$BRANCH" in
    */*)  PROJECT="${BRANCH#*/}" ;;
    *)    PROJECT="-" ;;
esac

# Colors
CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; DIM='\033[2m'; RESET='\033[0m'

# Format cost
COST_FMT="$(printf '$%.2f' "$COST")"

# Output single line — use %s for user-derived variables to prevent format string issues
printf '%b' "${DIM}${WORKTREE}${RESET} ${CYAN}"
printf '%s' "$BRANCH"
printf '%b' "${RESET} ${GREEN}"
printf '%s' "$PROJECT"
printf '%b' "${RESET} | ${PCT}%% ${YELLOW}${COST_FMT}${RESET}\n"
```

**Key design decisions:**
- **jq dependency check**: exits gracefully with message if jq missing
- **DIR validation**: exits gracefully if workspace dir is empty/null or doesn't exist on disk
- **Cache in `~/.claude/cache/`**: user-owned directory, not world-writable like /tmp
- **Atomic cache write**: writes to `.tmp` then `mv` to prevent partial reads under concurrency
- **Per-worktree cache file**: uses worktree name suffix to avoid collisions across sessions
- **`git rev-parse --git-dir`**: checks if git repo exists before querying branch
- **Nested branch handling**: `feat/a/b/c` → project = `a/b/c`
- **Safe printf**: user-derived variables printed via `%s` (not `%b`) to prevent format string issues
- **All variables quoted**: prevents word splitting on paths with spaces
- Uses `stat -c %Y` (Linux-only — this is a Linux environment)
- Cache staleness: if `stat` fails, falls back to 0 which makes `now - 0 > 5` always true → treats as stale → re-fetches (safe default behavior, not a bug)
- ANSI colors: dim for worktree (secondary), cyan for branch, green for project, yellow for cost

**Files created:**
- `~/.claude/statusline.sh` (new)
- `~/.claude/cache/` directory (auto-created by script)

### Phase 2: Configure `~/.claude/settings.json`

Add statusLine configuration to existing (empty) user settings:
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

**How statusLine works (per official docs):**
- Claude Code invokes the command as a direct subprocess
- NOT part of the hooks system (PreToolUse, PostToolUse, etc.)
- NOT subject to Bash tool permission/sandbox rules
- Pipes JSON session data to script's stdin
- Displays script's stdout at the bottom of the terminal
- 300ms debounce; cancels in-flight scripts if new update triggers

**Files modified:**
- `~/.claude/settings.json` (currently `{}`)

### Phase 3: Test and verify

1. **Manual test** — run script with mock JSON (output includes ANSI color codes; expected values below are the visible text after terminal renders colors):
   ```bash
   echo '{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/home/ac/Documents/ac/worktree_37_5"},"context_window":{"used_percentage":42.7},"cost":{"total_cost_usd":1.23}}' | ~/.claude/statusline.sh
   ```
   Expected visible text: `worktree_37_5 feat/add_branch_worktree_to_claude_code_UI_20260224 add_branch_worktree_to_claude_code_UI_20260224 | 42% $1.23`

   To verify without color codes, pipe through `sed 's/\x1b\[[0-9;]*m//g'`.

2. **Edge case tests:**
   | Input | Expected Branch | Expected Project | Notes |
   |-------|----------------|-----------------|-------|
   | Branch: `main` | `main` | `-` | No prefix → dash |
   | Branch: `feat/my_project` | `feat/my_project` | `my_project` | Standard case |
   | Branch: `feat/nested/name` | `feat/nested/name` | `nested/name` | Multi-level nesting |
   | Branch: `feat/a/b/c/d` | `feat/a/b/c/d` | `a/b/c/d` | Deep nesting |
   | Branch: `fix/my-project_v2` | `fix/my-project_v2` | `my-project_v2` | Hyphens/underscores |
   | Detached HEAD | `detached` | `-` | Empty `--show-current` |
   | Non-git directory | `no-repo` | `-` | `rev-parse` fails |
   | Empty workspace dir | `[no workspace]` | (n/a) | Exits early |
   | Invalid/missing dir | `[no workspace]` | (n/a) | `[ ! -d ]` check |
   | jq not installed | `[statusline: jq not found]` | (n/a) | Exits early |
   | Null cost/context | `0` / `$0.00` | (n/a) | jq `// 0` fallback |
   | Empty JSON `{}` | (uses git) | (derived) | All fields fallback |

3. **Live test** — verify in current Claude Code session:
   - Status line should appear at bottom after next assistant message
   - Verify across 3+ consecutive interactions
   - Confirm correct worktree name, branch, and project

## Rollback Plan
To disable the status line (instant, no restart):
1. Remove `statusLine` key from `~/.claude/settings.json`, OR run `/statusline delete`
2. Optionally clean up: `rm ~/.claude/statusline.sh ~/.claude/cache/statusline-git-*`
3. Changes take effect on next Claude Code interaction

## Testing
- Manual mock input test with color-stripping verification (Phase 3 step 1)
- Edge case table verification (Phase 3 step 2) — 12 scenarios
- Visual verification in live Claude Code session across 3+ interactions
- No automated CI tests needed — this is a personal dotfile outside the app codebase

## Documentation Updates
- `docs/docs_overall/managing_claude_settings.md` — Add new section `## Status Line Configuration` after the existing `## Documentation Mapping` section (line ~170). Content:
  - What the statusLine setting does
  - Configuration format (`type`, `command`, `padding` fields)
  - Location of script (`~/.claude/statusline.sh`)
  - Note that statusLine survives worktree resets when in user-level settings
  - Example output showing worktree, branch, project, context %, cost
